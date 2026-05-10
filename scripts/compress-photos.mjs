#!/usr/bin/env node
/**
 * Сжимает фотографии под веб: целевой размер файла ~minKb–maxKb (по умолчанию 200–400 КБ).
 *
 * Важно: JPEG с таким бюджетом — всегда сжатие с потерями. Скрипт подбирает качество так,
 * чтобы визуально оставалось «как оригинал» на экране; математически «без потерь» для фото
 * возможно только в PNG/WebP lossless — они редко укладываются в 200–400 КБ.
 *
 * Использование:
 *   npm run photos:compress
 *   node scripts/compress-photos.mjs --dir photo --out photo-web --max-side 1920
 *   node scripts/compress-photos.mjs --in-place --backup
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function parseArgs() {
    const a = process.argv.slice(2);
    const get = (name, def) => {
        const i = a.indexOf(name);
        if (i < 0 || !a[i + 1] || a[i + 1].startsWith('-')) {
            return def;
        }
        return a[i + 1];
    };
    const inPlace = a.includes('--in-place');
    const dir = path.resolve(ROOT, get('--dir', 'photo'));
    let out;
    if (inPlace) {
        out = dir;
    } else if (get('--out', '') !== '') {
        out = path.resolve(process.cwd(), get('--out', ''));
    } else {
        out = path.join(ROOT, 'photo-web');
    }
    return {
        dir,
        out,
        inPlace,
        backup: a.includes('--backup'),
        maxSide: Number(get('--max-side', '1920')),
        minKb: Number(get('--min-kb', '200')),
        maxKb: Number(get('--max-kb', '400')),
        dryRun: a.includes('--dry-run'),
    };
}

const args = parseArgs();

const minBytes = args.minKb * 1024;
const maxBytes = args.maxKb * 1024;

/**
 * @param {Buffer} input
 * @param {number} maxSide
 * @returns {Promise<Buffer>}
 */
async function resizeToMaxSide(input, maxSide) {
    const img = sharp(input);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
        return input;
    }
    if (w <= maxSide && h <= maxSide) {
        return img.toBuffer();
    }
    return img
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();
}

/**
 * @param {Buffer} rgbBuffer — уже подготовленный буфер (после resize / flatten)
 * @param {number} maxBytes
 */
const jpegOpts = (q) => ({
    quality: q,
    mozjpeg: true,
    progressive: true,
});

/**
 * Максимальное качество JPEG при котором размер ≤ maxBytes (если возможно).
 * @param {Buffer} rgbBuffer
 * @param {number} maxBytes
 */
async function jpegUnderMax(rgbBuffer, maxBytes) {
    let low = 35;
    let high = 92;
    let best = { buf: /** @type {Buffer|null} */ (null), q: 35 };

    while (low <= high) {
        const q = Math.floor((low + high) / 2);
        const buf = await sharp(rgbBuffer).jpeg(jpegOpts(q)).toBuffer();

        if (buf.length <= maxBytes) {
            best = { buf, q };
            low = q + 1;
        } else {
            high = q - 1;
        }
    }

    if (!best.buf) {
        best.buf = await sharp(rgbBuffer).jpeg(jpegOpts(35)).toBuffer();
        best.q = 35;
    }

    return best;
}

/**
 * Подгонка размера: если даже при низком качестве не влезаем — уменьшаем картинку.
 * @param {Buffer} input
 */
async function prepareWorking(input, side) {
    let working = await resizeToMaxSide(input, side);
    const pipeline = sharp(working).rotate();
    const meta = await pipeline.metadata();
    if (meta.hasAlpha) {
        working = await pipeline.flatten({ background: { r: 255, g: 255, b: 255 } }).toBuffer();
    } else {
        working = await pipeline.toBuffer();
    }
    return working;
}

async function compressBuffer(input) {
    let side = args.maxSide;

    for (let attempt = 0; attempt < 12; attempt++) {
        const working = await prepareWorking(input, side);
        let { buf, q } = await jpegUnderMax(working, maxBytes);

        if (buf.length > maxBytes) {
            side = Math.round(side * 0.85);
            if (side < 400) {
                break;
            }
            continue;
        }

        if (buf.length < minBytes) {
            for (let qq = q + 1; qq <= 92; qq++) {
                const tryBuf = await sharp(working).jpeg(jpegOpts(qq)).toBuffer();
                if (tryBuf.length > maxBytes) {
                    break;
                }
                buf = tryBuf;
                q = qq;
                if (tryBuf.length >= minBytes) {
                    break;
                }
            }
        }

        return { buffer: buf, quality: q, side };
    }

    const working = await prepareWorking(input, Math.min(side, 1280));
    const { buf, q } = await jpegUnderMax(working, maxBytes);
    return { buffer: buf, quality: q, side: Math.min(side, 1280) };
}

async function collectFiles(dir) {
    const names = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of names) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...await collectFiles(p));
        } else if (e.name.endsWith('.bak')) {
            /* skip backups */
        } else if (EXT.has(path.extname(e.name).toLowerCase())) {
            out.push(p);
        }
    }
    return out;
}

async function main() {
    console.log('Параметры:', {
        dir: args.dir,
        out: args.out,
        inPlace: args.inPlace,
        backup: args.backup,
        maxSide: args.maxSide,
        targetKb: `${args.minKb}–${args.maxKb}`,
        dryRun: args.dryRun,
    });

    let files;
    try {
        files = await collectFiles(args.dir);
    } catch (e) {
        console.error('Не удалось прочитать папку:', args.dir, e.message);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log('Нет изображений.');
        process.exit(0);
    }

    if (!args.inPlace && args.out !== args.dir) {
        await fs.mkdir(args.out, { recursive: true });
    }

    let saved = 0;
    for (const abs of files) {
        const rel = path.relative(args.dir, abs);
        const dest = path.join(args.out, rel);

        const raw = await fs.readFile(abs);
        const before = raw.length;

        if (before <= maxBytes && before >= minBytes) {
            console.log(`⊘ ${rel} — уже в диапазоне (${(before / 1024).toFixed(0)} КБ)`);
            continue;
        }

        if (args.dryRun) {
            console.log(`… ${rel} (${(before / 1024).toFixed(0)} КБ) → dry-run`);
            continue;
        }

        const { buffer, quality, side } = await compressBuffer(raw);
        const after = buffer.length;

        if (args.backup && args.inPlace) {
            const bak = abs + '.bak';
            await fs.copyFile(abs, bak);
        }

        if (!args.inPlace || args.out !== args.dir) {
            await fs.mkdir(path.dirname(dest), { recursive: true });
        }

        const outPath = path.join(path.dirname(dest), path.basename(dest, path.extname(dest)) + '.jpg');
        await fs.writeFile(outPath, buffer);

        saved += before - after;
        console.log(
            `✓ ${rel} → ${path.relative(args.out, outPath)}  ${(before / 1024).toFixed(0)} → ${(after / 1024).toFixed(0)} КБ  q=${quality}  maxSide=${side}`,
        );
    }

    console.log(`\nГотово. Сэкономлено ~${(saved / 1024 / 1024).toFixed(2)} МБ (суммарно по обработанным файлам).`);
    if (!args.inPlace) {
        console.log(`Файлы в: ${args.out} (проверьте и замените папку photo при необходимости).`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
