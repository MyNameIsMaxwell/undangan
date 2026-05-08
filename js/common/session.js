import { storage } from './storage.js';

export const session = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let ses = null;

    /**
     * @returns {string|null}
     */
    const getToken = () => ses.get('token');

    /**
     * @param {string} token
     * @returns {void}
     */
    const setToken = (token) => ses.set('token', token);

    /**
     * @returns {void}
     */
    const logout = () => ses.unset('token');

    /**
     * @returns {boolean}
     */
    const isAdmin = () => {
        const token = getToken();
        return !!token && String(token).length > 0;
    };

    /**
     * @returns {boolean}
     */
    const isValid = () => isAdmin();

    /**
     * @returns {object|null}
     */
    const decode = () => null;

    /**
     * @returns {void}
     */
    const init = () => {
        ses = storage('session');
    };

    return {
        init,
        isValid,
        logout,
        decode,
        isAdmin,
        setToken,
        getToken,
    };
})();
