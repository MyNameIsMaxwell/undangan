import { util } from '../../common/util.js';
import { bs } from '../../libs/bootstrap.js';
import { storage } from '../../common/storage.js';
import { session } from '../../common/session.js';
import { localComments } from '../../common/local-comments.js';

export const auth = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let user = null;

    /**
     * @param {HTMLButtonElement} button
     * @returns {Promise<void>}
     */
    const login = async (button) => {
        button.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

        const btn = util.disableButton(button);
        const formEmail = document.getElementById('loginEmail');
        const formPassword = document.getElementById('loginPassword');

        const email = formEmail.value;
        const password = formPassword.value;

        if (!email || !password) {
            util.notify('Email и пароль обязательны').warning();
            btn.restore();
            return;
        }

        formEmail.disabled = true;
        formPassword.disabled = true;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const json = await res.json();

            if (res.ok && json.data?.token) {
                session.setToken(json.data.token);
                formEmail.value = null;
                formPassword.value = null;
                bs.modal('mainModal').hide();
                // Trigger page reload to load data
                document.dispatchEvent(new Event('undangan.admin.authenticated'));
            } else {
                const msg = json.error?.[0] || 'Ошибка авторизации';
                util.notify(msg).error();
            }
        } catch (e) {
            util.notify('Ошибка подключения к серверу').error();
        }

        btn.restore();
        formEmail.disabled = false;
        formPassword.disabled = false;
    };

    /**
     * @returns {void}
     */
    const clearSession = () => {
        user.clear();
        session.logout();
        bs.modal('mainModal').show();
    };

    /**
     * @returns {Promise<object>}
     */
    const getDetailUser = async () => {
        const token = session.getToken();
        try {
            const res = await fetch('/api/auth/user', {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (!res.ok) {
                throw new Error('Invalid token');
            }

            const json = await res.json();
            const userData = json.data;

            Object.entries(userData).forEach(([k, v]) => user.set(k, v));

            return { code: 200, data: userData };
        } catch {
            // Token invalid — force re-login
            clearSession();
            return { code: 401, data: null };
        }
    };

    /**
     * @returns {ReturnType<typeof storage>|null}
     */
    const getUserStorage = () => user;

    /**
     * @returns {void}
     */
    const init = () => {
        user = storage('user');
    };

    return {
        init,
        login,
        clearSession,
        getDetailUser,
        getUserStorage,
    };
})();
