import { gif } from './gif.js';
import { card } from './card.js';
import { like } from './like.js';
import { util } from '../../common/util.js';
import { pagination } from './pagination.js';
import { dto } from '../../connection/dto.js';
import { lang } from '../../common/language.js';
import { storage } from '../../common/storage.js';
import { session } from '../../common/session.js';
import { localComments } from '../../common/local-comments.js';
import { request, HTTP_GET, HTTP_POST, HTTP_DELETE, HTTP_PUT, HTTP_STATUS_CREATED } from '../../connection/request.js';

export const comment = (() => {

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let owns = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let showHide = null;

    /**
     * @type {HTMLElement|null}
     */
    let comments = null;

    /**
     * @type {string[]}
     */
    const lastRender = [];

    /**
     * @returns {string}
     */
    const onNullComment = () => {
        return `<div class="text-center p-4 mx-0 mt-0 mb-3 bg-theme-auto rounded-4 shadow"><p class="fw-bold p-0 m-0" style="font-size: 0.95rem;">💌 Пока пожеланий нет. Будьте первыми!</p></div>`;
    };

    /**
     * @param {string} id 
     * @param {boolean} disabled 
     * @returns {void}
     */
    const changeActionButton = (id, disabled) => {
        document.querySelector(`[data-button-action="${id}"]`).childNodes.forEach((e) => {
            e.disabled = disabled;
        });
    };

    /**
     * @param {string} id
     * @returns {void}
     */
    const removeInnerForm = (id) => {
        changeActionButton(id, false);
        document.getElementById(`inner-${id}`).remove();
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {void}
     */
    const showOrHide = (button) => {
        const ids = button.getAttribute('data-uuids').split(',');
        const isShow = button.getAttribute('data-show') === 'true';
        const uuid = button.getAttribute('data-uuid');
        const currentShow = showHide.get('show');

        button.setAttribute('data-show', isShow ? 'false' : 'true');
        button.innerText = isShow ? `Скрыть ответы` : `Показать ответы (${ids.length})`;
        showHide.set('show', isShow ? currentShow.filter((i) => i !== uuid) : [...currentShow, uuid]);

        for (const id of ids) {
            showHide.set('hidden', showHide.get('hidden').map((i) => {
                if (i.uuid === id) {
                    i.show = !isShow;
                }

                return i;
            }));

            document.getElementById(id).classList.toggle('d-none', isShow);
        }
    };

    /**
     * @param {HTMLAnchorElement} anchor 
     * @param {string} uuid 
     * @returns {void}
     */
    const showMore = (anchor, uuid) => {
        const content = document.getElementById(`content-${uuid}`);
        const original = util.base64Decode(content.getAttribute('data-comment'));
        const isCollapsed = anchor.getAttribute('data-show') === 'false';

        util.safeInnerHTML(content, util.convertMarkdownToHTML(util.escapeHtml(isCollapsed ? original : original.slice(0, card.maxCommentLength) + '...')));
        anchor.innerText = isCollapsed ? 'Свернуть' : 'Показать полностью';
        anchor.setAttribute('data-show', isCollapsed ? 'true' : 'false');
    };

    /**
     * @param {ReturnType<typeof dto.getCommentResponse>} c
     * @returns {Promise<void>}
     */
    /**
     * fetchTracker удалён - для локального режима не используется IP-отслеживание
     */
    const fetchTracker = async () => { };

    /**
     * @param {ReturnType<typeof dto.getCommentsResponse>} items 
     * @param {ReturnType<typeof dto.commentShowMore>[]} hide 
     * @returns {ReturnType<typeof dto.commentShowMore>[]}
     */
    const traverse = (items, hide = []) => {
        const dataShow = showHide.get('show');

        const buildHide = (lists) => lists.forEach((item) => {
            if (hide.find((i) => i.uuid === item.uuid)) {
                buildHide(item.comments);
                return;
            }

            hide.push(dto.commentShowMore(item.uuid));
            buildHide(item.comments);
        });

        const setVisible = (lists) => lists.forEach((item) => {
            if (!dataShow.includes(item.uuid)) {
                setVisible(item.comments);
                return;
            }

            item.comments.forEach((c) => {
                const i = hide.findIndex((h) => h.uuid === c.uuid);
                if (i !== -1) {
                    hide[i].show = true;
                }
            });

            setVisible(item.comments);
        });

        buildHide(items);
        setVisible(items);

        return hide;
    };

    /**
     * @returns {Promise<ReturnType<typeof dto.getCommentsResponse>>}
     */
    const show = () => {

        // remove all event listener.
        lastRender.forEach((u) => {
            like.removeListener(u);
        });

        if (comments.getAttribute('data-loading') === 'false') {
            comments.setAttribute('data-loading', 'true');
            comments.innerHTML = card.renderLoading().repeat(pagination.getPer());
        }

        return localComments.getComments(pagination.getPer(), pagination.getNext())
            .then(async (res) => {
                comments.setAttribute('data-loading', 'false');

                for (const u of lastRender) {
                    await gif.remove(u);
                }

                if (res.lists.length === 0) {
                    comments.innerHTML = onNullComment();
                    return { data: res };
                }

                const flatten = (ii) => ii.flatMap((i) => [i.uuid, ...flatten(i.comments || [])]);
                lastRender.splice(0, lastRender.length, ...flatten(res.lists));
                showHide.set('hidden', traverse(res.lists, showHide.get('hidden')));

                let data = await card.renderContentMany(res.lists);

                util.safeInnerHTML(comments, data);

                lastRender.forEach((u) => {
                    like.addListener(u);
                });

                return { data: res };
            })
            .then(async (res) => {
                comments.dispatchEvent(new Event('undangan.comment.result'));

                pagination.setTotal(res.data.count);
                comments.dispatchEvent(new Event('undangan.comment.done'));
                return res;
            });
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const remove = async (button) => {
        if (!util.ask('Вы уверены?')) {
            return;
        }

        const id = button.getAttribute('data-uuid');

        if (session.isAdmin()) {
            owns.set(id, button.getAttribute('data-own'));
        }

        changeActionButton(id, true);
        const btn = util.disableButton(button);
        const likes = like.getButtonLike(id);
        likes.disabled = true;

        // Используем локальное хранилище вместо API
        const status = await localComments.deleteComment(id);

        if (!status) {
            btn.restore();
            likes.disabled = false;
            changeActionButton(id, false);
            return;
        }

        document.querySelectorAll('a[onclick="undangan.comment.showOrHide(this)"]').forEach((n) => {
            const oldUuids = n.getAttribute('data-uuids').split(',');

            if (oldUuids.includes(id)) {
                const uuids = oldUuids.filter((i) => i !== id).join(',');
                uuids.length === 0 ? n.remove() : n.setAttribute('data-uuids', uuids);
            }
        });

        owns.unset(id);
        document.getElementById(id).remove();

        if (comments.children.length === 0) {
            comments.innerHTML = onNullComment();
        }
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const update = async (button) => {
        const id = button.getAttribute('data-uuid');

        let isPresent = false;
        const presence = document.getElementById(`form-inner-presence-${id}`);
        if (presence) {
            presence.disabled = true;
            isPresent = presence.value === '1';
        }

        const badge = document.getElementById(`badge-${id}`);
        const isChecklist = !!badge && badge.getAttribute('data-is-presence') === 'true';

        const gifIsOpen = gif.isOpen(id);
        const gifId = gif.getResultId(id);
        const gifCancel = gif.buttonCancel(id);

        if (gifIsOpen && gifId) {
            gifCancel.hide();
        }

        const form = document.getElementById(`form-inner-${id}`);

        if (id && !gifIsOpen && util.base64Encode(form.value) === form.getAttribute('data-original') && isChecklist === isPresent) {
            removeInnerForm(id);
            return;
        }

        if (!gifIsOpen && form.value?.trim().length === 0) {
            util.notify('Комментарий не может быть пустым.').warning();
            return;
        }

        if (form) {
            form.disabled = true;
        }

        const cancel = document.querySelector(`[onclick="undangan.comment.cancel(this, '${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);

        // Используем локальное хранилище вместо API
        const gifUrl = gifIsOpen && gifId ? await gif.get(gifId) : null;
        const status = await localComments.updateComment(
            id,
            presence ? isPresent : null,
            gifIsOpen ? null : form.value,
            gifUrl
        );

        if (form) {
            form.disabled = false;
        }

        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        btn.restore();

        if (gifIsOpen && gifId) {
            gifCancel.show();
        }

        if (!status) {
            return;
        }

        if (gifIsOpen && gifId) {
            document.getElementById(`img-gif-${id}`).src = document.getElementById(`gif-result-${id}`)?.querySelector('img').src;
            gifCancel.click();
        }

        removeInnerForm(id);

        if (!gifIsOpen) {
            const showButton = document.querySelector(`[onclick="undangan.comment.showMore(this, '${id}')"]`);

            const content = document.getElementById(`content-${id}`);
            content.setAttribute('data-comment', util.base64Encode(form.value));

            const original = util.convertMarkdownToHTML(util.escapeHtml(form.value));
            if (form.value.length > card.maxCommentLength) {
                util.safeInnerHTML(content, showButton?.getAttribute('data-show') === 'false' ? original.slice(0, card.maxCommentLength) + '...' : original);
                showButton?.classList.replace('d-none', 'd-block');
            } else {
                util.safeInnerHTML(content, original);
                showButton?.classList.replace('d-block', 'd-none');
            }
        }

        if (presence) {
            document.getElementById('form-presence').value = isPresent ? '1' : '2';
            storage('information').set('presence', isPresent);
        }

        if (!presence || !badge) {
            return;
        }

        badge.classList.toggle('fa-circle-xmark', !isPresent);
        badge.classList.toggle('text-danger', !isPresent);

        badge.classList.toggle('fa-circle-check', isPresent);
        badge.classList.toggle('text-success', isPresent);
    };

    /**
     * @param {HTMLButtonElement} button 
     * @returns {Promise<void>}
     */
    const send = async (button) => {
        const id = button.getAttribute('data-uuid');

        const name = document.getElementById('form-name');
        const name2 = document.getElementById('form-name-2');
        let nameValue = name.value;

        if (nameValue.length === 0) {
            util.notify('Имя не может быть пустым.').warning();

            if (id) {
                // scroll to form.
                name.scrollIntoView({ block: 'center' });
            }
            return;
        }

        // Если указано имя спутника, объединяем
        if (name2 && name2.value.trim().length > 0) {
            nameValue = `${nameValue} и ${name2.value.trim()}`;
        }

        const presence = document.getElementById('form-presence');
        if (!id && presence && presence.value === '0') {
            util.notify('Пожалуйста, выберите статус присутствия.').warning();
            return;
        }

        const gifIsOpen = gif.isOpen(id ? id : gif.default);
        const gifId = gif.getResultId(id ? id : gif.default);
        const gifCancel = gif.buttonCancel(id);

        if (gifIsOpen && !gifId) {
            util.notify('GIF не может быть пустым.').warning();
            return;
        }

        if (gifIsOpen && gifId) {
            gifCancel.hide();
        }

        const form = document.getElementById(`form-${id ? `inner-${id}` : 'comment'}`);
        // Комментарий теперь необязателен — можно просто подтвердить присутствие

        if (!id && name && !session.isAdmin()) {
            name.disabled = true;
        }

        if (!session.isAdmin() && presence && presence.value !== '0') {
            presence.disabled = true;
        }

        if (form) {
            form.disabled = true;
        }

        const cancel = document.querySelector(`[onclick="undangan.comment.cancel(this, '${id}')"]`);
        if (cancel) {
            cancel.disabled = true;
        }

        const btn = util.disableButton(button);
        const isPresence = presence ? presence.value === '1' : true;

        if (!session.isAdmin()) {
            const info = storage('information');
            info.set('name', name.value);  // ← store only the first name field value

            if (name2 && name2.value.trim().length > 0) {
                info.set('name2', name2.value.trim());
            }

            if (!id) {
                info.set('presence', isPresence);
            }
        }

        // Используем локальное хранилище вместо API
        const gifUrl = gifIsOpen && gifId ? await gif.get(gifId) : null;
        const commentText = gifIsOpen ? null : (form.value?.trim().length > 0 ? form.value : '');
        const response = await localComments.addComment(
            nameValue,
            isPresence,
            commentText,
            gifUrl,
            id
        );

        if (name) {
            name.disabled = false;
        }

        if (form) {
            form.disabled = false;
        }

        if (cancel) {
            cancel.disabled = false;
        }

        if (presence) {
            presence.disabled = false;
        }

        if (gifIsOpen && gifId) {
            gifCancel.show();
        }

        btn.restore();

        if (!response) {
            return;
        }

        owns.set(response.uuid, response.own);

        if (form) {
            form.value = null;
        }

        if (gifIsOpen && gifId) {
            gifCancel.click();
        }

        if (!id) {
            if (pagination.reset()) {
                await show();
                comments.scrollIntoView();
                return;
            }

            pagination.setTotal(pagination.geTotal() + 1);
            if (comments.children.length === pagination.getPer()) {
                comments.lastElementChild.remove();
            }

            response.is_parent = true;
            response.is_admin = session.isAdmin();
            comments.insertAdjacentHTML('afterbegin', await card.renderContentMany([response]));
            comments.scrollIntoView();
        }

        if (id) {
            showHide.set('hidden', showHide.get('hidden').concat([dto.commentShowMore(response.uuid, true)]));
            showHide.set('show', showHide.get('show').concat([id]));

            removeInnerForm(id);

            response.is_parent = false;
            response.is_admin = session.isAdmin();
            document.getElementById(`reply-content-${id}`).insertAdjacentHTML('beforeend', await card.renderContentSingle(response));

            const anchorTag = document.getElementById(`button-${id}`).querySelector('a');
            if (anchorTag) {
                if (anchorTag.getAttribute('data-show') === 'false') {
                    showOrHide(anchorTag);
                }

                anchorTag.remove();
            }

            const uuids = [response.uuid];
            const readMoreElement = document.createRange().createContextualFragment(card.renderReadMore(id, anchorTag ? anchorTag.getAttribute('data-uuids').split(',').concat(uuids) : uuids));

            const buttonLike = like.getButtonLike(id);
            buttonLike.parentNode.insertBefore(readMoreElement, buttonLike);
        }

        like.addListener(response.uuid);
        lastRender.push(response.uuid);
    };

    /**
     * @param {HTMLButtonElement} button
     * @param {string} id
     * @returns {Promise<void>}
     */
    const cancel = async (button, id) => {
        const presence = document.getElementById(`form-inner-presence-${id}`);
        const isPresent = presence ? presence.value === '1' : false;

        const badge = document.getElementById(`badge-${id}`);
        const isChecklist = badge && owns.has(id) && presence ? badge.getAttribute('data-is-presence') === 'true' : false;

        const btn = util.disableButton(button);

        if (gif.isOpen(id) && ((!gif.getResultId(id) && isChecklist === isPresent) || util.ask('Are you sure?'))) {
            await gif.remove(id);
            removeInnerForm(id);
            return;
        }

        const form = document.getElementById(`form-inner-${id}`);
        if (form.value.length === 0 || (util.base64Encode(form.value) === form.getAttribute('data-original') && isChecklist === isPresent) || util.ask('Are you sure?')) {
            removeInnerForm(id);
            return;
        }

        btn.restore();
    };

    /**
     * @param {string} uuid 
     * @returns {void}
     */
    const reply = (uuid) => {
        changeActionButton(uuid, true);

        gif.remove(uuid).then(() => {
            gif.onOpen(uuid, () => gif.removeGifSearch(uuid));
            document.getElementById(`button-${uuid}`).insertAdjacentElement('afterend', card.renderReply(uuid));
        });
    };

    /**
     * @param {HTMLButtonElement} button 
     * @param {boolean} is_parent
     * @returns {Promise<void>}
     */
    const edit = async (button, is_parent) => {
        const id = button.getAttribute('data-uuid');

        changeActionButton(id, true);

        if (session.isAdmin()) {
            owns.set(id, button.getAttribute('data-own'));
        }

        const badge = document.getElementById(`badge-${id}`);
        const isChecklist = !!badge && badge.getAttribute('data-is-presence') === 'true';

        const gifImage = document.getElementById(`img-gif-${id}`);
        if (gifImage) {
            await gif.remove(id);
        }

        const isParent = is_parent && !session.isAdmin();
        document.getElementById(`button-${id}`).insertAdjacentElement('afterend', card.renderEdit(id, isChecklist, isParent, !!gifImage));

        if (gifImage) {
            gif.onOpen(id, () => {
                gif.removeGifSearch(id);
                gif.removeButtonBack(id);
            });

            await gif.open(id);
            return;
        }

        const formInner = document.getElementById(`form-inner-${id}`);
        const original = util.base64Decode(document.getElementById(`content-${id}`)?.getAttribute('data-comment'));

        formInner.value = original;
        formInner.setAttribute('data-original', util.base64Encode(original));
    };

    /**
     * @returns {void}
     */
    const init = () => {
        gif.init();
        like.init();
        card.init();
        pagination.init();

        comments = document.getElementById('comments');
        comments.addEventListener('undangan.comment.show', show);

        owns = storage('owns');
        showHide = storage('comment');

        if (!showHide.has('hidden')) {
            showHide.set('hidden', []);
        }

        if (!showHide.has('show')) {
            showHide.set('show', []);
        }
    };

    return {
        gif,
        like,
        pagination,
        init,
        send,
        edit,
        reply,
        remove,
        update,
        cancel,
        show,
        showMore,
        showOrHide,
    };
})();