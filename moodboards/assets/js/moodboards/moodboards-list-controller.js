import { createMoodboardTemplate, getMoodboardTemplates } from './moodboard-templates.js';
import {
    collectDocumentAssetIds,
    dataUrlToBlob,
    replaceDocumentAssetIds,
} from '../editor/project-json-transfer.js';

const TITLE_MAX_LENGTH = 160;
const EVENT_NAMESPACE = '.moodboardsList';

export function normalizeMoodboardTitle(value) {
    if (typeof value !== 'string') {
        throw new TypeError('Название должно быть строкой.');
    }
    const title = value.trim();
    if (title.length === 0) {
        throw new Error('Введите название мудборда.');
    }
    if (title.length > TITLE_MAX_LENGTH) {
        throw new Error(`Название не должно превышать ${TITLE_MAX_LENGTH} символов.`);
    }
    return title;
}

export function buildDefaultMoodboardTitle(projectCount) {
    const normalizedCount = Number.isInteger(projectCount) && projectCount >= 0
        ? projectCount
        : 0;
    return `Новый проект ${normalizedCount + 1}`;
}

export function sortMoodboards(records) {
    return [...records].sort((left, right) => (
        String(right.updatedAt).localeCompare(String(left.updatedAt))
    ));
}

export function buildEditorUrl(editorRoute, moodboardId) {
    const separator = editorRoute.includes('?') ? '&' : '?';
    return `${editorRoute}${separator}id=${encodeURIComponent(moodboardId)}`;
}

export function buildViewerUrl(viewerRoute, moodboardId, origin = window.location.origin) {
    const url = new URL(viewerRoute, origin);
    url.searchParams.set('token', moodboardId);
    return url.toString();
}

