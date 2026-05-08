import { storage } from './storage.js';

/**
 * API-клиент для работы с сервером (Express + SQLite)
 */
export const localComments = (() => {

    let cachedConfig = null;

    /**
     * Получить уникальный session_id для лайков
     * @returns {string}
     */
    const getSessionId = () => {
        const store = storage('_sid');
        if (!store.has('id')) {
            store.set('id', Date.now().toString(36) + Math.random().toString(36).substring(2));
        }
        return store.get('id');
    };

    /**
     * Получить заголовки с токеном авторизации (если есть)
     * @returns {object}
     */
    const getAuthHeaders = () => {
        const headers = { 'Content-Type': 'application/json' };
        try {
            const ses = JSON.parse(localStorage.getItem('session') || '{}');
            if (ses.token) {
                headers['Authorization'] = `Bearer ${ses.token}`;
            }
        } catch { /* ignore */ }
        return headers;
    };

    /**
     * Загрузить конфигурацию с сервера (async)
     * @returns {Promise<object>}
     */
    const loadConfig = async () => {
        try {
            const res = await fetch('/api/config');
            const json = await res.json();
            cachedConfig = json.data;
        } catch {
            cachedConfig = getDefaultConfig();
        }
        return cachedConfig;
    };

    /**
     * Конфигурация по умолчанию
     * @returns {object}
     */
    const getDefaultConfig = () => ({
        name: 'Администратор',
        email: 'admin@example.com',
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        is_filter: false,
        is_confetti_animation: true,
        can_reply: true,
        can_edit: true,
        can_delete: true,
        tenor_key: null,
    });

    /**
     * Получить конфигурацию (синхронно, из кэша)
     * Вызывайте loadConfig() перед первым использованием
     * @returns {object}
     */
    const getConfig = () => {
        return cachedConfig || getDefaultConfig();
    };

    /**
     * Сохранить конфигурацию на сервер
     * @param {object} config
     * @returns {Promise<void>}
     */
    const saveConfig = async (config) => {
        try {
            await fetch('/api/config', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(config),
            });
            cachedConfig = { ...cachedConfig, ...config };
        } catch (e) {
            console.error('Failed to save config:', e);
        }
    };

    /**
     * Получить комментарии с пагинацией
     * @param {number} per
     * @param {number} next
     * @returns {Promise<{count: number, lists: Array}>}
     */
    const getComments = (per = 10, next = 0) => {
        return fetch(`/api/comments?per=${per}&next=${next}`)
            .then(r => r.json())
            .then(json => json.data)
            .catch(() => ({ count: 0, lists: [] }));
    };

    /**
     * Добавить комментарий
     * @param {string} name
     * @param {boolean} presence
     * @param {string|null} commentText
     * @param {string|null} gifUrl
     * @param {string|null} parentId
     * @returns {Promise<object|null>}
     */
    const addComment = (name, presence, commentText, gifUrl = null, parentId = null) => {
        let tz = null;
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }

        return fetch('/api/comments', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                name,
                presence,
                comment: commentText,
                gif_url: gifUrl,
                parent_id: parentId,
                timezone: tz,
            }),
        })
            .then(r => {
                if (!r.ok) return null;
                return r.json();
            })
            .then(json => json?.data || null)
            .catch(() => null);
    };

    /**
     * Обновить комментарий
     * @param {string} uuid
     * @param {boolean|null} presence
     * @param {string|null} commentText
     * @param {string|null} gifUrl
     * @returns {Promise<boolean>}
     */
    const updateComment = (uuid, presence, commentText, gifUrl) => {
        const owns = storage('owns');
        return fetch(`/api/comments/${uuid}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                own: owns.has(uuid) ? owns.get(uuid) : null,
                comment: commentText,
                presence,
                gif_url: gifUrl,
            }),
        })
            .then(r => r.ok)
            .catch(() => false);
    };

    /**
     * Удалить комментарий
     * @param {string} uuid
     * @returns {Promise<boolean>}
     */
    const deleteComment = (uuid) => {
        const owns = storage('owns');
        return fetch(`/api/comments/${uuid}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                own: owns.has(uuid) ? owns.get(uuid) : null,
            }),
        })
            .then(r => r.ok)
            .catch(() => false);
    };

    /**
     * Поставить лайк (fire-and-forget)
     * @param {string} uuid
     */
    const incrementLikes = (uuid) => {
        fetch(`/api/comments/${uuid}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: getSessionId() }),
        }).catch(() => { });
    };

    /**
     * Убрать лайк (fire-and-forget)
     * @param {string} uuid
     */
    const decrementLikes = (uuid) => {
        fetch(`/api/comments/${uuid}/like`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: getSessionId() }),
        }).catch(() => { });
    };

    /**
     * Получить статистику
     * @returns {Promise<{comments: number, likes: number, present: number, absent: number}>}
     */
    const getStats = () => {
        return fetch('/api/stats')
            .then(r => r.json())
            .then(json => json.data)
            .catch(() => ({ comments: 0, likes: 0, present: 0, absent: 0 }));
    };

    /**
     * Экспорт комментариев — скачать CSV файл
     * @returns {Promise<string>}
     */
    const exportToCSV = () => {
        return fetch('/api/comments/export', {
            headers: getAuthHeaders(),
        })
            .then(r => r.text())
            .catch(() => 'Ошибка экспорта');
    };

    /**
     * Получить все комментарии (для совместимости)
     * @returns {Promise<Array>}
     */
    const getAllComments = () => {
        return getComments(1000, 0).then(r => r.lists);
    };

    return {
        loadConfig,
        getConfig,
        saveConfig,
        getComments,
        addComment,
        updateComment,
        deleteComment,
        incrementLikes,
        decrementLikes,
        getStats,
        exportToCSV,
        getAllComments,
        getSessionId,
    };
})();
