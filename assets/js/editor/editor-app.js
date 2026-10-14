import { AutosaveManager } from './autosave-manager.js';
import { CanvasAdapter } from './canvas-adapter.js';
import { CommandManager } from './command-manager.js';
import { EditorCommandRegistry } from './editor-command-registry.js';
import { EditorStore } from './editor-store.js';
import { ImageProcessor } from './image-processor.js';
import {
    MAX_PAGE_NAME_LENGTH,
    cloneValue,
    createMoodboardPage,
    getMoodboardPage,
} from '../models/moodboard-document.js';
import { PreviewManager, selectFilledPages } from './preview-manager.js';
import { createPdfFromJpeg, createPdfFromJpegs } from './pdf-exporter.js';
import { UIController } from './ui-controller.js';
import { ViewportController } from './viewport-controller.js';
import {
    moveFrameBehindContents,
    syncElementFrameMembership,
    syncFrameMembership,
} from './frame-utils.js';
import {
    DEFAULT_MOODBOARD_USER_SETTINGS,
    LocalStorageMoodboardSettingsRepository,
    normalizeMoodboardUserSettings,
} from '../settings/moodboard-user-settings-repository.js';
import { expandGroupedSelectionIds, resolveSelectionIds } from './selection-utils.js';
import { reorderPages } from './page-order-utils.js';
import {
    blobToDataUrl,
    collectDocumentAssetIds,
    createProjectJsonPackage,
    dataUrlToBlob,
    parseProjectJson,
    replaceDocumentAssetIds,
} from './project-json-transfer.js';
import { detachArrowBindingsForIndependentMove } from './arrow-binding-utils.js';
import {
    BackgroundRemovalClient,
    resolveDemoBackgroundRemovalPreset,
} from './background-removal-client.js';
import {
    LocalStorageRecoveryDraftRepository,
    isRecoveryDraftApplicable,
} from './recovery-draft-repository.js';
import { replaceImageAssetInPage } from './image-replacement-utils.js';
import { collectGroupIds, remapElementGroups } from './group-utils.js';
import { appendImageEraseStroke } from '../models/image-erase-mask.js';

export function buildPublicViewerUrl(viewerRoute, moodboardId, origin = window.location.origin) {
    const url = new URL(viewerRoute, origin);
    url.searchParams.set('token', moodboardId);
    return url.toString();
}

export function protectBeforeUnload(event, autosaveState) {
    if (autosaveState?.saving !== true) {
        return false;
    }
    event?.preventDefault?.();
    if (event) {
        event.returnValue = '';
    }
    return true;
}

export async function copyTextToClipboard(value, {
    clipboard = navigator.clipboard,
    documentRef = document,
} = {}) {
    if (clipboard?.writeText) {
        try {
            await clipboard.writeText(value);
            return;
        } catch (_) {
            // Clipboard API может быть запрещён на HTTP; ниже используется совместимый fallback.
        }
    }

    const textarea = documentRef.createElement('textarea');
    textarea.value = value;
    textarea.readOnly = true;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    documentRef.body.append(textarea);
    let copied = false;
    try {
        textarea.select();
        copied = typeof documentRef.execCommand === 'function' && documentRef.execCommand('copy');
    } finally {
        textarea.remove();
    }
    if (!copied) {
        throw new Error('Браузер запретил доступ к буферу обмена.');
    }
}