export function normalizeMoodboardPreviewUrl(value, baseUrl = globalThis.location?.href || 'http://localhost/') {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    try {
        const url = new URL(value.trim(), baseUrl);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (_) {
        return null;
    }
}

export function resolveMoodboardPreviewSource(record, {
    baseUrl = globalThis.location?.href || 'http://localhost/',
    createObjectUrl = (blob) => URL.createObjectURL(blob),
} = {}) {
    if (typeof Blob !== 'undefined' && record?.previewBlob instanceof Blob && record.previewBlob.size > 0) {
        return { src: createObjectUrl(record.previewBlob), objectUrl: true };
    }
    const previewUrl = normalizeMoodboardPreviewUrl(record?.previewUrl, baseUrl);
    return previewUrl
        ? { src: previewUrl, objectUrl: false }
        : { src: null, objectUrl: false };
}

export async function persistMoodboardTemplate(repository, template) {
    let record = null;
    try {
        record = await repository.create({
            title: template.title,
            document: template.document,
        });
        const embeddedAssets = new Map(
            (template.assets || []).map((asset) => [asset.sourceId, asset]),
        );
        const assetIdMap = new Map();
        for (const sourceId of collectDocumentAssetIds(template.document)) {
            const embedded = embeddedAssets.get(sourceId);
            if (!embedded) {
                throw new Error(`В шаблоне отсутствует изображение ${sourceId}.`);
            }
            const stored = await repository.addAsset(record.id, dataUrlToBlob(embedded.dataUrl));
            assetIdMap.set(sourceId, stored.id);
        }
        if (assetIdMap.size === 0) {
            return record;
        }
        const document = replaceDocumentAssetIds(template.document, assetIdMap);
        return repository.saveContent(record.id, document, record.revision);
    } catch (error) {
        if (record?.id) {
            await Promise.allSettled([repository.delete(record.id)]);
        }
        throw error;
    }
}

export class MoodboardsListController {
    constructor({ $, root, repository, config, accessPolicy = null, navigate = (url) => window.location.assign(url) }) {
        this.$ = $;
        this.root = root;
        this.$root = $(root);
        this.$emptyState = this.$root.find('[data-role="empty-state"]').detach();
        this.$archiveEmpty = this.$root.find('[data-role="archive-empty"]').detach();
        this.repository = repository;
        this.config = config;
        this.accessPolicy = accessPolicy;
        this.navigate = navigate;
        this.records = new Map();
        this.cardIds = new WeakMap();
        this.previewUrls = [];
        this.activeModal = null;
        this.activeMoodboardId = null;
        this.pendingIds = new Set();
        this.createPending = false;
        this.notificationTimers = new Set();
        this.previousFocus = null;
        this.dateFormatter = new Intl.DateTimeFormat('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    async init() {
        this.bindEvents();
        await this.load();
    }

    bindEvents() {
        this.$root.off(EVENT_NAMESPACE);
        this.$(document).off(EVENT_NAMESPACE);

        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="create-moodboard"]', (event) => {
            event.preventDefault();
            this.createMoodboard();
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="open-templates"]', (event) => {
            event.preventDefault();
            this.openTemplatesModal();
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="create-from-template"]', (event) => {
            event.preventDefault();
            this.createFromTemplate(event.currentTarget.dataset.templateId);
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="header-placeholder"]', (event) => {
            event.preventDefault();
            const message = String(event.currentTarget.dataset.message || '').trim();
            this.notify(message || 'Функция появится после интеграции с RoomPlan.', 'info');
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="open-moodboard"]', (event) => {
            event.preventDefault();
            const id = this._getMoodboardId(event.currentTarget);
            if (id) {
                this.navigate(buildEditorUrl(this.config.routes.editor, id));
            }
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="rename-moodboard"]', (event) => {
            event.preventDefault();
            this.openRenameModal(this._getMoodboardId(event.currentTarget));
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="duplicate-moodboard"]', (event) => {
            event.preventDefault();
            this.duplicateMoodboard(this._getMoodboardId(event.currentTarget));
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="share-moodboard"]', (event) => {
            event.preventDefault();
            this.shareMoodboard(this._getMoodboardId(event.currentTarget));
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="archive-moodboard"]', (event) => {
            event.preventDefault();
            this.setMoodboardArchived(this._getMoodboardId(event.currentTarget), true);
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="restore-moodboard"]', (event) => {
            event.preventDefault();
            this.setMoodboardArchived(this._getMoodboardId(event.currentTarget), false);
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="delete-moodboard"]', (event) => {
            event.preventDefault();
            this.openDeleteModal(this._getMoodboardId(event.currentTarget));
        });
        this.$root.on(`pointerenter${EVENT_NAMESPACE}`, '.moodboard-card__context-menu', (event) => {
            this.$(event.currentTarget).removeClass('moodboard-card__context-menu--dismissed');
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '.moodboard-card__context-trigger', (event) => {
            event.preventDefault();
            this.$(event.currentTarget)
                .closest('.moodboard-card__context-menu')
                .removeClass('moodboard-card__context-menu--dismissed');
        });
        this.$root.on(`focusout${EVENT_NAMESPACE}`, '.moodboard-card__context-menu', (event) => {
            const $contextMenu = this.$(event.currentTarget);
            requestAnimationFrame(() => {
                if (!$contextMenu.get(0)?.contains(document.activeElement)) {
                    $contextMenu.removeClass('moodboard-card__context-menu--dismissed');
                }
            });
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '.moodboard-card__context-item', (event) => {
            const $contextMenu = this.$(event.currentTarget).closest('.moodboard-card__context-menu');
            const trigger = $contextMenu.find('.moodboard-card__context-trigger').get(0);
            $contextMenu.addClass('moodboard-card__context-menu--dismissed');
            if (this.activeModal) {
                this.previousFocus = trigger;
            } else {
                trigger?.focus();
            }
        });
        this.$root.on(`keydown${EVENT_NAMESPACE}`, '.moodboard-card__context-menu', (event) => {
            this._handleCardContextKeyboard(event);
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="close-modal"]', () => this.closeModal());
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="retry-list"]', () => this.load());
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-action="dismiss-notification"]', (event) => {
            this.$(event.currentTarget).closest('.notification').remove();
        });
        this.$root.on(`submit${EVENT_NAMESPACE}`, '[data-role="rename-form"]', (event) => {
            event.preventDefault();
            this.renameMoodboard();
        });
        this.$root.on(`submit${EVENT_NAMESPACE}`, '[data-role="delete-form"]', (event) => {
            event.preventDefault();
            this.deleteMoodboard();
        });
        this.$root.on(`click${EVENT_NAMESPACE}`, '[data-role="modal"]', (event) => {
            if (event.target === event.currentTarget) {
                this.closeModal();
            }
        });
        this.$(document).on(`keydown${EVENT_NAMESPACE}`, (event) => {
            if (event.key === 'Escape' && this.activeModal) {
                this.closeModal();
                return;
            }
            if (event.key === 'Tab' && this.activeModal) {
                this._trapModalFocus(event);
            }
        });
    }

    async load({ showLoading = true } = {}) {
        if (showLoading) {
            this._showState('loading');
        }
        this._setListControlsDisabled(true);

        try {
            const records = sortMoodboards(await this.repository.list());
            this.records = new Map(records.map((record) => [record.id, record]));
            this.renderCards(records);
            this._showState('grid');
        } catch (error) {
            this._showState('error');
            this.notify(error.message || 'Не удалось загрузить список мудбордов.', 'error');
        } finally {
            this._setListControlsDisabled(false);
        }
    }

    renderCards(records) {
        this._revokePreviewUrls();
        const activeRecords = records.filter((record) => record.archivedAt === null);
        const archivedRecords = records.filter((record) => record.archivedAt !== null);
        const $activeGrid = this.$root.find('[data-role="active-grid"]').empty();
        const $archiveGrid = this.$root.find('[data-role="archive-grid"]').empty();
        this.cardIds = new WeakMap();
        $activeGrid.append(this._createNewMoodboardCard());

        for (const record of activeRecords) {
            $activeGrid.append(this._createMoodboardCard(record));
        }
        for (const record of archivedRecords) {
            $archiveGrid.append(this._createMoodboardCard(record, { archived: true }));
        }

        if (activeRecords.length === 0) {
            this.$emptyState.prop('hidden', false).appendTo($activeGrid);
        } else {
            this.$emptyState.detach().prop('hidden', true);
        }
        if (archivedRecords.length === 0) {
            this.$archiveEmpty.prop('hidden', false).appendTo($archiveGrid);
        } else {
            this.$archiveEmpty.detach().prop('hidden', true);
        }
        this.$root.find('[data-role="archive-count"]').text(String(archivedRecords.length));
    }

    async createMoodboard() {
        if (this.createPending) {
            return;
        }
        if (this._isMoodboardLimitReached()) {
            this._notifyMoodboardLimit();
            return;
        }
        this.createPending = true;
        this._setListControlsDisabled(true);
        this.$root.find('[data-action="create-moodboard"]').attr('aria-busy', 'true');

        try {
            const record = await this.repository.create({
                title: buildDefaultMoodboardTitle(this.records.size),
            });
            this.navigate(buildEditorUrl(this.config.routes.editor, record.id));
        } catch (error) {
            this.notify(error.message || 'Не удалось создать мудборд.', 'error');
        } finally {
            this.createPending = false;
            this._setListControlsDisabled(false);
            this.$root.find('[data-action="create-moodboard"]').removeAttr('aria-busy');
        }
    }

    openRenameModal(id) {
        const record = this.records.get(id);
        if (!record || this.pendingIds.has(id)) {
            return;
        }
        this.activeMoodboardId = id;
        const $modal = this.$root.find('[data-modal="rename"]');
        const $input = $modal.find('[data-role="rename-input"]');
        $modal.find('[data-role="form-error"]').text('');
        $input.val(record.title).attr('aria-invalid', 'false');
        this._showModal($modal);
        requestAnimationFrame(() => $input.trigger('focus').trigger('select'));
    }

    async renameMoodboard() {
        const id = this.activeMoodboardId;
        const $modal = this.$root.find('[data-modal="rename"]');
        const $error = $modal.find('[data-role="form-error"]');
        let title;

        try {
            title = normalizeMoodboardTitle(String($modal.find('[data-role="rename-input"]').val() ?? ''));
        } catch (error) {
            $error.text(error.message);
            $modal.find('[data-role="rename-input"]')
                .attr('aria-invalid', 'true')
                .trigger('focus');
            return;
        }
        if (!id || this.pendingIds.has(id)) {
            return;
        }

        this.pendingIds.add(id);
        this._setModalBusy($modal, true);
        try {
            await this.repository.updateMeta(id, { title });
            $modal.find('[data-role="rename-input"]').attr('aria-invalid', 'false');
            this.closeModal(true);
            await this.load({ showLoading: false });
            this.notify('Название обновлено.', 'success');
        } catch (error) {
            $error.text(error.message || 'Не удалось переименовать мудборд.');
        } finally {
            this.pendingIds.delete(id);
            this._setModalBusy($modal, false);
        }
    }

    async duplicateMoodboard(id) {
        if (!id || this.pendingIds.has(id)) {
            return;
        }
        if (this._isMoodboardLimitReached()) {
            this._notifyMoodboardLimit();
            return;
        }
        this.pendingIds.add(id);
        this._setCardBusy(id, true);
        try {
            await this.repository.duplicate(id);
            await this.load({ showLoading: false });
            this.notify('Копия мудборда создана.', 'success');
        } catch (error) {
            this.notify(error.message || 'Не удалось дублировать мудборд.', 'error');
        } finally {
            this.pendingIds.delete(id);
            this._setCardBusy(id, false);
        }
    }

    openTemplatesModal() {
        if (this.createPending) {
            return;
        }
        if (this._isMoodboardLimitReached()) {
            this._notifyMoodboardLimit();
            return;
        }
        const $modal = this.$root.find('[data-modal="templates"]');
        $modal.find('[data-role="form-error"]').text('');
        this._renderTemplateCards();
        this._showModal($modal);
        requestAnimationFrame(() => $modal.find('[data-action="create-from-template"]').first().trigger('focus'));
    }

    async createFromTemplate(templateId) {
        if (this.createPending) {
            return;
        }
        if (this._isMoodboardLimitReached()) {
            this.closeModal(true);
            this._notifyMoodboardLimit();
            return;
        }
        const $modal = this.$root.find('[data-modal="templates"]');
        const $error = $modal.find('[data-role="form-error"]');
        const normalizedTemplateId = String(templateId || '');
        this.createPending = true;
        this._setListControlsDisabled(true);
        this._setModalBusy($modal, true);
        $modal.find(`[data-template-id="${normalizedTemplateId}"]`).attr('aria-busy', 'true');
        try {
            const template = await createMoodboardTemplate(normalizedTemplateId);
            const record = await persistMoodboardTemplate(this.repository, template);
            this.navigate(buildEditorUrl(this.config.routes.editor, record.id));
        } catch (error) {
            $error.text(error.message || 'Не удалось создать мудборд из шаблона.');
        } finally {
            this.createPending = false;
            this._setModalBusy($modal, false);
            this._setListControlsDisabled(false);
            $modal.find('[data-action="create-from-template"]').removeAttr('aria-busy');
        }
    }

    async shareMoodboard(id) {
        const record = this.records.get(id);
        if (!record || record.archivedAt !== null || this.pendingIds.has(id)) {
            return;
        }

        this.pendingIds.add(id);
        this._setCardBusy(id, true);
        try {
            const viewerRoute = this.config.routes.viewer || '/moodboards/view.php';
            const publicUrl = buildViewerUrl(viewerRoute, id);
            await this._copyText(publicUrl);
            this.notify('Публичная ссылка скопирована. Она открывает мудборд только для просмотра.', 'success');
        } catch (error) {
            this.notify(error.message || 'Не удалось скопировать публичную ссылку.', 'error');
        } finally {
            this.pendingIds.delete(id);
            this._setCardBusy(id, false);
        }
    }

    async setMoodboardArchived(id, archived) {
        const record = this.records.get(id);
        if (
            !record
            || this.pendingIds.has(id)
            || (record.archivedAt !== null) === archived
        ) {
            return;
        }

        this.pendingIds.add(id);
        this._setCardBusy(id, true);
        try {
            await this.repository.setArchived(id, archived);
            await this.load({ showLoading: false });
            this.notify(
                archived ? 'Мудборд перемещён в архив.' : 'Мудборд восстановлен из архива.',
                'success',
            );
        } catch (error) {
            this.notify(
                error.message || (archived
                    ? 'Не удалось переместить мудборд в архив.'
                    : 'Не удалось восстановить мудборд.'),
                'error',
            );
        } finally {
            this.pendingIds.delete(id);
            this._setCardBusy(id, false);
        }
    }

    openDeleteModal(id) {
        const record = this.records.get(id);
        if (!record || record.archivedAt === null || this.pendingIds.has(id)) {
            return;
        }
        this.activeMoodboardId = id;
        const $modal = this.$root.find('[data-modal="delete"]');
        $modal.find('[data-role="delete-name"]').text(record.title);
        $modal.find('[data-role="form-error"]').text('');
        this._showModal($modal);
        requestAnimationFrame(() => $modal.find('[data-action="confirm-delete"]').trigger('focus'));
    }

    async deleteMoodboard() {
        const id = this.activeMoodboardId;
        const $modal = this.$root.find('[data-modal="delete"]');
        if (!id || this.pendingIds.has(id)) {
            return;
        }

        this.pendingIds.add(id);
        this._setModalBusy($modal, true);
        try {
            await this.repository.delete(id);
            this.closeModal(true);
            await this.load({ showLoading: false });
            this.notify('Мудборд удалён навсегда.', 'success');
        } catch (error) {
            $modal.find('[data-role="form-error"]').text(error.message || 'Не удалось удалить мудборд.');
        } finally {
            this.pendingIds.delete(id);
            this._setModalBusy($modal, false);
        }
    }

    closeModal(force = false) {
        const templateCreationPending = this.createPending
            && this.activeModal?.is('[data-modal="templates"]');
        if (
            !this.activeModal
            || (!force && templateCreationPending)
            || (!force && this.activeMoodboardId && this.pendingIds.has(this.activeMoodboardId))
        ) {
            return;
        }
        this.activeModal.prop('hidden', true).attr('aria-hidden', 'true');
        const focusTarget = this.previousFocus;
        this.activeModal = null;
        this.activeMoodboardId = null;
        this.previousFocus = null;
        this.$('body').removeClass('modal-open');
        if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
            requestAnimationFrame(() => focusTarget.focus());
        }
    }

    notify(message, type = 'error') {
        const $notification = this.$('<div>', {
            class: `notification notification--${type}`,
            role: type === 'error' ? 'alert' : 'status',
        });
        this.$('<span>').text(message).appendTo($notification);
        this.$('<button>', {
            class: 'notification__close',
            type: 'button',
            'data-action': 'dismiss-notification',
            'aria-label': 'Закрыть уведомление',
        }).text('×').appendTo($notification);
        this.$root.find('[data-role="notifications"]').append($notification);
        const timer = window.setTimeout(() => {
            $notification.remove();
            this.notificationTimers.delete(timer);
        }, 4200);
        this.notificationTimers.add(timer);
    }

    destroy() {
        this.$root.off(EVENT_NAMESPACE);
        this.$(document).off(EVENT_NAMESPACE);
        this._revokePreviewUrls();
        for (const timer of this.notificationTimers) {
            window.clearTimeout(timer);
        }
        this.notificationTimers.clear();
        this.previousFocus = null;
        this.repository.close?.();
    }

    _getMoodboardId(element) {
        const card = this.$(element).closest('.moodboard-card').get(0);
        return this.cardIds.get(element) || this.cardIds.get(card) || null;
    }

    _createPreviewPlaceholder() {
        const $placeholder = this.$('<div>', {
            class: 'moodboard-card__placeholder',
            'aria-hidden': 'true',
        });
        this.$('<span>', { class: 'moodboard-card__shape moodboard-card__shape--one' }).appendTo($placeholder);
        this.$('<span>', { class: 'moodboard-card__shape moodboard-card__shape--two' }).appendTo($placeholder);
        this.$('<span>', { class: 'moodboard-card__shape moodboard-card__shape--three' }).appendTo($placeholder);
        return $placeholder;
    }

    _createMoodboardCard(record, { archived = false } = {}) {
        const cardClass = archived ? 'moodboard-card moodboard-card--archived' : 'moodboard-card';
        const $card = this.$('<article>', { class: cardClass, role: 'listitem' });
        const openAttributes = archived
            ? {
                class: 'moodboard-card__open moodboard-card__open--static',
                role: 'group',
                'aria-label': `Архивный мудборд «${record.title}»`,
            }
            : {
                class: 'moodboard-card__open',
                href: buildEditorUrl(this.config.routes.editor, record.id),
                'data-action': 'open-moodboard',
                'aria-label': `Открыть мудборд «${record.title}»`,
            };
        const $open = this.$(archived ? '<div>' : '<a>', openAttributes);
        const $preview = this.$('<div>', { class: 'moodboard-card__preview' });

        const previewSource = resolveMoodboardPreviewSource(record);
        if (previewSource.objectUrl) {
            this.previewUrls.push(previewSource.src);
        }
        if (previewSource.src) {
            const $image = this.$('<img>', {
                src: previewSource.src,
                alt: '',
                loading: 'lazy',
                decoding: 'async',
                referrerpolicy: 'no-referrer',
            });
            $image.one('error', () => {
                $image.remove();
                if ($preview.find('.moodboard-card__placeholder').length === 0) {
                    this._createPreviewPlaceholder().prependTo($preview);
                }
            });
            $image.appendTo($preview);
        } else {
            this._createPreviewPlaceholder().appendTo($preview);
        }
        if (archived) {
            this.$('<span>', {
                class: 'moodboard-card__archive-badge',
            }).text('Архив').appendTo($preview);
        }

        const $body = this.$('<div>', { class: 'moodboard-card__body' });
        this.$('<h2>', {
            class: 'moodboard-card__title',
            title: record.title,
        }).text(record.title).appendTo($body);
        const dateValue = archived ? record.archivedAt : record.updatedAt;
        const dateLabel = archived ? 'В архиве' : 'Изменён';
        this.$('<time>', {
            class: 'moodboard-card__date',
            datetime: dateValue,
        }).text(`${dateLabel} ${this._formatDate(dateValue)}`).appendTo($body);
        $open.append($preview, $body);

        const $contextMenu = this.$('<div>', {
            class: 'moodboard-card__context-menu',
        });
        this.$('<button>', {
            class: 'moodboard-card__context-trigger',
            type: 'button',
            'aria-label': `Действия с мудбордом «${record.title}»`,
            'aria-haspopup': 'menu',
        }).text('⋯').appendTo($contextMenu);
        const $menu = this.$('<div>', {
            class: 'moodboard-card__context-popup',
            role: 'menu',
            'aria-label': `Действия с мудбордом «${record.title}»`,
        });
        if (archived) {
            this._createActionButton('restore-moodboard', 'Восстановить', '↥').appendTo($menu);
            this._createActionButton('delete-moodboard', 'Удалить навсегда', '×', true).appendTo($menu);
        } else {
            this._createActionButton('open-moodboard', 'Открыть мудборд', '↗').appendTo($menu);
            this._createActionButton('rename-moodboard', 'Переименовать', '✎').appendTo($menu);
            this._createActionButton('duplicate-moodboard', 'Дублировать', '⧉').appendTo($menu);
            this._createActionButton(
                'share-moodboard',
                'Поделиться проектом',
                '⌁',
            ).appendTo($menu);
            this._createActionButton('archive-moodboard', 'В архив', '↓').appendTo($menu);
        }
        $contextMenu.append($menu);
        $card.append($open, $contextMenu);

        this.cardIds.set($card.get(0), record.id);
        this.cardIds.set($open.get(0), record.id);
        for (const button of $contextMenu.find('button').get()) {
            this.cardIds.set(button, record.id);
        }
        return $card;
    }

    _createNewMoodboardCard() {
        const $card = this.$('<article>', {
            class: 'moodboard-card moodboard-card--create',
            role: 'listitem',
        });
        const $button = this.$('<button>', {
            class: 'moodboard-card__create-button',
            type: 'button',
            'data-action': 'create-moodboard',
            'data-list-control': '',
            'aria-label': 'Создать новый мудборд',
        });
        this.$('<span>', {
            class: 'moodboard-card__create-icon',
            'aria-hidden': 'true',
        }).text('+').appendTo($button);
        this.$('<strong>').text('Новый мудборд').appendTo($button);
        this.$('<small>').text('Создать чистую доску').appendTo($button);
        return $card.append($button);
    }

    _renderTemplateCards() {
        const $grid = this.$root.find('[data-role="template-grid"]').empty();
        for (const template of getMoodboardTemplates()) {
            const $item = this.$('<article>', {
                class: 'template-grid__item',
                role: 'listitem',
            });
            const $card = this.$('<button>', {
                class: 'template-card',
                type: 'button',
                'data-action': 'create-from-template',
                'data-template-id': template.id,
                'data-list-control': '',
                'aria-label': `Создать мудборд из шаблона «${template.title}»`,
            });
            const $preview = this.$('<span>', {
                class: 'template-card__preview',
                'aria-hidden': 'true',
            });
            this.$('<img>', {
                class: 'template-card__preview-image',
                src: template.previewUrl,
                alt: '',
                loading: 'lazy',
                decoding: 'async',
            }).appendTo($preview);
            const $copy = this.$('<span>', { class: 'template-card__copy' });
            this.$('<strong>').text(template.title).appendTo($copy);
            this.$('<small>').text(template.description).appendTo($copy);
            $card.append($preview, $copy).appendTo($item);
            $item.appendTo($grid);
        }
    }

    _createActionButton(action, label, icon, danger = false, disabled = false) {
        const className = danger
            ? 'moodboard-card__context-item moodboard-card__context-item--danger'
            : 'moodboard-card__context-item';
        const $button = this.$('<button>', {
            class: className,
            type: 'button',
            'data-action': action,
            role: 'menuitem',
            disabled,
        });
        this.$('<span>', {
            class: 'moodboard-card__context-icon',
            'aria-hidden': 'true',
        }).text(icon).appendTo($button);
        this.$('<span>').text(label).appendTo($button);
        return $button;
    }

    _handleCardContextKeyboard(event) {
        const $contextMenu = this.$(event.currentTarget);
        const trigger = $contextMenu.find('.moodboard-card__context-trigger').get(0);
        const items = $contextMenu.find('.moodboard-card__context-item:not(:disabled)').get();

        if (event.key === 'Escape') {
            event.preventDefault();
            trigger?.focus();
            $contextMenu.addClass('moodboard-card__context-menu--dismissed');
            return;
        }
        if (event.target === trigger && event.key === 'ArrowDown') {
            event.preventDefault();
            $contextMenu.removeClass('moodboard-card__context-menu--dismissed');
            items[0]?.focus();
            return;
        }
        if (!items.includes(event.target) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            return;
        }

        event.preventDefault();
        const currentIndex = items.indexOf(event.target);
        let nextIndex;
        if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = items.length - 1;
        } else if (event.key === 'ArrowUp') {
            nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        } else {
            nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
        }
        items[nextIndex]?.focus();
    }

    async _copyText(value) {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return;
            } catch (_) {
                // На HTTP или при запрете clipboard используем совместимый fallback.
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.readOnly = true;
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.append(textarea);
        let copied = false;
        try {
            textarea.select();
            copied = typeof document.execCommand === 'function' && document.execCommand('copy');
        } finally {
            textarea.remove();
        }
        if (!copied) {
            throw new Error('Браузер запретил доступ к буферу обмена.');
        }
    }

    _showState(state) {
        this.$root.find('[data-state]').prop('hidden', true);
        this.$root.find(`[data-state="${state}"]`).prop('hidden', false);
        this.$root.find('.moodboards-content').attr('aria-busy', state === 'loading' ? 'true' : 'false');
    }

    _showModal($modal) {
        if (this.activeModal) {
            this.activeModal.prop('hidden', true).attr('aria-hidden', 'true');
        }
        this.previousFocus = document.activeElement;
        this.activeModal = $modal;
        $modal.prop('hidden', false).attr('aria-hidden', 'false');
        this.$('body').addClass('modal-open');
    }

    _setModalBusy($modal, busy) {
        $modal.find('button, input').prop('disabled', busy);
        $modal.find('form').attr('aria-busy', busy ? 'true' : 'false');
        $modal.find('button[type="submit"]')
            .attr('aria-busy', busy ? 'true' : 'false');
    }

    _setListControlsDisabled(disabled) {
        this.$root.find('[data-list-control]').prop('disabled', disabled);
    }

    _setCardBusy(id, busy) {
        for (const card of this.$root.find('.moodboard-card').get()) {
            if (this.cardIds.get(card) === id) {
                this.$(card).toggleClass('moodboard-card--busy', busy);
                this.$(card).attr('aria-busy', busy ? 'true' : 'false');
                this.$(card).find('button').prop('disabled', busy);
                break;
            }
        }
    }

    _trapModalFocus(event) {
        const $focusable = this.activeModal.find(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ).filter(':visible');
        if ($focusable.length === 0) {
            event.preventDefault();
            return;
        }
        const first = $focusable.get(0);
        const last = $focusable.get($focusable.length - 1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    _formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'недавно' : this.dateFormatter.format(date);
    }

    _isMoodboardLimitReached() {
        const limit = this.accessPolicy?.maxMoodboards;
        return Number.isInteger(limit) && this.records.size >= limit;
    }

    _notifyMoodboardLimit() {
        const limit = this.accessPolicy?.maxMoodboards ?? 0;
        this.notify(`Достигнут лимит тарифа: ${limit} мудбордов.`, 'error');
    }

    _revokePreviewUrls() {
        for (const url of this.previewUrls) {
            URL.revokeObjectURL(url);
        }
        this.previewUrls = [];
    }
}
