import { video } from './video.js';
import { image } from './image.js';
import { audio } from './audio.js';
import { progress } from './progress.js';
import { util } from '../../common/util.js';
import { loader } from '../../libs/loader.js';
import { theme } from '../../common/theme.js';
import { lang } from '../../common/language.js';
import { storage } from '../../common/storage.js';
import { session } from '../../common/session.js';
import { offline } from '../../common/offline.js';
import { comment } from '../components/comment.js';
import * as confetti from '../../libs/confetti.js';
import { pool } from '../../connection/request.js';
import { localComments } from '../../common/local-comments.js';

export const guest = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let information = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let config = null;

    /**
     * @returns {void}
     */
    const countDownDate = () => {
        const count = (new Date(document.body.getAttribute('data-time').replace(' ', 'T'))).getTime();

        const pad = (num) => num < 10 ? `0${num}` : `${num}`;

        const day = document.getElementById('day');
        const hour = document.getElementById('hour');
        const minute = document.getElementById('minute');
        const second = document.getElementById('second');

        const updateCountdown = () => {
            const now = Date.now();
            const distance = count - now;

            if (distance < 0) {
                day.textContent = '00';
                hour.textContent = '00';
                minute.textContent = '00';
                second.textContent = '00';
                return;
            }

            day.textContent = pad(Math.floor(distance / (1000 * 60 * 60 * 24)));
            hour.textContent = pad(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
            minute.textContent = pad(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)));
            second.textContent = pad(Math.floor((distance % (1000 * 60)) / 1000));

            util.timeOut(updateCountdown, 1000 - (now % 1000));
        };

        util.timeOut(updateCountdown);
    };

    /**
     * @returns {{ name1: string|null, name2: string|null }}
     */
    const getGuestNames = () => {
        const params = new URLSearchParams(window.location.search);
        let name1 = null;
        let name2 = null;

        const raw = window.location.search.split('to=');
        if (raw.length > 1 && raw[1].length >= 1) {
            const val = raw[1].split('&')[0];
            name1 = window.decodeURIComponent(val);
        }

        const to2 = params.get('to2');
        if (to2 && to2.length >= 1) {
            name2 = window.decodeURIComponent(to2);
        }

        return { name1, name2 };
    };

    /**
     * @returns {void}
     */
    const showGuestName = () => {
        const { name1, name2 } = getGuestNames();

        if (name1) {
            const guestName = document.getElementById('guest-name');
            const div = document.createElement('div');
            div.classList.add('m-2');

            let namesHtml = `<p class="font-esthetic m-0 p-0" style="font-size: 1.75rem">${util.escapeHtml(name1)}</p>`;
            if (name2) {
                namesHtml += `<p class="font-esthetic m-0 p-0" style="font-size: 1.75rem">${util.escapeHtml(name2)}</p>`;
            }

            const template = `<small class="mt-0 mb-1 mx-0 p-0">${util.escapeHtml(guestName?.getAttribute('data-message'))}</small>${namesHtml}`;
            util.safeInnerHTML(div, template);

            guestName?.appendChild(div);
        }

        const form = document.getElementById('form-name');
        if (form) {
            form.value = name1 ?? information.get('name') ?? '';
        }

        const form2 = document.getElementById('form-name-2');
        if (form2) {
            form2.value = name2 ?? information.get('name2') ?? '';
            const form2Container = form2.closest('.mb-3');
            if (form2Container && !name2 && !information.get('name2')) {
                form2Container.classList.add('d-none');
            }
        }
    };

    /**
     * @returns {Promise<void>}
     */
    const slide = async () => {
        const interval = 6000;
        const slides = document.querySelectorAll('.slide-desktop');

        if (!slides || slides.length === 0) {
            return;
        }

        const desktopEl = document.getElementById('root')?.querySelector('.d-sm-block');
        if (!desktopEl) {
            return;
        }

        desktopEl.dispatchEvent(new Event('undangan.slide.stop'));

        if (window.getComputedStyle(desktopEl).display === 'none') {
            return;
        }

        if (slides.length === 1) {
            await util.changeOpacity(slides[0], true);
            return;
        }

        let index = 0;
        for (const [i, s] of slides.entries()) {
            if (i === index) {
                s.classList.add('slide-desktop-active');
                await util.changeOpacity(s, true);
                break;
            }
        }

        let run = true;
        const nextSlide = async () => {
            await util.changeOpacity(slides[index], false);
            slides[index].classList.remove('slide-desktop-active');

            index = (index + 1) % slides.length;

            if (run) {
                slides[index].classList.add('slide-desktop-active');
                await util.changeOpacity(slides[index], true);
            }

            return run;
        };

        desktopEl.addEventListener('undangan.slide.stop', () => {
            run = false;
        });

        const loop = async () => {
            if (await nextSlide()) {
                util.timeOut(loop, interval);
            }
        };

        util.timeOut(loop, interval);
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {void}
     */
    const open = (button) => {
        button.disabled = true;
        document.body.scrollIntoView({ behavior: 'instant' });
        document.getElementById('root').classList.remove('opacity-0');

        if (theme.isAutoMode()) {
            document.getElementById('button-theme').classList.remove('d-none');
        }

        slide();
        theme.spyTop();

        confetti.basicAnimation();
        util.timeOut(confetti.openAnimation, 1500);

        document.dispatchEvent(new Event('undangan.open'));
        util.changeOpacity(document.getElementById('welcome'), false).then((el) => el.remove());
    };

    /**
     * @param {HTMLDivElement} div
     * @returns {void}
     */
    const showStory = (div) => {
        if (navigator.vibrate) {
            navigator.vibrate(500);
        }
        confetti.tapTapAnimation(div, 100);
        util.changeOpacity(div, false).then((e) => e.remove());
    };

    /**
     * @returns {void}
     */
    const closeInformation = () => information.set('info', true);

    /**
     * @returns {void}
     */
    const normalizeArabicFont = () => {
        document.querySelectorAll('.font-arabic').forEach((el) => {
            el.innerHTML = String(el.innerHTML).normalize('NFC');
        });
    };

    /**
     * @returns {void}
     */
    const animateSvg = () => {
        document.querySelectorAll('svg').forEach((el) => {
            if (el.hasAttribute('data-class')) {
                util.timeOut(() => el.classList.add(el.getAttribute('data-class')), parseInt(el.getAttribute('data-time')));
            }
        });
    };

    /**
     * @returns {void}
     */
    const buildGoogleCalendar = () => {
        const formatDate = (d) => (new Date(d.replace(' ', 'T') + ':00Z')).toISOString().replace(/[-:]/g, '').split('.').shift();

        const url = new URL('https://calendar.google.com/calendar/render');
        const data = new URLSearchParams({
            action: 'TEMPLATE',
            text: 'Свадьба Максима и Юлии',
            dates: `${formatDate('2026-07-18 10:00')}/${formatDate('2026-07-18 18:00')}`,
            details: 'Мы с радостью приглашаем вас разделить с нами этот особенный день.',
            location: 'Адрес места проведения свадьбы',
            ctz: config.get('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        url.search = data.toString();
        document.querySelector('#home button')?.addEventListener('click', () => window.open(url, '_blank'));
    };

    /**
     * @returns {object}
     */
    const loaderLibs = () => {
        progress.add();

        const load = (opt) => {
            loader(opt)
                .then(() => progress.complete('libs'))
                .catch(() => progress.invalid('libs'));
        };

        return { load };
    };

    /**
     * @returns {Promise<void>}
     */
    const booting = async () => {
        animateSvg();
        countDownDate();
        showGuestName();
        normalizeArabicFont();
        buildGoogleCalendar();

        if (information.has('presence')) {
            document.getElementById('form-presence').value = information.get('presence') ? '1' : '2';
        }

        if (information.get('info')) {
            document.getElementById('information')?.remove();
        }

        await util.changeOpacity(document.getElementById('welcome'), true);
    };

    /**
     * @returns {void}
     */
    const pageLoaded = () => {
        lang.init();
        offline.init();
        comment.init();
        progress.init();

        config = storage('config');
        information = storage('information');

        const vid = video.init();
        const img = image.init();
        const aud = audio.init();
        const lib = loaderLibs();
        const token = document.body.getAttribute('data-key');

        window.addEventListener('resize', util.debounce(slide));
        document.addEventListener('undangan.progress.done', () => booting());

        if (!token || token.length <= 0) {
            document.getElementById('comment')?.remove();
            document.querySelector('a.nav-link[href="#comment"]')?.closest('li.nav-item')?.remove();

            vid.load();
            img.load();
            aud.load();
            lib.load({
                confetti: document.body.getAttribute('data-confetti') === 'true',
                additionalFont: false,
            });
        }

        if (token && token.length > 0) {
            // Загружаем конфигурацию с сервера
            progress.add();
            progress.add();

            if (!img.hasDataSrc()) {
                img.load();
            }

            localComments.loadConfig().then((serverConfig) => {
                // Сохраняем в локальный кэш
                for (const [k, v] of Object.entries(serverConfig)) {
                    config.set(k, v);
                }

                document.dispatchEvent(new Event('undangan.session'));
                progress.complete('config');

                if (img.hasDataSrc()) {
                    img.load();
                }

                vid.load();
                aud.load();
                lib.load({
                    confetti: serverConfig.is_confetti_animation,
                    additionalFont: false,
                });

                comment.show()
                    .then(() => progress.complete('comment'))
                    .catch(() => progress.invalid('comment'));
            }).catch(() => {
                progress.invalid('config');
            });
        }
    };

    /**
     * @returns {object}
     */
    const init = () => {
        theme.init();
        session.init();

        if (session.isAdmin()) {
            storage('user').clear();
            storage('owns').clear();
            storage('likes').clear();
            storage('session').clear();
            storage('comment').clear();
        }

        window.addEventListener('load', () => {
            try {
                pool.init(pageLoaded, [
                    'image',
                    'video',
                    'audio',
                    'libs',
                    'gif',
                ]);
            } catch {
                pageLoaded();
            }
        });

        return {
            util,
            theme,
            comment,
            guest: {
                open,
                showStory,
                closeInformation,
            },
        };
    };

    return {
        init,
    };
})();