export class EditorApp {
    constructor({
        $,
        Konva,
        config,
        repository,
        settingsRepository = null,
        recoveryDraftRepository = null,
        root,
    }) {
        this.$ = $;
        this.Konva = Konva;
        this.config = config;
        this.repository = repository;
        this.settingsRepository = settingsRepository || new LocalStorageMoodboardSettingsRepository({
            namespace: config.storage.databaseName,
            legacyStorageKey: `${config.storage.databaseName}-editor-settings-v1`,
        });
        this.recoveryDraftRepository = recoveryDraftRepository
            || new LocalStorageRecoveryDraftRepository({
                namespace: config.storage.databaseName,
            });
        this.root = root;
        this.editorConfig = config.editor || {};
        this.maxPages = Number.isInteger(this.editorConfig.maxPages) && this.editorConfig.maxPages > 0
            ? this.editorConfig.maxPages
            : 40;
        this.editorSettings = { ...DEFAULT_MOODBOARD_USER_SETTINGS };
        this.store = new EditorStore();
        this.commandManager = new CommandManager(this.store, {
            limit: this.editorConfig.historyLimit ?? 100,
        });
        this.commandRegistry = new EditorCommandRegistry({
            store: this.store,
            commandManager: this.commandManager,
        });
        this.imageProcessor = new ImageProcessor({
            maxSide: this.editorConfig.images?.maxSide ?? 2800,
            maxFileSize: this.editorConfig.images?.maxFileSize ?? (30 * 1024 * 1024),
            lossyQuality: this.editorConfig.images?.lossyQuality ?? 0.88,
        });
        this.backgroundRemovalClient = new BackgroundRemovalClient(
            {
                ...(config.services?.backgroundRemoval || {}),
                presetId: resolveDemoBackgroundRemovalPreset(),
            },
        );
        this.canvasAdapter = null;
        this.previewCanvasAdapter = null;
        this.previewCanvasContainer = null;
        this.viewportController = null;
        this.uiController = null;
        this.autosaveManager = null;
        this.previewManager = null;
        this.unsubscribeStore = null;
        this.initialized = false;
        this.destroyed = false;
        this.settingsLoadError = null;
        this.recoveryDraftLoadError = null;
        this.recoveryDraftErrorNotified = false;
        this.projectJsonControls = null;
        this.pendingProjectJsonImport = null;
        this.handleProjectJsonExport = () => { void this._exportProjectJson(); };
        this.handleProjectJsonChooseImport = () => this.projectJsonControls?.input?.click();
        this.handleProjectJsonFileChange = (event) => {
            const file = event.currentTarget.files?.[0] || null;
            if (file) void this._prepareProjectJsonImport(file);
        };
        this.handleProjectJsonConfirmImport = () => { void this._confirmProjectJsonImport(); };
        this.handleProjectJsonCancelImport = () => this._cancelProjectJsonImport();
        this.handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                void this.autosaveManager?.flush();
            }
        };
        this.handlePageExit = () => {
            void this.autosaveManager?.flush();
        };
        this.handleBeforeUnload = (event) => {
            void this.autosaveManager?.flush();
            return protectBeforeUnload(event, this.autosaveManager?.getState());
        };
    }

    async init() {
        if (this.initialized || this.destroyed) {
            return;
        }
        this.initialized = true;
        try {
            try {
                this.editorSettings = await this.settingsRepository.load();
            } catch (error) {
                this.editorSettings = { ...DEFAULT_MOODBOARD_USER_SETTINGS };
                this.settingsLoadError = error;
            }
            const moodboardId = new URLSearchParams(window.location.search).get('id');
            if (!moodboardId) {
                throw new Error('В адресе отсутствует идентификатор MoodBoard. Откройте редактор из списка досок.');
            }

            const record = await this.repository.get(moodboardId);
            if (!record) {
                throw new Error('Выбранный MoodBoard не найден в локальном хранилище.');
            }
            if (record.archivedAt !== null) {
                throw new Error('Этот MoodBoard находится в архиве. Восстановите его на странице списка перед редактированием.');
            }

            let recoveryDraft = null;
            try {
                recoveryDraft = this.recoveryDraftRepository.load(moodboardId);
                if (recoveryDraft && !isRecoveryDraftApplicable(recoveryDraft, record)) {
                    this.recoveryDraftRepository.remove(moodboardId);
                    recoveryDraft = null;
                }
            } catch (error) {
                this.recoveryDraftLoadError = error;
            }

            this.store.loadMoodboard(record);
            this._buildEditor();
            this._bindProjectJsonControls();
            this.uiController.render({ kind: 'moodboard-loaded' });
            this.uiController.showReady();
            if (this.settingsLoadError) {
                this.uiController.notify(
                    'Не удалось загрузить пользовательские настройки. Используются значения по умолчанию.',
                    'error',
                );
            }
            const activePage = this.store.getActivePage();
            this.canvasAdapter.renderDocument(activePage);
            this.viewportController.initialize(activePage.canvas);
            this.store.setSaveStatus('saved');
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
            window.addEventListener('pagehide', this.handlePageExit);
            window.addEventListener('beforeunload', this.handleBeforeUnload);
            if (this.recoveryDraftLoadError) {
                this._notifyRecoveryDraftError(this.recoveryDraftLoadError);
            }
            if (recoveryDraft) {
                await this._offerRecoveryDraft(recoveryDraft);
            }
        } catch (error) {
            this._showInitialError(error.message || 'Не удалось открыть редактор.');
        }
    }

    async destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('pagehide', this.handlePageExit);
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        await this.autosaveManager?.destroy({ flush: true });
        await this.previewManager?.destroy();
        this.previewCanvasAdapter?.destroy();
        this.previewCanvasContainer?.remove();
        this._unbindProjectJsonControls();
        this.unsubscribeStore?.();
        this.uiController?.destroy();
        this.viewportController?.destroy();
        this.canvasAdapter?.destroy();
        this.commandManager?.destroy();
        this.repository.close?.();
    }

    async _offerRecoveryDraft(draft) {
        const shouldRestore = await this.uiController.promptDraftRecovery({
            updatedAt: draft.updatedAt,
        });
        if (this.destroyed) {
            return false;
        }
        if (!shouldRestore) {
            try {
                this.recoveryDraftRepository.remove(this.store.moodboardId);
                this.uiController.notify('Аварийный черновик удалён.', 'info');
            } catch (error) {
                this._notifyRecoveryDraftError(error);
            }
            return false;
        }

        this.store.replaceDocument(draft.document, 'recovery');
        this.commandManager.clear();
        this.store.setSelections([]);
        const activePage = this.store.getActivePage();
        if (activePage) {
            this.viewportController.initialize(activePage.canvas);
        }
        this.uiController.notify(
            'Несохранённые изменения восстановлены. Автосохранение уже запущено.',
            'success',
        );
        return true;
    }

    _notifyRecoveryDraftError(error) {
        if (this.recoveryDraftErrorNotified) {
            return;
        }
        this.recoveryDraftErrorNotified = true;
        this.uiController?.notify(
            error?.message
                ? `Не удалось обновить аварийный черновик: ${error.message}`
                : 'Не удалось обновить аварийный черновик.',
            'error',
        );
    }

    _buildEditor() {
        const workspace = this.root.querySelector('[data-role="canvas-shell"]');
        const container = this.root.querySelector('[data-role="canvas-container"]');

        this.canvasAdapter = new CanvasAdapter({
            Konva: this.Konva,
            container,
            onSelect: (elementId) => this.store.setSelections(
                this._expandGroupedSelectionIds(elementId ? [elementId] : []),
            ),
            onSelectMany: (elementIds, { mode = 'replace' } = {}) => {
                this.store.setSelections(resolveSelectionIds(
                    this.store.getSelectedElementIds(),
                    this._expandGroupedSelectionIds(elementIds),
                    mode,
                ));
            },
            onCommit: (elementId, patch, label) => this._commitElement(elementId, patch, label),
            onCommitMany: (updates, label) => this._commitElements(updates, label),
            onContextMenu: (context) => this.uiController?.openCanvasContextMenu(context),
            onSelectionBoundsChange: () => this.uiController?.positionSelectionOverlays(),
            onRotationStateChange: (active) => (
                this.uiController?.setContextualToolbarRotationActive(active)
            ),
            onElementDragStateChange: (active) => (
                this.uiController?.setContextualToolbarRotationActive(active)
            ),
            onBrushComplete: (stroke) => this.uiController?.addBrushStroke(stroke),
            onArrowComplete: (arrow) => this.uiController?.addArrow(arrow),
            onFrameCreate: (bounds) => this.uiController?.addFrame(bounds),
            onObjectPlace: (placement) => this.uiController?.addPlacedObject(placement),
            onTextEdit: (elementId, text, options) => (
                this._handleCanvasTextEdit(elementId, text, options)
            ),
            onFrameCommit: (frameId, patch, childUpdates, label) => (
                this._commitFrame(frameId, patch, childUpdates, label)
            ),
            onImageEraseStroke: (elementId, stroke) => (
                this._appendImageEraseStroke(elementId, stroke)
            ),
            assetLoader: (assetId) => this.repository.getAsset(assetId),
            onAssetError: (error) => {
                this.uiController?.notify(
                    error?.message || 'Не удалось загрузить изображение из локального хранилища.',
                    'error',
                );
            },
        });
        this.canvasAdapter.setSnapEnabled(this.editorSettings.alwaysSnap);
        this.canvasAdapter.setBindingGuidesEnabled(this.editorSettings.showBindingGuides);
        this.canvasAdapter.setCanvasSheetVisible(this.editorSettings.showCanvasSheet);
        this.previewCanvasContainer = document.createElement('div');
        this.previewCanvasContainer.setAttribute('aria-hidden', 'true');
        this.previewCanvasAdapter = new CanvasAdapter({
            Konva: this.Konva,
            container: this.previewCanvasContainer,
            onSelect: () => {},
            onCommit: () => {},
            assetLoader: (assetId) => this.repository.getAsset(assetId),
        });
        this.previewCanvasAdapter.setInteractionEnabled(false);
        this.previewCanvasAdapter.setCanvasSheetVisible(true);
        this.viewportController = new ViewportController({
            store: this.store,
            canvasAdapter: this.canvasAdapter,
            workspace,
        });
        this.previewManager = new PreviewManager({
            store: this.store,
            repository: this.repository,
            canvasAdapter: this.previewCanvasAdapter,
            pixelRatio: this.editorConfig.preview?.pixelRatio ?? 0.3,
            aspectRatio: this.editorConfig.preview?.aspectRatio ?? (16 / 10),
            maxWidth: this.editorConfig.preview?.maxWidth ?? 480,
            maxHeight: this.editorConfig.preview?.maxHeight ?? 300,
            onError: (error) => {
                this.uiController?.notify(
                    error?.message || 'Не удалось обновить превью доски.',
                    'error',
                );
            },
        });
        this.autosaveManager = new AutosaveManager({
            store: this.store,
            repository: this.repository,
            draftRepository: this.recoveryDraftRepository,
            debounceMs: this.editorConfig.autosave?.debounceMs ?? 1200,
            retryDelaysMs: this.editorConfig.autosave?.retryDelaysMs,
            onStableSave: (save) => this.previewManager.generate(save),
            onDraftError: (error) => this._notifyRecoveryDraftError(error),
        });
        this.uiController = new UIController({
            $: this.$,
            root: this.root,
            store: this.store,
            commandManager: this.commandManager,
            commandRegistry: this.commandRegistry,
            canvasAdapter: this.canvasAdapter,
            viewportController: this.viewportController,
            onExport: (format, pixelRatio) => this._exportCanvas(format, pixelRatio),
            onExportElement: (format, elementIds) => this._exportElement(format, elementIds),
            onShare: () => this._shareMoodboard(),
            onFilesSelected: (files) => this._handleImageFiles(files),
            onReplaceImage: (elementId, file) => this._replaceImage(elementId, file),
            onRemoveImageBackground: (elementId) => this._removeImageBackground(elementId),
            onClearImageEraseMask: (elementId) => this._clearImageEraseMask(elementId),
            onPasteContent: (content) => this._handleClipboardContent(content),
            onRename: (title) => this._renameMoodboard(title),
            onSettingsChange: (settings) => this._applyEditorSettings(settings),
            onSelectPage: (pageId) => this._selectPage(pageId),
            onCreatePage: () => this._createPage(),
            onDuplicatePage: (pageId) => this._duplicatePage(pageId),
            onRenamePage: (pageId, name) => this._renamePage(pageId, name),
            onDeletePage: (pageId) => this._deletePage(pageId),
            onReorderPage: (pageId, targetPageId, position) => (
                this._reorderPage(pageId, targetPageId, position)
            ),
            maxPages: this.maxPages,
            settings: this.editorSettings,
        });

        this.unsubscribeStore = this.store.subscribe((event) => {
            if (event.kind === 'document-changed') {
                this.canvasAdapter.renderDocument(this.store.getActivePage());
                this.canvasAdapter.setSelections(this.store.getSelectedElementIds());
                this.autosaveManager.markChanged();
            } else if (event.kind === 'selection-changed') {
                this.canvasAdapter.setSelections(event.elementIds || []);
            } else if (event.kind === 'page-changed') {
                const activePage = this.store.getActivePage();
                this.canvasAdapter.renderDocument(activePage);
                this.canvasAdapter.setSelections([]);
                this.viewportController.initialize(activePage.canvas);
            }
        });
        this.uiController.bind();
    }

    _commitElement(elementId, patch, label) {
        this.commandManager.execute(label, (document) => {
            const element = document.elements.find(({ id }) => id === elementId);
            if (element) {
                detachArrowBindingsForIndependentMove(element, patch, [elementId]);
                Object.assign(element, patch);
                const frameId = syncElementFrameMembership(document.elements, elementId);
                if (frameId) {
                    moveFrameBehindContents(document.elements, frameId);
                }
            }
        });
    }

    _appendImageEraseStroke(elementId, stroke) {
        return this.commandManager.execute('Ручное удаление фона', (page) => {
            const element = page.elements.find(({ id }) => id === elementId);
            if (element?.type !== 'image' || element.locked === true) {
                return;
            }
            element.eraseMask = appendImageEraseStroke(element.eraseMask, stroke);
        });
    }

    _clearImageEraseMask(elementId) {
        return this.commandManager.execute('Очистка ручной маски изображения', (page) => {
            const element = page.elements.find(({ id }) => id === elementId);
            if (element?.type === 'image' && element.locked !== true) {
                delete element.eraseMask;
            }
        });
    }

    async _replaceImage(elementId, file) {
        const targetPageId = this.store.getActivePageId();
        const sourcePage = getMoodboardPage(this.store.getDocument(), targetPageId);
        const sourceElement = sourcePage?.elements.find(({ id }) => id === elementId);
        if (!sourceElement || sourceElement.type !== 'image') {
            throw new Error('Выбранное изображение больше недоступно.');
        }
        if (sourceElement.locked === true) {
            throw new Error('Разблокируйте изображение перед заменой.');
        }

        const sourceAssetId = sourceElement.assetId;
        let stagedAsset = null;
        this.uiController.setUploadState({
            active: true,
            current: 0,
            total: 1,
            fileName: file?.name || 'новое изображение',
        });
        try {
            const processed = await this.imageProcessor.process(file);
            stagedAsset = await this.repository.addAsset(this.store.moodboardId, processed.blob);
            const currentPage = getMoodboardPage(this.store.getDocument(), targetPageId);
            const currentElement = currentPage?.elements.find(({ id }) => id === elementId);
            if (
                !currentElement
                || currentElement.type !== 'image'
                || currentElement.assetId !== sourceAssetId
                || currentElement.locked === true
            ) {
                throw new Error('Изображение изменилось во время обработки. Повторите замену.');
            }

            const changed = this.commandManager.executeDocument(
                'Замена изображения',
                (document) => {
                    const page = getMoodboardPage(document, targetPageId);
                    const element = page?.elements.find(({ id }) => id === elementId);
                    if (element?.assetId === sourceAssetId && element.locked !== true) {
                        replaceImageAssetInPage(page, elementId, stagedAsset);
                    }
                },
                {
                    pageIds: [targetPageId],
                    undoPageId: targetPageId,
                    redoPageId: targetPageId,
                },
            );
            if (!changed) {
                throw new Error('Не удалось заменить изображение.');
            }
            stagedAsset = null;
            return true;
        } finally {
            if (stagedAsset?.id) {
                await this.repository.deleteAsset(stagedAsset.id).catch(() => {});
            }
            this.uiController.setUploadState({ active: false, current: 1, total: 1 });
        }
    }

    async _removeImageBackground(elementId) {
        const targetPageId = this.store.getActivePageId();
        const sourcePage = getMoodboardPage(this.store.getDocument(), targetPageId);
        const sourceElement = sourcePage?.elements.find(({ id }) => id === elementId);
        if (!sourceElement || sourceElement.type !== 'image') {
            throw new Error('Выбранное изображение больше недоступно.');
        }
        if (sourceElement.locked === true) {
            throw new Error('Разблокируйте изображение перед удалением фона.');
        }
        if (sourceElement.backgroundRemoved === true) {
            throw new Error('Фон у этого изображения уже удалён.');
        }

        const sourceAssetId = sourceElement.assetId;
        const sourceAsset = await this.repository.getAsset(sourceAssetId);
        if (!sourceAsset?.blob) {
            throw new Error('Исходное изображение отсутствует в локальном хранилище.');
        }

        const processedBlob = await this.backgroundRemovalClient.remove(sourceAsset.blob);
        const processedAsset = await this.repository.addAsset(this.store.moodboardId, processedBlob);
        const currentPage = getMoodboardPage(this.store.getDocument(), targetPageId);
        const currentElement = currentPage?.elements.find(({ id }) => id === elementId);
        if (
            !currentElement
            || currentElement.type !== 'image'
            || currentElement.assetId !== sourceAssetId
            || currentElement.locked === true
        ) {
            await this.repository.deleteAsset(processedAsset.id).catch(() => {});
            throw new Error('Изображение изменилось во время обработки. Повторите удаление фона.');
        }

        const changed = this.commandManager.executeDocument(
            'Удаление фона изображения',
            (document) => {
                const page = getMoodboardPage(document, targetPageId);
                const element = page?.elements.find(({ id }) => id === elementId);
                if (element?.type === 'image' && element.assetId === sourceAssetId) {
                    element.assetId = processedAsset.id;
                    element.aspectRatio = processedAsset.width / processedAsset.height;
                    element.backgroundRemoved = true;
                }
            },
            {
                pageIds: [targetPageId],
                undoPageId: targetPageId,
                redoPageId: targetPageId,
            },
        );

        if (!changed) {
            await this.repository.deleteAsset(processedAsset.id).catch(() => {});
            throw new Error('Не удалось применить результат удаления фона.');
        }
        return true;
    }

    _handleCanvasTextEdit(elementId, text, options = {}) {
        if (options.mergeCreation === true && this._isLatestTextAddition(elementId)) {
            const element = this.store.getElement(elementId);
            if (element && this.commandManager.discardLatest()) {
                return this.commandManager.execute('Добавление текста', (page) => {
                    page.elements.push({ ...element, text });
                });
            }
        }
        if (options.discardEmpty === true && this._isLatestTextAddition(elementId)) {
            this.store.setSelection(null);
            return this.commandManager.discardLatest();
        }
        if (options.discardEmpty === true || options.removeEmpty === true) {
            this.store.setSelection(null);
            return this.commandManager.execute('Удаление пустого текста', (page) => {
                page.elements = page.elements.filter(({ id }) => id !== elementId);
            });
        }
        return this._commitElement(elementId, { text }, 'Изменение текста');
    }

    _isLatestTextAddition(elementId) {
        const pageId = this.store.getActivePageId();
        const operation = this.commandManager.undoStack.at(-1);
        const beforeElements = operation?.before?.[pageId]?.page?.elements || [];
        const afterElements = operation?.after?.[pageId]?.page?.elements || [];
        return !beforeElements.some(({ id }) => id === elementId)
            && afterElements.some((element) => (
                element.id === elementId
                && element.type === 'text'
                && String(element.text || '').trim() === ''
            ));
    }

    _expandGroupedSelectionIds(elementIds) {
        return expandGroupedSelectionIds(this.store.getActivePage()?.elements, elementIds);
    }

    _commitElements(updates, label) {
        if (!Array.isArray(updates) || updates.length === 0) {
            return false;
        }
        const patches = new Map(updates.map(({ elementId, patch }) => [elementId, patch]));
        const movingElementIds = new Set(patches.keys());
        return this.commandManager.execute(label, (document) => {
            for (const element of document.elements) {
                const patch = patches.get(element.id);
                if (patch) {
                    detachArrowBindingsForIndependentMove(element, patch, movingElementIds);
                    Object.assign(element, patch);
                    const frameId = syncElementFrameMembership(document.elements, element.id);
                    if (frameId) {
                        moveFrameBehindContents(document.elements, frameId);
                    }
                }
            }
        });
    }

    _commitFrame(frameId, framePatch, childUpdates = [], label = 'Изменение фрейма') {
        const childPatches = new Map(
            childUpdates.map(({ elementId, patch }) => [elementId, patch]),
        );
        const movingElementIds = new Set([frameId, ...childPatches.keys()]);
        return this.commandManager.execute(label, (page) => {
            const frame = page.elements.find(({ id }) => id === frameId);
            if (!frame || frame.type !== 'frame') {
                return;
            }
            detachArrowBindingsForIndependentMove(frame, framePatch, movingElementIds);
            Object.assign(frame, framePatch);
            for (const element of page.elements) {
                const patch = childPatches.get(element.id);
                if (patch) {
                    detachArrowBindingsForIndependentMove(element, patch, movingElementIds);
                    Object.assign(element, patch);
                }
            }
            syncFrameMembership(page.elements, frameId);
            moveFrameBehindContents(page.elements, frameId);
        });
    }

    _bindProjectJsonControls() {
        const switcher = document.querySelector('[data-role="demo-tariff-switcher"]');
        const controls = {
            exportButton: switcher?.querySelector('[data-project-json-action="export"]'),
            importButton: switcher?.querySelector('[data-project-json-action="choose-import"]'),
            input: switcher?.querySelector('[data-role="project-json-input"]'),
            confirm: switcher?.querySelector('[data-role="project-json-confirm"]'),
            confirmButton: switcher?.querySelector('[data-project-json-action="confirm-import"]'),
            cancelButton: switcher?.querySelector('[data-project-json-action="cancel-import"]'),
            summary: switcher?.querySelector('[data-role="project-json-summary"]'),
        };
        if (!Object.values(controls).every((control) => control instanceof HTMLElement)) {
            return;
        }
        this.projectJsonControls = controls;
        controls.exportButton.addEventListener('click', this.handleProjectJsonExport);
        controls.importButton.addEventListener('click', this.handleProjectJsonChooseImport);
        controls.input.addEventListener('change', this.handleProjectJsonFileChange);
        controls.confirmButton.addEventListener('click', this.handleProjectJsonConfirmImport);
        controls.cancelButton.addEventListener('click', this.handleProjectJsonCancelImport);
        controls.exportButton.disabled = false;
        controls.importButton.disabled = false;
    }

    _unbindProjectJsonControls() {
        const controls = this.projectJsonControls;
        if (!controls) {
            return;
        }
        controls.exportButton.removeEventListener('click', this.handleProjectJsonExport);
        controls.importButton.removeEventListener('click', this.handleProjectJsonChooseImport);
        controls.input.removeEventListener('change', this.handleProjectJsonFileChange);
        controls.confirmButton.removeEventListener('click', this.handleProjectJsonConfirmImport);
        controls.cancelButton.removeEventListener('click', this.handleProjectJsonCancelImport);
        this.projectJsonControls = null;
        this.pendingProjectJsonImport = null;
    }

    _setProjectJsonBusy(busy) {
        const controls = this.projectJsonControls;
        if (!controls) {
            return;
        }
        controls.exportButton.disabled = busy;
        controls.importButton.disabled = busy;
        controls.confirmButton.disabled = busy;
        controls.cancelButton.disabled = busy;
        controls.exportButton.setAttribute('aria-busy', String(busy));
        controls.importButton.setAttribute('aria-busy', String(busy));
    }

    async _exportProjectJson() {
        if (!this.projectJsonControls) {
            return false;
        }
        this._setProjectJsonBusy(true);
        try {
            const documentSnapshot = this.store.getDocument();
            const assets = [];
            for (const assetId of collectDocumentAssetIds(documentSnapshot)) {
                const asset = await this.repository.getAsset(assetId);
                if (!asset?.blob) {
                    throw new Error(`Изображение ${assetId} отсутствует в локальном хранилище.`);
                }
                assets.push({
                    sourceId: assetId,
                    mimeType: asset.mimeType || asset.blob.type,
                    width: asset.width,
                    height: asset.height,
                    dataUrl: await blobToDataUrl(asset.blob),
                });
            }
            const payload = createProjectJsonPackage({
                title: this.store.title,
                document: documentSnapshot,
                assets,
            });
            const blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json;charset=utf-8',
            });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const safeTitle = this.store.title.replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
            link.href = objectUrl;
            link.download = `${safeTitle || 'moodboard'}-project.json`;
            document.body.append(link);
            try {
                link.click();
            } finally {
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            }
            this.uiController.notify('JSON-проект экспортирован.', 'success');
            return true;
        } catch (error) {
            this.uiController.notify(error?.message || 'Не удалось экспортировать JSON-проект.', 'error');
            return false;
        } finally {
            this._setProjectJsonBusy(false);
        }
    }

    async _prepareProjectJsonImport(file) {
        const controls = this.projectJsonControls;
        if (!controls) {
            return false;
        }
        try {
            if (file.size > 120 * 1024 * 1024) {
                throw new Error('JSON-файл превышает допустимый размер 120 МБ.');
            }
            const payload = parseProjectJson(await file.text());
            this.pendingProjectJsonImport = payload;
            const pageCount = payload.document.pages.length;
            const elementCount = payload.document.pages.reduce(
                (total, page) => total + page.elements.length,
                0,
            );
            controls.summary.textContent = `Текущее содержимое будет заменено: листов — ${pageCount}, элементов — ${elementCount}, изображений — ${payload.assets.length}.`;
            controls.confirm.hidden = false;
            requestAnimationFrame(() => controls.cancelButton.focus());
            return true;
        } catch (error) {
            this.pendingProjectJsonImport = null;
            controls.confirm.hidden = true;
            this.uiController.notify(error?.message || 'Не удалось прочитать JSON-проект.', 'error');
            return false;
        } finally {
            controls.input.value = '';
        }
    }

    _cancelProjectJsonImport() {
        this.pendingProjectJsonImport = null;
        if (this.projectJsonControls) {
            this.projectJsonControls.confirm.hidden = true;
            this.projectJsonControls.importButton.focus();
        }
    }

    async _confirmProjectJsonImport() {
        const payload = this.pendingProjectJsonImport;
        const controls = this.projectJsonControls;
        if (!payload || !controls) {
            return false;
        }
        this._setProjectJsonBusy(true);
        const stagedAssetIds = [];
        let documentCommitted = false;
        try {
            if (!await this.autosaveManager.flush()) {
                throw new Error('Сначала устраните ошибку сохранения текущего проекта.');
            }
            const embeddedAssets = new Map(payload.assets.map((asset) => [asset.sourceId, asset]));
            const assetIdMap = new Map();
            for (const sourceId of collectDocumentAssetIds(payload.document)) {
                const embedded = embeddedAssets.get(sourceId);
                if (embedded) {
                    const stored = await this.repository.addAsset(
                        this.store.moodboardId,
                        dataUrlToBlob(embedded.dataUrl),
                    );
                    stagedAssetIds.push(stored.id);
                    assetIdMap.set(sourceId, stored.id);
                    continue;
                }
                if (await this.repository.getAsset(sourceId)) {
                    assetIdMap.set(sourceId, sourceId);
                    continue;
                }
                throw new Error(`В JSON-проекте отсутствует изображение ${sourceId}.`);
            }
            const importedDocument = replaceDocumentAssetIds(payload.document, assetIdMap);
            const previousDocument = this.store.getDocument();
            const previousPageId = this.store.getActivePageId();
            const nextPageId = importedDocument.pages[0].id;
            const pageIds = [...new Set([
                ...previousDocument.pages.map(({ id }) => id),
                ...importedDocument.pages.map(({ id }) => id),
            ])];
            documentCommitted = this.commandManager.executeDocument(
                'Импорт JSON-проекта',
                (document) => {
                    document.schemaVersion = importedDocument.schemaVersion;
                    document.pages = cloneValue(importedDocument.pages);
                },
                {
                    pageIds,
                    undoPageId: previousPageId,
                    redoPageId: nextPageId,
                    restorePageOrder: true,
                },
            );
            this.store.setSelections([]);
            this.store.setActivePage(nextPageId);
            this.viewportController.initialize(this.store.getActivePage().canvas);

            let titleWarning = '';
            if (payload.title && payload.title !== this.store.title) {
                try {
                    await this._renameMoodboard(payload.title);
                } catch (error) {
                    titleWarning = ` Название не импортировано: ${error?.message || 'ошибка сохранения'}.`;
                }
            }
            controls.confirm.hidden = true;
            this.pendingProjectJsonImport = null;
            this.uiController.notify(`JSON-проект импортирован.${titleWarning}`, titleWarning ? 'info' : 'success');
            return true;
        } catch (error) {
            if (!documentCommitted && stagedAssetIds.length > 0) {
                await Promise.allSettled(stagedAssetIds.map((assetId) => this.repository.deleteAsset(assetId)));
            }
            this.uiController.notify(error?.message || 'Не удалось импортировать JSON-проект.', 'error');
            return false;
        } finally {
            this._setProjectJsonBusy(false);
        }
    }

    async _renameMoodboard(title) {
        const updated = await this.repository.updateMeta(this.store.moodboardId, { title });
        this.store.setTitle(updated.title);
        return updated.title;
    }

    _applyEditorSettings(settings) {
        this.editorSettings = { ...normalizeMoodboardUserSettings(settings) };
        this.canvasAdapter?.setSnapEnabled(this.editorSettings.alwaysSnap);
        this.canvasAdapter?.setBindingGuidesEnabled(this.editorSettings.showBindingGuides);
        this.canvasAdapter?.setCanvasSheetVisible(this.editorSettings.showCanvasSheet);
        void this.settingsRepository.save(this.editorSettings).catch(() => {
            this.uiController?.notify(
                'Настройки применены только для текущей сессии: сохранить их не удалось.',
                'error',
            );
        });
    }

    _selectPage(pageId) {
        return this.store.setActivePage(pageId);
    }

    _createPage() {
        this._assertCanAddPage();
        const sourcePage = this.store.getActivePage();
        const id = crypto.randomUUID();
        const page = createMoodboardPage({
            id,
            name: this._createUniquePageName(`Лист ${this.store.getPages().length + 1}`),
            canvas: sourcePage?.canvas,
        });
        const changed = this.commandManager.executeDocument(
            'Создание листа',
            (document) => {
                document.pages.push(page);
            },
            {
                pageIds: [id],
                undoPageId: sourcePage?.id,
                redoPageId: id,
            },
        );
        if (changed) {
            this.store.setActivePage(id);
        }
        return changed;
    }

    _duplicatePage(pageId) {
        this._assertCanAddPage();
        const document = this.store.getDocument();
        const sourceIndex = document.pages.findIndex(({ id }) => id === pageId);
        if (sourceIndex === -1) {
            return false;
        }
        const id = crypto.randomUUID();
        const duplicate = cloneValue(document.pages[sourceIndex]);
        duplicate.id = id;
        duplicate.name = this._createUniquePageName(`${duplicate.name} — копия`);
        const elementIdMap = new Map(
            duplicate.elements.map((element) => [element.id, crypto.randomUUID()]),
        );
        const groupIdMap = new Map(
            [...collectGroupIds(duplicate.elements)]
                .map((groupId) => [groupId, `group-${crypto.randomUUID()}`]),
        );
        duplicate.elements = duplicate.elements.map((element) => ({
            ...element,
            id: elementIdMap.get(element.id),
            ...(elementIdMap.has(element.frameId)
                ? { frameId: elementIdMap.get(element.frameId) }
                : {}),
            ...remapElementGroups(element, groupIdMap),
        }));
        const changed = this.commandManager.executeDocument(
            'Копирование листа',
            (nextDocument) => {
                nextDocument.pages.splice(sourceIndex + 1, 0, duplicate);
            },
            {
                pageIds: [id],
                undoPageId: pageId,
                redoPageId: id,
            },
        );
        if (changed) {
            this.store.setActivePage(id);
        }
        return changed;
    }

    _assertCanAddPage() {
        if (this.store.getPages().length >= this.maxPages) {
            throw new Error(`В одном мудборде может быть не более ${this.maxPages} листов.`);
        }
    }

    _renamePage(pageId, name) {
        const normalizedName = String(name || '').trim();
        if (normalizedName === '' || normalizedName.length > MAX_PAGE_NAME_LENGTH) {
            throw new Error(`Название листа должно содержать от 1 до ${MAX_PAGE_NAME_LENGTH} символов.`);
        }
        return this.commandManager.executeDocument(
            'Переименование листа',
            (document) => {
                const page = document.pages.find(({ id }) => id === pageId);
                if (page) {
                    page.name = normalizedName;
                }
            },
            {
                pageIds: [pageId],
                undoPageId: pageId,
                redoPageId: pageId,
            },
        );
    }

    _deletePage(pageId) {
        const document = this.store.getDocument();
        if (document.pages.length <= 1) {
            throw new Error('В мудборде должен остаться хотя бы один лист.');
        }
        const index = document.pages.findIndex(({ id }) => id === pageId);
        if (index === -1) {
            return false;
        }
        const wasActive = this.store.getActivePageId() === pageId;
        const nextPageId = document.pages[index + 1]?.id || document.pages[index - 1]?.id;
        const historyPageId = wasActive ? nextPageId : this.store.getActivePageId();
        const changed = this.commandManager.executeDocument(
            'Удаление листа',
            (nextDocument) => {
                nextDocument.pages.splice(index, 1);
            },
            {
                pageIds: [pageId],
                undoPageId: wasActive ? pageId : historyPageId,
                redoPageId: historyPageId,
            },
        );
        if (changed && wasActive && this.store.getActivePageId() !== nextPageId) {
            this.store.setActivePage(nextPageId);
        }
        return changed;
    }

    _reorderPage(pageId, targetPageId, position) {
        const document = this.store.getDocument();
        const reorderedPages = reorderPages(document?.pages, pageId, targetPageId, position);
        if (!reorderedPages) {
            return false;
        }
        const activePageId = this.store.getActivePageId();
        return this.commandManager.executeDocument(
            'Изменение порядка листов',
            (nextDocument) => {
                nextDocument.pages = reorderedPages;
            },
            {
                pageIds: document.pages.map(({ id }) => id),
                undoPageId: activePageId,
                redoPageId: activePageId,
                restorePageOrder: true,
            },
        );
    }

    _createUniquePageName(baseName) {
        const existingNames = new Set(this.store.getPages().map(({ name }) => name.toLocaleLowerCase()));
        const cleanBase = String(baseName || 'Лист').trim().slice(0, MAX_PAGE_NAME_LENGTH) || 'Лист';
        if (!existingNames.has(cleanBase.toLocaleLowerCase())) {
            return cleanBase;
        }
        for (let number = 2; number < 1000; number += 1) {
            const suffix = ` ${number}`;
            const candidate = `${cleanBase.slice(0, MAX_PAGE_NAME_LENGTH - suffix.length)}${suffix}`;
            if (!existingNames.has(candidate.toLocaleLowerCase())) {
                return candidate;
            }
        }
        throw new Error('Не удалось подобрать уникальное название листа.');
    }

    async _handleImageFiles(files, { placementCenter = null } = {}) {
        const imageFiles = Array.from(files || []);
        if (imageFiles.length === 0) {
            return;
        }

        this.uiController.setUploadState({ active: true, current: 0, total: imageFiles.length });
        const stagedElements = [];
        const stagedAssetIds = [];
        const failedFiles = [];
        const targetPageId = this.store.getActivePageId();
        const placementDocument = this.store.getActivePage();

        for (const [index, file] of imageFiles.entries()) {
            this.uiController.setUploadState({
                active: true,
                current: index,
                total: imageFiles.length,
                fileName: file.name || `Изображение ${index + 1}`,
            });
            try {
                const processed = await this.imageProcessor.process(file);
                const asset = await this.repository.addAsset(this.store.moodboardId, processed.blob);
                const elementId = crypto.randomUUID();
                const placement = this._calculateImagePlacement(
                    asset.width,
                    asset.height,
                    placementDocument,
                    placementCenter,
                );
                const element = {
                    id: elementId,
                    type: 'image',
                    assetId: asset.id,
                    x: placement.x,
                    y: placement.y,
                    width: placement.width,
                    height: placement.height,
                    aspectRatio: asset.width / asset.height,
                    rotation: 0,
                    opacity: 1,
                };
                stagedElements.push(element);
                stagedAssetIds.push(asset.id);
                placementDocument.elements.push(element);
            } catch (error) {
                const fileName = file.name || `Файл ${index + 1}`;
                const failure = `${fileName}: ${error.message || 'ошибка обработки'}`;
                failedFiles.push(failure);
                this.uiController.notify(failure, 'error');
            }
        }

        this.uiController.setUploadState({
            active: false,
            current: imageFiles.length,
            total: imageFiles.length,
        });
        if (stagedElements.length > 0) {
            const changed = this.commandManager.executeDocument(
                stagedElements.length === 1 ? 'Добавление изображения' : 'Добавление изображений',
                (document) => {
                    const page = getMoodboardPage(document, targetPageId);
                    if (!page) {
                        return;
                    }
                    page.elements.push(...stagedElements);
                    for (const element of stagedElements) {
                        const frameId = syncElementFrameMembership(page.elements, element.id);
                        if (frameId) {
                            moveFrameBehindContents(page.elements, frameId);
                        }
                    }
                },
                {
                    pageIds: [targetPageId],
                    undoPageId: targetPageId,
                    redoPageId: targetPageId,
                },
            );
            if (!changed) {
                await Promise.allSettled(stagedAssetIds.map((assetId) => this.repository.deleteAsset(assetId)));
                this.uiController.notify('Не удалось добавить изображения в документ.', 'error');
                return;
            }
            if (this.store.getActivePageId() === targetPageId) {
                this.store.setSelection(stagedElements[stagedElements.length - 1].id);
                this.uiController.activateSelectionTool();
            }
        }

        if (failedFiles.length > 0) {
            this.uiController.notify(
                `Добавлено: ${stagedElements.length}. Ошибок: ${failedFiles.length}. ${failedFiles[0]}`,
                'error',
            );
        } else if (stagedElements.length > 0) {
            this.uiController.notify(
                stagedElements.length === 1
                    ? 'Изображение добавлено.'
                    : `Добавлено изображений: ${stagedElements.length}.`,
                'success',
            );
        }
    }

    async _handleClipboardContent({ files = [], text = '' } = {}) {
        const imageFiles = Array.from(files || []);
        const placementCenter = this._getVisibleSceneCenter();
        if (imageFiles.length > 0) {
            await this._handleImageFiles(imageFiles, { placementCenter });
            return true;
        }

        const normalizedText = String(text || '')
            .replace(/\r\n?/g, '\n')
            .slice(0, 2000);
        if (normalizedText.trim() === '') {
            return false;
        }

        const fontSize = 32;
        const characterWidth = fontSize * 0.56;
        const lines = normalizedText.split('\n');
        const longestLine = Math.max(...lines.map((line) => Array.from(line).length), 1);
        const width = Math.round(Math.min(640, Math.max(220, longestLine * characterWidth + 24)));
        const charactersPerLine = Math.max(1, Math.floor((width - 24) / characterWidth));
        const visualLineCount = lines.reduce(
            (total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)),
            0,
        );
        const height = Math.max(56, Math.ceil(visualLineCount * fontSize * 1.2 + 24));
        const id = crypto.randomUUID();
        const changed = this.commandManager.execute('Вставка текста из буфера обмена', (page) => {
            page.elements.push({
                id,
                type: 'text',
                x: placementCenter.x - width / 2,
                y: placementCenter.y - height / 2,
                width,
                height,
                rotation: 0,
                text: normalizedText,
                fill: '#282828',
                fontSize,
                fontFamily: 'Roboto',
                fontStyle: 'normal',
                align: 'left',
                opacity: 1,
            });
            const frameId = syncElementFrameMembership(page.elements, id);
            if (frameId) {
                moveFrameBehindContents(page.elements, frameId);
            }
        });
        if (!changed) {
            return false;
        }
        this.store.setSelection(id);
        this.uiController.activateSelectionTool();
        this.uiController.notify(
            normalizedText.length < String(text || '').replace(/\r\n?/g, '\n').length
                ? 'Текст добавлен и сокращён до 2000 символов.'
                : 'Текст из буфера обмена добавлен.',
            'success',
        );
        return true;
    }

    _getVisibleSceneCenter() {
        const page = this.store.getActivePage();
        const viewport = this.store.getViewport();
        const stage = this.canvasAdapter?.getStage();
        const stageWidth = Number(stage?.width?.());
        const stageHeight = Number(stage?.height?.());
        if (
            Number.isFinite(stageWidth)
            && Number.isFinite(stageHeight)
            && stageWidth > 1
            && stageHeight > 1
            && Number.isFinite(viewport.scale)
            && viewport.scale > 0
        ) {
            return {
                x: (stageWidth / 2 - viewport.x) / viewport.scale,
                y: (stageHeight / 2 - viewport.y) / viewport.scale,
            };
        }
        return {
            x: Number(page?.canvas?.width || 1600) / 2,
            y: Number(page?.canvas?.height || 1000) / 2,
        };
    }

    _calculateImagePlacement(sourceWidth, sourceHeight, document, placementCenter = null) {
        const maxWidth = Math.min(720, document.canvas.width * 0.62);
        const maxHeight = Math.min(520, document.canvas.height * 0.62);
        const fitScale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
        const minimumScale = 48 / Math.max(sourceWidth, sourceHeight);
        const scale = Math.max(fitScale, minimumScale);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const cascade = (document.elements.length % 7) * 18;
        const hasPlacementCenter = Number.isFinite(placementCenter?.x)
            && Number.isFinite(placementCenter?.y);
        const centerX = hasPlacementCenter ? placementCenter.x : document.canvas.width / 2;
        const centerY = hasPlacementCenter ? placementCenter.y : document.canvas.height / 2;
        return {
            width,
            height,
            x: hasPlacementCenter
                ? centerX - width / 2 + cascade
                : Math.max(0, centerX - width / 2 + cascade),
            y: hasPlacementCenter
                ? centerY - height / 2 + cascade
                : Math.max(0, centerY - height / 2 + cascade),
        };
    }

    async _exportCanvas(format = 'png', pixelRatio = 1) {
        const normalizedFormat = String(format).toLowerCase();
        if (!['png', 'pdf', 'pdf-all'].includes(normalizedFormat)) {
            throw new Error('Выбран неподдерживаемый формат экспорта.');
        }
        const snapshot = this.store.getSnapshot();
        const activePage = this.store.getActivePage();
        const exportFormat = normalizedFormat === 'pdf-all' ? 'pdf' : normalizedFormat;
        const formatLabel = exportFormat.toUpperCase();
        this.uiController.setExportState({ status: 'exporting', format: exportFormat });
        try {
            let blob;
            if (normalizedFormat === 'pdf-all') {
                const filledPages = selectFilledPages(this.store.getDocument());
                if (filledPages.length <= 1) {
                    throw new Error('Для многостраничного PDF нужны минимум два заполненных листа.');
                }
                blob = await this._createMultipagePdf(filledPages, pixelRatio);
            } else if (normalizedFormat === 'pdf') {
                const exportResult = await this.canvasAdapter.exportAsBlob({
                    pixelRatio,
                    waitForFonts: true,
                    mimeType: 'image/jpeg',
                    quality: 0.94,
                    includeMetadata: true,
                    includeBackground: true,
                });
                blob = await createPdfFromJpeg(exportResult.blob, {
                    imageWidth: exportResult.width,
                    imageHeight: exportResult.height,
                    layout: this._createPdfPageLayout(activePage, exportResult.bounds),
                });
            } else {
                blob = await this.canvasAdapter.exportAsBlob({
                    pixelRatio,
                    waitForFonts: true,
                    includeBackground: false,
                });
            }
            const objectUrl = URL.createObjectURL(blob);
            try {
                const link = document.createElement('a');
                const safeTitle = snapshot.title
                    .normalize('NFKC')
                    .replace(/[^a-zа-яё0-9_-]+/giu, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 80);
                const safePageName = normalizedFormat === 'pdf-all' ? '' : String(activePage?.name || '')
                    .normalize('NFKC')
                    .replace(/[^a-zа-яё0-9_-]+/giu, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 60);
                link.href = objectUrl;
                link.download = `${safeTitle || 'moodboard'}${safePageName ? `-${safePageName}` : ''}.${exportFormat}`;
                link.hidden = true;
                document.body.append(link);
                link.click();
                link.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
            this.uiController.notify(
                normalizedFormat === 'pdf-all'
                    ? 'Многостраничный PDF экспортирован.'
                    : `${formatLabel} экспортирован.`,
                'success',
            );
        } finally {
            this.uiController.setExportState({ status: 'idle', format: exportFormat });
        }
    }

    async _createMultipagePdf(pages, pixelRatio = 1) {
        const exportContainer = document.createElement('div');
        exportContainer.setAttribute('aria-hidden', 'true');
        const exportAdapter = new CanvasAdapter({
            Konva: this.Konva,
            container: exportContainer,
            onSelect: () => {},
            onCommit: () => {},
            assetLoader: (assetId) => this.repository.getAsset(assetId),
        });
        exportAdapter.setInteractionEnabled(false);
        exportAdapter.setCanvasSheetVisible(true);

        try {
            const pdfPages = [];
            for (const page of pages) {
                exportAdapter.renderDocument(page);
                const result = await exportAdapter.exportAsBlob({
                    pixelRatio,
                    waitForFonts: true,
                    mimeType: 'image/jpeg',
                    quality: 0.94,
                    includeMetadata: true,
                    includeBackground: true,
                });
                pdfPages.push({
                    jpegBlob: result.blob,
                    imageWidth: result.width,
                    imageHeight: result.height,
                    layout: this._createPdfPageLayout(page, result.bounds),
                });
            }
            return await createPdfFromJpegs(pdfPages);
        } finally {
            exportAdapter.destroy();
        }
    }

    _createPdfPageLayout(page, bounds) {
        return {
            canvasWidth: Number(page?.canvas?.width),
            canvasHeight: Number(page?.canvas?.height),
            contentX: Number(bounds?.x),
            contentY: Number(bounds?.y),
            contentWidth: Number(bounds?.width),
            contentHeight: Number(bounds?.height),
        };
    }

    async _shareMoodboard() {
        await this.autosaveManager?.flush();
        if (!this.store.moodboardId) {
            throw new Error('Не удалось определить мудборд для публичной ссылки.');
        }
        const viewerRoute = this.config.routes.viewer || '/moodboards/view.php';
        const publicUrl = buildPublicViewerUrl(viewerRoute, this.store.moodboardId);
        await copyTextToClipboard(publicUrl);
        return publicUrl;
    }

    async _exportElement(format = 'png', elementIds = []) {
        const normalizedFormat = String(format).toLowerCase();
        if (!['png', 'pdf'].includes(normalizedFormat)) {
            throw new Error('Выбран неподдерживаемый формат экспорта объекта.');
        }
        const requestedIds = Array.isArray(elementIds) ? elementIds : [elementIds];
        const selectedIds = [...new Set(requestedIds.map(String))]
            .filter((id) => this.store.getElement(id));
        if (selectedIds.length === 0 || selectedIds.length !== requestedIds.length) {
            throw new Error('Объекты для экспорта не найдены.');
        }
        let result;
        let blob;
        if (normalizedFormat === 'pdf') {
            result = await this.canvasAdapter.exportElementsAsBlob(selectedIds, {
                pixelRatio: 2,
                mimeType: 'image/jpeg',
            });
            blob = await createPdfFromJpeg(result.blob, {
                imageWidth: result.width,
                imageHeight: result.height,
            });
        } else {
            result = await this.canvasAdapter.exportElementsAsBlob(selectedIds, { pixelRatio: 2 });
            blob = result.blob;
        }
        const safeTitle = this.store.title
            .normalize('NFKC')
            .replace(/[^a-zа-яё0-9_-]+/giu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 70) || 'moodboard';
        const objectUrl = URL.createObjectURL(blob);
        try {
            const link = document.createElement('a');
            link.href = objectUrl;
            const selectionSuffix = selectedIds.length === 1
                ? `object-${selectedIds[0].slice(0, 8)}`
                : `objects-${selectedIds.length}`;
            link.download = `${safeTitle}-${selectionSuffix}.${normalizedFormat}`;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
        this.uiController.notify(
            selectedIds.length === 1
                ? `${normalizedFormat.toUpperCase()} объекта экспортирован.`
                : `${normalizedFormat.toUpperCase()} выбранных объектов экспортирован.`,
            'success',
        );
    }

    _showInitialError(message) {
        const $root = this.$(this.root);
        $root.find('[data-state="loading"]').prop('hidden', true);
        $root.find('[data-role="canvas-shell"]').prop('hidden', true);
        $root.find('[data-state="error"]').prop('hidden', false);
        $root.find('[data-role="error-message"]').text(message);
        $root.find('[data-editor-control]').prop('disabled', true);
    }
}
