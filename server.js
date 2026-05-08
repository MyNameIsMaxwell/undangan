const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(path.join(__dirname, 'database.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
        uuid TEXT PRIMARY KEY,
        own TEXT NOT NULL,
        parent_uuid TEXT,
        name TEXT NOT NULL,
        presence INTEGER DEFAULT 1,
        comment TEXT DEFAULT '',
        gif_url TEXT,
        is_admin INTEGER DEFAULT 0,
        ip TEXT,
        user_agent TEXT,
        timezone TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (parent_uuid) REFERENCES comments(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
        comment_uuid TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (comment_uuid, session_id),
        FOREIGN KEY (comment_uuid) REFERENCES comments(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        token TEXT,
        token_expires TEXT,
        created_at TEXT NOT NULL
    );
`);

// Default config
const DEFAULT_CONFIG = {
    name: 'Администратор',
    email: 'admin@example.com',
    tz: 'Europe/Moscow',
    is_filter: 'false',
    is_confetti_animation: 'true',
    can_reply: 'true',
    can_edit: 'true',
    can_delete: 'true',
    tenor_key: '',
};

// Add timezone column if it doesn't exist (migration for existing DBs)
try { db.exec('ALTER TABLE comments ADD COLUMN timezone TEXT'); } catch { /* already exists */ }

// Initialize config if empty
const configCount = db.prepare('SELECT COUNT(*) as c FROM config').get();
if (configCount.c === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
        insert.run(k, String(v));
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const generateUUID = () => crypto.randomUUID();
const hashPassword = (pwd) => crypto.createHash('sha256').update(String(pwd)).digest('hex');

function getConfigObject() {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const row of rows) {
        if (row.value === 'true') config[row.key] = true;
        else if (row.value === 'false') config[row.key] = false;
        else if (row.value === '' || row.value === null) config[row.key] = null;
        else config[row.key] = row.value;
    }
    return { ...DEFAULT_CONFIG, ...config };
}

function getCommentWithReplies(comment) {
    const likeCount = db.prepare('SELECT COUNT(*) as c FROM likes WHERE comment_uuid = ?').get(comment.uuid);
    const replies = db.prepare('SELECT * FROM comments WHERE parent_uuid = ? ORDER BY created_at ASC').all(comment.uuid);

    return {
        uuid: comment.uuid,
        own: comment.own,
        name: comment.name,
        presence: Boolean(comment.presence),
        comment: comment.comment,
        created_at: comment.created_at,
        is_admin: Boolean(comment.is_admin),
        is_parent: comment.parent_uuid === null,
        gif_url: comment.gif_url,
        ip: comment.ip,
        user_agent: comment.user_agent,
        timezone: comment.timezone,
        like_count: likeCount.c,
        comments: replies.map(r => getCommentWithReplies(r)),
    };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(__dirname, {
    index: 'index.html',
    extensions: ['html'],
}));

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return res.status(401).json({ error: ['Требуется авторизация'] });

    const admin = db.prepare('SELECT * FROM admin WHERE token = ? AND token_expires > ?').get(token, new Date().toISOString());
    if (!admin) return res.status(401).json({ error: ['Неверный или истёкший токен'] });

    req.admin = admin;
    next();
};

const optionalAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        const admin = db.prepare('SELECT * FROM admin WHERE token = ? AND token_expires > ?').get(token, new Date().toISOString());
        if (admin) req.admin = admin;
    }
    next();
};

// ─── Auth API ────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: ['Email и пароль обязательны'] });
    }

    const admin = db.prepare('SELECT * FROM admin WHERE id = 1').get();

    if (!admin) {
        // First login — create admin account
        const token = generateUUID();
        const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year

        db.prepare('INSERT INTO admin (id, email, password_hash, token, token_expires, created_at) VALUES (1, ?, ?, ?, ?, ?)')
            .run(email, hashPassword(password), token, expires, new Date().toISOString());

        db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('email', email);

        console.log(`✅ Создан администратор: ${email}`);
        return res.json({ data: { token } });
    }

    if (admin.email !== email || admin.password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: ['Неверный email или пароль'] });
    }

    // Generate new token
    const token = generateUUID();
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare('UPDATE admin SET token = ?, token_expires = ? WHERE id = 1').run(token, expires);

    return res.json({ data: { token } });
});

app.get('/api/auth/user', authMiddleware, (req, res) => {
    const config = getConfigObject();
    res.json({
        data: {
            ...config,
            email: req.admin.email,
            access_key: req.admin.token,
        }
    });
});

app.put('/api/auth/password', authMiddleware, (req, res) => {
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
        return res.status(400).json({ error: ['Пароль не может быть пустым'] });
    }

    if (req.admin.password_hash !== hashPassword(old_password)) {
        return res.status(400).json({ error: ['Неверный старый пароль'] });
    }

    db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(hashPassword(new_password));
    res.json({ data: 'ok' });
});

// ─── Config API ──────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
    res.json({ data: getConfigObject() });
});

app.put('/api/config', authMiddleware, (req, res) => {
    const updates = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
    const updateAll = db.transaction((obj) => {
        for (const [key, value] of Object.entries(obj)) {
            if (key === 'email' || key === 'access_key') continue; // skip readonly
            stmt.run(key, String(value));
        }
    });
    updateAll(updates);
    res.json({ data: 'ok' });
});

// ─── Comments API ────────────────────────────────────────────────────────────

app.get('/api/comments', (req, res) => {
    const per = Math.min(parseInt(req.query.per) || 10, 100);
    const next = parseInt(req.query.next) || 0;

    const countResult = db.prepare('SELECT COUNT(*) as c FROM comments WHERE parent_uuid IS NULL').get();

    const topComments = db.prepare(
        'SELECT * FROM comments WHERE parent_uuid IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(per, next);

    const lists = topComments.map(c => getCommentWithReplies(c));

    res.json({ data: { count: countResult.c, lists } });
});

app.post('/api/comments', optionalAuth, (req, res) => {
    const { name, presence, comment, gif_url, parent_id, timezone } = req.body;

    if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: ['Имя обязательно'] });
    }

    // Verify parent exists if provided
    if (parent_id) {
        const parent = db.prepare('SELECT uuid FROM comments WHERE uuid = ?').get(parent_id);
        if (!parent) {
            return res.status(400).json({ error: ['Родительский комментарий не найден'] });
        }
    }

    const uuid = generateUUID();
    const own = generateUUID();
    const isAdmin = req.admin ? 1 : 0;

    db.prepare(
        'INSERT INTO comments (uuid, own, parent_uuid, name, presence, comment, gif_url, is_admin, ip, user_agent, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
        uuid, own, parent_id || null, name.trim(),
        presence ? 1 : 0, comment || '', gif_url || null,
        isAdmin, req.ip, req.headers['user-agent'],
        timezone || null, new Date().toISOString()
    );

    const newComment = db.prepare('SELECT * FROM comments WHERE uuid = ?').get(uuid);

    res.status(201).json({
        data: {
            uuid: newComment.uuid,
            own,
            name: newComment.name,
            presence: Boolean(newComment.presence),
            comment: newComment.comment,
            created_at: newComment.created_at,
            is_admin: Boolean(newComment.is_admin),
            is_parent: !parent_id,
            gif_url: newComment.gif_url,
            ip: newComment.ip,
            user_agent: newComment.user_agent,
            timezone: newComment.timezone,
            like_count: 0,
            comments: [],
        }
    });
});

app.put('/api/comments/:uuid', optionalAuth, (req, res) => {
    const { uuid } = req.params;
    const { own, comment, presence, gif_url } = req.body;

    const existing = db.prepare('SELECT * FROM comments WHERE uuid = ?').get(uuid);
    if (!existing) return res.status(404).json({ error: ['Комментарий не найден'] });

    // Check ownership or admin
    if (!req.admin && existing.own !== own) {
        return res.status(403).json({ error: ['Нет доступа'] });
    }

    const updates = [];
    const values = [];

    if (comment !== undefined && comment !== null) { updates.push('comment = ?'); values.push(comment); }
    if (presence !== undefined && presence !== null) { updates.push('presence = ?'); values.push(presence ? 1 : 0); }
    if (gif_url !== undefined && gif_url !== null) { updates.push('gif_url = ?'); values.push(gif_url); }

    if (updates.length > 0) {
        values.push(uuid);
        db.prepare(`UPDATE comments SET ${updates.join(', ')} WHERE uuid = ?`).run(...values);
    }

    res.json({ data: { status: true } });
});

app.delete('/api/comments/:uuid', optionalAuth, (req, res) => {
    const { uuid } = req.params;
    const own = req.body?.own || req.query.own;

    const existing = db.prepare('SELECT * FROM comments WHERE uuid = ?').get(uuid);
    if (!existing) return res.status(404).json({ error: ['Комментарий не найден'] });

    if (!req.admin && existing.own !== own) {
        return res.status(403).json({ error: ['Нет доступа'] });
    }

    // Delete replies first (cascade), then comment
    db.prepare('DELETE FROM likes WHERE comment_uuid IN (SELECT uuid FROM comments WHERE parent_uuid = ?)').run(uuid);
    db.prepare('DELETE FROM comments WHERE parent_uuid = ?').run(uuid);
    db.prepare('DELETE FROM likes WHERE comment_uuid = ?').run(uuid);
    db.prepare('DELETE FROM comments WHERE uuid = ?').run(uuid);

    res.json({ data: { status: true } });
});

// ─── Likes API ───────────────────────────────────────────────────────────────

app.post('/api/comments/:uuid/like', (req, res) => {
    const { uuid } = req.params;
    const { session_id } = req.body;

    if (!session_id) return res.status(400).json({ error: ['session_id обязателен'] });

    try {
        db.prepare('INSERT INTO likes (comment_uuid, session_id, created_at) VALUES (?, ?, ?)')
            .run(uuid, session_id, new Date().toISOString());
        res.json({ data: { status: true } });
    } catch {
        res.json({ data: { status: false, message: 'already liked' } });
    }
});

app.delete('/api/comments/:uuid/like', (req, res) => {
    const { uuid } = req.params;
    const { session_id } = req.body;

    db.prepare('DELETE FROM likes WHERE comment_uuid = ? AND session_id = ?').run(uuid, session_id);
    res.json({ data: { status: true } });
});

// ─── Stats API ───────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
    const comments = db.prepare('SELECT COUNT(*) as c FROM comments').get().c;
    const likes = db.prepare('SELECT COUNT(*) as c FROM likes').get().c;
    const present = db.prepare('SELECT COUNT(*) as c FROM comments WHERE presence = 1 AND parent_uuid IS NULL').get().c;
    const absent = db.prepare('SELECT COUNT(*) as c FROM comments WHERE presence = 0 AND parent_uuid IS NULL').get().c;

    res.json({ data: { comments, likes, present, absent } });
});

// ─── Export API ──────────────────────────────────────────────────────────────

app.get('/api/comments/export', (req, res) => {
    // Allow auth via header or query param
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return res.status(401).json({ error: ['Требуется авторизация'] });

    const admin = db.prepare('SELECT * FROM admin WHERE token = ? AND token_expires > ?').get(token, new Date().toISOString());
    if (!admin) return res.status(401).json({ error: ['Неверный токен'] });

    const comments = db.prepare('SELECT * FROM comments ORDER BY created_at DESC').all();

    const rows = ['\uFEFFИмя,Присутствие,Комментарий,Дата,Родительский'];
    for (const c of comments) {
        const name = `"${(c.name || '').replace(/"/g, '""')}"`;
        const presence = c.presence ? 'Да' : 'Нет';
        const comment = `"${(c.comment || '').replace(/"/g, '""')}"`;
        const date = c.created_at;
        const parent = c.parent_uuid || '';
        rows.push(`${name},${presence},${comment},${date},${parent}`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comments-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(rows.join('\n'));
});

// ─── Fallback ────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  💌 Свадебное приглашение — сервер запущен       ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  🌐 Приглашение:  http://localhost:${PORT}          ║`);
    console.log(`║  📋 Админ-панель: http://localhost:${PORT}/dashboard ║`);
    console.log('║                                                  ║');
    console.log('║  Пример ссылки для гостя:                        ║');
    console.log(`║  http://localhost:${PORT}/?to=Иван&to2=Мария        ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});
