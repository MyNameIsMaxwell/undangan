import { auth } from './auth.js';
import { navbar } from './navbar.js';
import { util } from '../../common/util.js';
import { theme } from '../../common/theme.js';
import { lang } from '../../common/language.js';
import { storage } from '../../common/storage.js';
import { session } from '../../common/session.js';
import { offline } from '../../common/offline.js';
import { comment } from '../components/comment.js';
import { pool } from '../../connection/request.js';
import { localComments } from '../../common/local-comments.js';

export const admin = (() => {

    /**
     * @returns {Promise<void>}
     */
    const getUserStats = async () => {
        // Загружаем конфигурацию с сервера
        const config = await localComments.loadConfig();

        util.safeInnerHTML(document.getElementById('dashboard-name'), `${util.escapeHtml(config.name)}<i class="fa-solid fa-hands text-warning ms-2"></i>`);
        document.getElementById('dashboard-email').textContent = config.email;
        document.getElementById('dashboard-accesskey').value = session.getToken() || 'N/A';
        document.getElementById('button-copy-accesskey').setAttribute('data-copy', session.getToken() || '');

        document.getElementById('form-name').value = util.escapeHtml(config.name);
        document.getElementById('form-timezone').value = config.tz;
        document.getElementById('filterBadWord').checked = Boolean(config.is_filter);
        document.getElementById('confettiAnimation').checked = Boolean(config.is_confetti_animation);
        document.getElementById('replyComment').checked = Boolean(config.can_reply);
        document.getElementById('editComment').checked = Boolean(config.can_edit);
        document.getElementById('deleteComment').checked = Boolean(config.can_delete);
        document.getElementById('dashboard-tenorkey').value = config.tenor_key || '';

        storage('config').set('tenor_key', config.tenor_key);
        document.dispatchEvent(new Event('undangan.session'));

        // Получаем статистику с сервера
        const stats = await localComments.getStats();
        document.getElementById('count-comment').textContent = String(stats.comments).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        document.getElementById('count-like').textContent = String(stats.likes).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        document.getElementById('count-present').textContent = String(stats.present).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        document.getElementById('count-absent').textContent = String(stats.absent).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

        comment.show();
    };

    /**
     * @param {HTMLElement} checkbox
     * @param {string} type
     * @returns {Promise<void>}
     */
    const changeCheckboxValue = async (checkbox, type) => {
        const label = util.disableCheckbox(checkbox);

        const config = localComments.getConfig();
        config[type] = checkbox.checked;
        await localComments.saveConfig(config);
        label.restore();
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {Promise<void>}
     */
    const tenor = async (button) => {
        const btn = util.disableButton(button);
        const form = document.getElementById('dashboard-tenorkey');
        form.disabled = true;

        const config = localComments.getConfig();
        config.tenor_key = form.value.length ? form.value : null;
        await localComments.saveConfig(config);
        storage('config').set('tenor_key', config.tenor_key);
        util.notify(`Ключ Tenor ${form.value.length ? 'добавлен' : 'удален'}`).success();

        form.disabled = false;
        btn.restore();
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {void}
     */
    const regenerate = (button) => {
        util.notify('Ключ доступа — это ваш токен авторизации. Перелогиньтесь для нового токена.').info();
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {Promise<void>}
     */
    const changePassword = async (button) => {
        const old = document.getElementById('old_password');
        const newest = document.getElementById('new_password');

        if (old.value.length === 0 || newest.value.length === 0) {
            util.notify('Пароль не может быть пустым').warning();
            return;
        }

        old.disabled = true;
        newest.disabled = true;
        const btn = util.disableButton(button);

        try {
            const res = await fetch('/api/auth/password', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.getToken()}`,
                },
                body: JSON.stringify({
                    old_password: old.value,
                    new_password: newest.value,
                }),
            });

            const json = await res.json();

            if (res.ok) {
                old.value = null;
                newest.value = null;
                util.notify('Пароль успешно изменен').success();
            } else {
                util.notify(json.error?.[0] || 'Ошибка').error();
            }
        } catch {
            util.notify('Ошибка подключения к серверу').error();
        }

        old.disabled = false;
        newest.disabled = false;
        btn.restore(true);
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {Promise<void>}
     */
    const changeName = async (button) => {
        const name = document.getElementById('form-name');

        if (name.value.length === 0) {
            util.notify('Имя не может быть пустым').warning();
            return;
        }

        name.disabled = true;
        const btn = util.disableButton(button);

        const config = localComments.getConfig();
        config.name = name.value;
        await localComments.saveConfig(config);

        util.safeInnerHTML(document.getElementById('dashboard-name'), `${util.escapeHtml(name.value)}<i class="fa-solid fa-hands text-warning ms-2"></i>`);
        util.notify('Имя успешно изменено').success();

        name.disabled = false;
        btn.restore(true);
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {void}
     */
    const download = (button) => {
        const btn = util.disableButton(button);
        const token = session.getToken();
        // Скачиваем CSV через прямую ссылку
        const a = document.createElement('a');
        a.href = `/api/comments/export?token=${encodeURIComponent(token)}`;
        a.download = `comments-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        btn.restore();
    };

    /**
     * @returns {void}
     */
    const enableButtonName = () => {
        const btn = document.getElementById('button-change-name');
        if (btn.disabled) {
            btn.disabled = false;
        }
    };

    /**
     * @returns {void}
     */
    const enableButtonPassword = () => {
        const btn = document.getElementById('button-change-password');
        const old = document.getElementById('old_password');
        if (btn.disabled && old.value.length !== 0) {
            btn.disabled = false;
        }
    };

    /**
     * @param {HTMLFormElement} form
     * @param {string|null} [query=null]
     * @returns {void}
     */
    const openLists = (form, query = null) => {
        let timezones = Intl.supportedValuesOf('timeZone');
        const dropdown = document.getElementById('dropdown-tz-list');

        if (form.value && form.value.trim().length > 0) {
            timezones = timezones.filter((tz) => tz.toLowerCase().includes(form.value.trim().toLowerCase()));
        }

        if (query === null) {
            document.addEventListener('click', (e) => {
                if (!form.contains(e.currentTarget) && !dropdown.contains(e.currentTarget)) {
                    if (form.value.trim().length <= 0) {
                        form.setCustomValidity('Часовой пояс не может быть пустым.');
                        form.reportValidity();
                        return;
                    }
                    form.setCustomValidity('');
                    dropdown.classList.add('d-none');
                }
            }, { once: true, capture: true });
        }

        dropdown.replaceChildren();
        dropdown.classList.remove('d-none');

        timezones.slice(0, 20).forEach((tz) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'list-group-item list-group-item-action py-1 small';
            item.textContent = `${tz} (${util.getGMTOffset(tz)})`;
            item.onclick = () => {
                form.value = tz;
                dropdown.classList.add('d-none');
                document.getElementById('button-timezone').disabled = false;
            };
            dropdown.appendChild(item);
        });
    };

    /**
     * @param {HTMLButtonElement} button
     * @returns {Promise<void>}
     */
    const changeTz = async (button) => {
        const tz = document.getElementById('form-timezone');

        if (tz.value.length === 0) {
            util.notify('Часовой пояс не может быть пустым').warning();
            return;
        }

        if (!Intl.supportedValuesOf('timeZone').includes(tz.value)) {
            util.notify('Часовой пояс не поддерживается').warning();
            return;
        }

        tz.disabled = true;
        const btn = util.disableButton(button);

        const config = localComments.getConfig();
        config.tz = tz.value;
        await localComments.saveConfig(config);
        storage('config').set('tz', tz.value);

        util.notify('Часовой пояс успешно изменен').success();

        tz.disabled = false;
        btn.restore(true);
    };

    /**
     * @returns {void}
     */
    const logout = () => {
        if (!util.ask('Вы уверены?')) {
            return;
        }
        session.logout();
        window.location.reload();
    };

    /**
     * @returns {Promise<void>}
     */
    const pageLoaded = async () => {
        lang.init();
        lang.setDefault('ru');

        comment.init();
        offline.init();
        theme.spyTop();

        // Если есть токен — загружаем данные
        if (session.isAdmin()) {
            await getUserStats();
        } else {
            // Показываем модал логина
            const { bs } = await import('../../libs/bootstrap.js');
            bs.modal('mainModal').show();

            // Ждём авторизации
            document.addEventListener('undangan.admin.authenticated', async () => {
                await getUserStats();
            }, { once: true });
        }
    };

    /**
     * @returns {object}
     */
    const init = () => {
        auth.init();
        theme.init();
        session.init();

        window.addEventListener('load', () => {
            try {
                pool.init(pageLoaded, ['gif']);
            } catch {
                pageLoaded();
            }
        });

        return {
            util,
            theme,
            comment,
            admin: {
                auth,
                navbar,
                logout,
                tenor,
                download,
                regenerate,
                changeName,
                changePassword,
                changeCheckboxValue,
                enableButtonName,
                enableButtonPassword,
                openLists,
                changeTz,
            },
        };
    };

    return {
        init,
    };
})();
