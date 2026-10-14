import {
    cloneValue,
    MAX_PAGE_NAME_LENGTH,
    SUPPORTED_SHAPE_TYPES,
} from '../models/moodboard-document.js';
import {
    ARROW_CAP_TYPES,
    ARROW_STROKE_WIDTHS,
    normalizeArrowPoints,
} from './arrow-utils.js';
import {
    moveFrameBehindContents,
    syncElementFrameMembership,
    syncFrameMembership,
} from './frame-utils.js';
import { expandGroupedSelectionIds } from './selection-utils.js';
import {
    buildLayerHierarchy,
    collectLayerNodeElementIds,
    filterLayerHierarchy,
    getLayerMapStats,
    reorderLayerElements,
    resolveLayerMapSelection,
} from './layer-map-utils.js';
import { remapArrowBindings } from './arrow-binding-utils.js';
import {
    formatSelectionDimensions,
    resolveSelectionDimensionsPosition,
} from './selection-dimensions.js';
import { selectFilledPages } from './preview-manager.js';
import { hasImageEraseMask } from '../models/image-erase-mask.js';
import { normalizeMoodboardUserSettings } from '../settings/moodboard-user-settings-repository.js';
import {
    applyElementGroupPath,
    commonGroupPath,
    getElementGroupNames,
    getElementGroupPath,
    getGroupName,
    remapElementGroups,
    collectGroupIds,
} from './group-utils.js';

const SHAPE_PRESETS = Object.freeze({
    rectangle: { label: 'Квадрат', width: 280, height: 280, cornerRadius: 4 },
    circle: { label: 'Круг', width: 280, height: 280, fill: '#5599ff' },
    diamond: { label: 'Ромб', width: 280, height: 280 },
    triangle: { label: 'Треугольник', width: 280, height: 260 },
    star: { label: 'Звезда', width: 280, height: 280 },
    oval: { label: 'Овал', width: 340, height: 220 },
    hexagon: { label: 'Шестиугольник', width: 320, height: 280 },
    cloud: { label: 'Облако', width: 360, height: 240 },
    'arrow-left': { label: 'Стрелка влево', width: 340, height: 200 },
    'arrow-up': { label: 'Стрелка вверх', width: 200, height: 340 },
    'arrow-down': { label: 'Стрелка вниз', width: 200, height: 340 },
    'arrow-right': { label: 'Стрелка вправо', width: 340, height: 200 },
    'checkbox-x': { label: 'Чекбокс X', width: 240, height: 240, fill: '#ffffff', strokeWidth: 6 },
    'checkbox-v': { label: 'Чекбокс V', width: 240, height: 240, fill: '#ffffff', strokeWidth: 6 },
});

const LAYER_TYPE_ICONS = Object.freeze({
    image: '▧',
    text: 'T',
    shape: '◇',
    rectangle: '□',
    brush: '∿',
    highlighter: '▰',
    sticker: '▱',
    frame: '▦',
    arrow: '↗',
    group: '⌘',
});

function formatElementCount(value) {
    const count = Math.max(0, Number(value) || 0);
    const mod100 = count % 100;
    const mod10 = count % 10;
    const suffix = mod100 >= 11 && mod100 <= 14
        ? 'элементов'
        : (mod10 === 1 ? 'элемент' : (mod10 >= 2 && mod10 <= 4 ? 'элемента' : 'элементов'));
    return `${count} ${suffix}`;
}

function isEditableTarget(target) {
    return target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        || Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'))
    );
}

export function resolveActionPanelActiveTool({
    activeTool = 'select',
    placementKind = null,
    uploadActive = false,
} = {}) {
    if (uploadActive) {
        return 'image';
    }
    if (activeTool === 'placement') {
        return {
            shape: 'shape',
            text: 'text',
            sticker: 'more',
        }[placementKind] || 'select';
    }
    if (activeTool === 'highlighter') {
        return 'more';
    }
    return ['select', 'hand', 'brush', 'arrow', 'frame'].includes(activeTool)
        ? activeTool
        : 'select';
}

export function resolveEditorHotkey(event = {}) {
    const code = String(event.code || '');
    const modifier = Boolean(event.ctrlKey || event.metaKey);
    const alt = Boolean(event.altKey);
    const shift = Boolean(event.shiftKey);

    if (modifier && !alt) {
        if (code === 'KeyG') {
            return shift ? 'ungroup' : 'group';
        }
        const modifiedCodes = {
            KeyU: 'upload-image',
            KeyP: 'export-pdf',
            Slash: 'toggle-dark-mode',
            Period: 'toggle-focus-mode',
            Equal: 'zoom-in',
            Minus: 'zoom-out',
            Quote: 'toggle-grid',
        };
        return modifiedCodes[code] || null;
    }

    if (!modifier && !alt && shift) {
        const shiftedCodes = {
            Digit0: 'zoom-100',
            Digit1: 'zoom-fit',
            Digit2: 'zoom-selection',
            KeyH: 'flip-horizontal',
            KeyV: 'flip-vertical',
            ArrowUp: 'bring-forward',
            ArrowDown: 'send-backward',
        };
        return shiftedCodes[code] || null;
    }

    if (!modifier && alt && !shift) {
        const alignmentCodes = {
            KeyW: 'align-top',
            KeyV: 'align-vertical',
            KeyS: 'align-bottom',
            KeyA: 'align-left',
            KeyH: 'align-horizontal',
            KeyD: 'align-right',
        };
        return alignmentCodes[code] || null;
    }

    if (!modifier && !alt && !shift) {
        const plainCodes = {
            KeyV: 'select-tool',
            KeyH: 'hand-tool',
            KeyR: 'rectangle-tool',
            KeyO: 'oval-tool',
            KeyF: 'frame-tool',
            KeyQ: 'toggle-tool-lock',
            ArrowUp: 'bring-to-front',
            ArrowDown: 'send-to-back',
        };
        return plainCodes[code] || null;
    }

    return null;
}

export function extractClipboardContent(clipboardData) {
    if (!clipboardData) {
        return { files: [], text: '' };
    }

    const itemFiles = Array.from(clipboardData.items || [])
        .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map((item) => item.getAsFile?.())
        .filter(Boolean);
    const files = itemFiles.length > 0
        ? itemFiles
        : Array.from(clipboardData.files || [])
            .filter((file) => String(file.type || '').startsWith('image/'));
    let text = '';
    try {
        text = String(clipboardData.getData?.('text/plain') || '');
    } catch (_) {
        // Some browser policies expose files but prohibit reading clipboard text.
    }
    return { files, text };
}

export function getSelectionSummary(elements = []) {
    const selection = Array.isArray(elements) ? elements.filter(Boolean) : [];
    const sharedPath = commonGroupPath(selection);
    const groupName = sharedPath.length > 0
        ? getGroupName(selection[0], sharedPath.at(-1))
        : '';
    return selection.length > 1 && sharedPath.length > 0
        ? `${groupName || 'Группа'} из ${selection.length}`
        : `Выбрано объектов: ${selection.length}`;
}

export class UIController {
    constructor({
        $,
        root,
        store,
        commandManager,
        commandRegistry,
        canvasAdapter,
        viewportController,
        onExport,
        onExportElement,
        onShare,
        onFilesSelected,
        onReplaceImage,
        onRemoveImageBackground,
        onClearImageEraseMask,
        onPasteContent,
        onRename,
        onSettingsChange,
        onSelectPage,
        onCreatePage,
        onDuplicatePage,
        onRenamePage,
        onDeletePage,
        onReorderPage,
        maxPages = 40,
        settings = {},
    }) {
        this.$ = $;
        this.root = root;
        this.$root = $(root);
        this.store = store;
        this.commandManager = commandManager;
        this.commandRegistry = commandRegistry;
        this.canvasAdapter = canvasAdapter;
        this.viewportController = viewportController;
        this.onExport = onExport;
        this.onExportElement = onExportElement || (() => Promise.resolve());
        this.onShare = onShare || (() => Promise.resolve());
        this.onFilesSelected = onFilesSelected;
        this.onReplaceImage = onReplaceImage || (() => Promise.resolve(false));
        this.onRemoveImageBackground = onRemoveImageBackground || (() => Promise.resolve(false));
        this.onClearImageEraseMask = onClearImageEraseMask || (() => false);
        this.onPasteContent = onPasteContent || (() => Promise.resolve(false));
        this.onRename = onRename || (async (title) => title);
        this.onSettingsChange = onSettingsChange || (() => {});
        this.onSelectPage = onSelectPage || (() => false);
        this.onCreatePage = onCreatePage || (() => false);
        this.onDuplicatePage = onDuplicatePage || (() => false);
        this.onRenamePage = onRenamePage || (() => false);
        this.onDeletePage = onDeletePage || (() => false);
        this.onReorderPage = onReorderPage || (() => false);
        this.maxPages = Number.isInteger(maxPages) && maxPages > 0 ? maxPages : 40;
        this.settings = { ...normalizeMoodboardUserSettings(settings) };
        this.unsubscribeStore = null;
        this.unsubscribeCommands = null;
        this.dragDepth = 0;
        this.uploadActive = false;
        this.imageReplacementElementId = null;
        this.backgroundRemovalElementId = null;
        this.imageEraserSize = this.settings.imageEraserSize;
        this.imageEraserElementId = null;
        this.imageEraserSettingsOpen = false;
        this.renamePending = false;
        this.settingsOpen = false;
        this.pagesOpen = false;
        this.exportOpen = false;
        this.sharePending = false;
        this.navigatorOpen = false;
        this.helpOpen = false;
        this.layerMapOpen = false;
        this.layerMapNavigationOpen = false;
        this.pagesRenderSignature = null;
        this.activeTool = 'select';
        this.toolLocked = false;
        this.pendingPlacement = null;
        this.brushSettings = { stroke: '#282828', strokeWidth: 5 };
        this.highlighterSettings = { stroke: '#ffdf5d', strokeWidth: 40, opacity: 0.35 };
        this.arrowSettings = {
            stroke: '#282828',
            strokeWidth: 5,
            startCap: 'none',
            endCap: 'arrow1',
        };
        this.actionPopover = null;
        this.toolbarLinkEditorOpen = false;
        this.alignmentPopoverOpen = false;
        this.alignmentPopoverCloseTimer = null;
        this.contextualMoreOpen = false;
        this.contextualMoreCloseTimer = null;
        this.contextualMoreElementId = null;
        this.contextMenuOpen = false;
        this.clipboardElements = [];
        this.internalClipboardText = '';
        this.pasteOffset = 0;
        this.navigatorDragging = false;
        this.popoverCloseTimers = { pages: null, settings: null, export: null, shapes: null, more: null };
        this.renamingPageId = null;
        this.deletingPageId = null;
        this.draggingPageId = null;
        this.layerMapTargets = new Map();
        this.layerMapDragEntries = new Map();
        this.layerMapQuery = '';
        this.layerMapTypeFilter = 'all';
        this.layerMapScopeFilter = 'all';
        this.collapsedLayerNodeIds = new Set();
        this.renamingLayerNodeId = null;
        this.draggingLayerNodeId = null;
        this.bound = false;
        this.notificationTimer = null;
        this.colorInputTimer = null;
        this.toolbarPositionFrame = null;
        this.dimensionsPositionFrame = null;
        this.viewportRenderFrame = null;
        this.pendingViewportRender = null;
        this.recoveryDraftResolver = null;
        this.handleKeyboard = this._handleKeyboard.bind(this);
        this.handlePaste = this._handlePaste.bind(this);
        this.handleScenePointerDown = this._handleScenePointerDown.bind(this);
        this.handleNavigatorPointerUp = () => { this.navigatorDragging = false; };
    }

    bind() {
        if (this.bound) {
            return;
        }
        this.bound = true;
        this.$root.on('click.moodboardsEditor', '[data-action="undo"]', () => this.commandManager.undo());
        this.$root.on('click.moodboardsEditor', '[data-action="redo"]', () => this.commandManager.redo());
        this.$root.on('click.moodboardsEditor', '[data-action="restore-recovery-draft"]', () => {
            this._resolveDraftRecovery(true);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="discard-recovery-draft"]', () => {
            this._resolveDraftRecovery(false);
        });
        this.$root.on('click.moodboardsEditor', '[data-editor-command]', (event) => {
            this.commandRegistry.execute(event.currentTarget.dataset.editorCommand);
            if (this.$(event.currentTarget).closest('[data-role="contextual-more-menu"]').length > 0) {
                this._setContextualMoreOpen(false, { restoreFocus: true });
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="zoom-in"]', () => this.viewportController.zoomIn());
        this.$root.on('click.moodboardsEditor', '[data-action="zoom-out"]', () => this.viewportController.zoomOut());
        this.$root.on('click.moodboardsEditor', '[data-action="fit"]', () => this.viewportController.fit());
        this.$root.on('click.moodboardsEditor', '[data-action="return-to-content"]', () => {
            if (!this.viewportController.focusContent()) {
                this.notify('На активном листе пока нет содержимого.', 'info');
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="exit-focus-mode"]', () => {
            if (this.settings.focusMode) {
                this._executeHotkey('toggle-focus-mode');
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="set-tool"]', (event) => {
            this._setActiveTool(event.currentTarget.dataset.tool);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-navigator"]', (event) => {
            event.stopPropagation();
            this._setNavigatorOpen(!this.navigatorOpen);
        });
        this.$root.on('pointerdown.moodboardsEditor', '[data-role="navigator-map"]', (event) => {
            event.preventDefault();
            this.navigatorDragging = true;
            event.currentTarget.setPointerCapture?.(event.originalEvent.pointerId);
            this._navigateFromMapPointer(event.originalEvent);
        });
        this.$root.on('pointermove.moodboardsEditor', '[data-role="navigator-map"]', (event) => {
            if (this.navigatorDragging) {
                this._navigateFromMapPointer(event.originalEvent);
            }
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="navigator-map"]', (event) => {
            this._handleNavigatorKeyboard(event);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-help"]', (event) => {
            event.stopPropagation();
            this._setHelpOpen(!this.helpOpen);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-layer-map"]', (event) => {
            event.stopPropagation();
            this._setLayerMapOpen(!this.layerMapOpen);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-layer-map-navigation"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._setLayerMapNavigationOpen(!this.layerMapNavigationOpen);
        });
        this.$root.on('input.moodboardsEditor', '[data-role="layer-map-search"]', (event) => {
            this.layerMapQuery = event.currentTarget.value;
            this._renderLayerMap();
        });
        this.$root.on('change.moodboardsEditor', '[data-role="layer-map-type-filter"]', (event) => {
            this.layerMapTypeFilter = event.currentTarget.value || 'all';
            this._renderLayerMap();
        });
        this.$root.on('change.moodboardsEditor', '[data-role="layer-map-scope-filter"]', (event) => {
            this.layerMapScopeFilter = event.currentTarget.value || 'all';
            this._renderLayerMap();
        });
        this.$root.on('click.moodboardsEditor', '[data-action="clear-layer-map-filters"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.layerMapQuery = '';
            this.layerMapTypeFilter = 'all';
            this.layerMapScopeFilter = 'all';
            this._renderLayerMap();
            this.$root.find('[data-role="layer-map-search"]').trigger('focus');
        });
        this.$root.on('click.moodboardsEditor', '[data-layer-action="toggle-branch"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._toggleLayerMapBranch(event.currentTarget);
        });
        this.$root.on('click.moodboardsEditor', '[data-layer-action="rename"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._startLayerMapRename(event.currentTarget.closest('[data-layer-node-id]'));
        });
        this.$root.on('dblclick.moodboardsEditor', '[data-layer-name]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._startLayerMapRename(event.currentTarget.closest('[data-layer-node-id]'));
        });
        this.$root.on('click.moodboardsEditor', '[data-layer-action="toggle-lock"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._toggleLayerMapNodeLock(event.currentTarget.closest('[data-layer-node-id]'));
        });
        this.$root.on('click.moodboardsEditor', '[data-role="layer-map-rename-input"]', (event) => {
            event.stopPropagation();
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="layer-map-rename-input"]', (event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                this._finishLayerMapRename(event.currentTarget, { cancel: true });
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this._finishLayerMapRename(event.currentTarget);
            }
        });
        this.$root.on('blur.moodboardsEditor', '[data-role="layer-map-rename-input"]', (event) => {
            this._finishLayerMapRename(event.currentTarget);
        });
        this.$root.on('click.moodboardsEditor', '[data-layer-node-id]', (event) => {
            if (this.$(event.target).closest('[data-layer-action], [data-role="layer-map-rename-input"]').length) {
                return;
            }
            event.stopPropagation();
            this._selectLayerMapNode(
                event.currentTarget,
                event.ctrlKey || event.metaKey,
            );
        });
        this.$root.on('contextmenu.moodboardsEditor', '[data-layer-node-id]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._openLayerMapContextMenu(event.currentTarget, {
                clientX: event.clientX,
                clientY: event.clientY,
            });
        });
        this.$root.on('dragstart.moodboardsEditor', '[data-layer-node-id]', (event) => {
            this._startLayerMapDrag(event.currentTarget, event.originalEvent);
        });
        this.$root.on('dragover.moodboardsEditor', '[data-layer-node-id]', (event) => {
            this._updateLayerMapDropTarget(event.currentTarget, event.originalEvent);
        });
        this.$root.on('dragleave.moodboardsEditor', '[data-layer-node-id]', (event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
                this.$(event.currentTarget).removeClass([
                    'layer-map__row--drop-before',
                    'layer-map__row--drop-after',
                ].join(' '));
            }
        });
        this.$root.on('drop.moodboardsEditor', '[data-layer-node-id]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const position = this.$(event.currentTarget).hasClass('layer-map__row--drop-after')
                ? 'after'
                : 'before';
            this._reorderLayerMapNode(
                this.draggingLayerNodeId,
                event.currentTarget.dataset.layerNodeId,
                position,
            );
            this._clearLayerMapDragState();
        });
        this.$root.on('dragend.moodboardsEditor', '[data-layer-node-id]', () => {
            this._clearLayerMapDragState();
        });
        this.$root.on('keydown.moodboardsEditor', '[data-layer-node-id]', (event) => {
            if (event.target !== event.currentTarget) {
                return;
            }
            if (event.key === 'F2') {
                event.preventDefault();
                event.stopPropagation();
                this._startLayerMapRename(event.currentTarget);
                return;
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const entry = this.layerMapDragEntries.get(event.currentTarget.dataset.layerNodeId);
                if (entry?.hasChildren) {
                    event.preventDefault();
                    event.stopPropagation();
                    const shouldCollapse = event.key === 'ArrowLeft';
                    if (this.collapsedLayerNodeIds.has(event.currentTarget.dataset.layerNodeId) !== shouldCollapse) {
                        this._toggleLayerMapBranch(event.currentTarget);
                    }
                    return;
                }
            }
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                this._openLayerMapContextMenu(event.currentTarget, {
                    clientX: bounds.left + Math.min(bounds.width, 72),
                    clientY: bounds.top + bounds.height / 2,
                });
                return;
            }
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                const rows = this.$root.find('[data-role="layer-map-tree"] [data-layer-node-id]').get();
                const currentIndex = rows.indexOf(event.currentTarget);
                let nextIndex = currentIndex;
                if (event.key === 'Home') nextIndex = 0;
                else if (event.key === 'End') nextIndex = rows.length - 1;
                else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
                else nextIndex = Math.min(rows.length - 1, currentIndex + 1);
                rows[nextIndex]?.focus();
                return;
            }
            if (!['Enter', ' '].includes(event.key)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this._selectLayerMapNode(
                event.currentTarget,
                event.ctrlKey || event.metaKey,
            );
        });
        this.$root.on('click.moodboardsEditor', '[data-context-action]', (event) => {
            event.stopPropagation();
            void this._executeContextAction(event.currentTarget);
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="canvas-context-menu"]', (event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const items = this.$root.find('[data-role="canvas-context-menu"] [role="menuitem"]:not(:disabled)').get();
            if (items.length === 0) {
                return;
            }
            const currentIndex = items.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            else nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
            items[nextIndex]?.focus();
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-export"]', (event) => {
            event.preventDefault();
            this._togglePopoverFromTrigger('export', event);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="export-format"]', (event) => {
            const format = String(event.currentTarget.dataset.format || '').toLowerCase();
            this._setExportOpen(false);
            Promise.resolve(this.onExport(format, 1)).catch((error) => {
                const message = error?.message || `Не удалось экспортировать ${format.toUpperCase()}.`;
                this.setExportState({ status: 'error', message, format });
                this.notify(message, 'error');
            });
        });
        this.$root.on('click.moodboardsEditor', '[data-action="create-share-link"]', () => {
            if (this.sharePending) {
                return;
            }
            this._setExportOpen(false);
            this.setShareState(true);
            Promise.resolve(this.onShare())
                .then(() => {
                    this.notify('Публичная ссылка скопирована. Мудборд откроется только для просмотра.', 'success');
                })
                .catch((error) => {
                    this.notify(error?.message || 'Не удалось создать публичную ссылку.', 'error');
                })
                .finally(() => this.setShareState(false));
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="export-menu"]', (event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const options = this.$root.find('[data-export-option]:visible:not(:disabled)').get();
            if (options.length === 0) {
                return;
            }
            const currentIndex = options.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === 'Home') {
                nextIndex = 0;
            } else if (event.key === 'End') {
                nextIndex = options.length - 1;
            } else if (event.key === 'ArrowUp') {
                nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
            } else {
                nextIndex = currentIndex >= options.length - 1 ? 0 : currentIndex + 1;
            }
            options[nextIndex].focus();
        });
        this.$root.on('focusout.moodboardsEditor', '.editor-export', () => {
            requestAnimationFrame(() => {
                if (this.exportOpen && this.$(document.activeElement).closest('.editor-export').length === 0) {
                    this._setExportOpen(false);
                }
            });
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-settings"]', (event) => {
            event.preventDefault();
            this._togglePopoverFromTrigger('settings', event);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-pages"]', (event) => {
            event.preventDefault();
            this._togglePopoverFromTrigger('pages', event);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="toggle-action-popover"]', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._togglePopoverFromTrigger(event.currentTarget.dataset.actionPopover, event);
        });
        this._bindHoverPopover('.editor-export', 'export');
        this._bindHoverPopover('.editor-settings', 'settings');
        this._bindHoverPopover('.page-switcher', 'pages');
        this._bindHoverPopover('[data-action-popover-root="shapes"]', 'shapes');
        this._bindHoverPopover('[data-action-popover-root="more"]', 'more');
        this.$root.on('focusout.moodboardsEditor', '[data-action-popover-root]', (event) => {
            const type = event.currentTarget.dataset.actionPopoverRoot;
            requestAnimationFrame(() => {
                if (this.actionPopover === type && this.$(document.activeElement).closest(event.currentTarget).length === 0) {
                    this._setActionPopoverOpen(null);
                }
            });
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="action-popover"]', (event) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const items = this.$(event.currentTarget).find('[role="menuitem"]:not(:disabled)').get();
            if (items.length === 0) {
                return;
            }
            const currentIndex = items.indexOf(document.activeElement);
            const columns = this.$(event.currentTarget).is('[data-action-popover-panel="shapes"]') ? 4 : 1;
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? 0 : Math.max(0, currentIndex - columns);
            else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : Math.min(items.length - 1, currentIndex + columns);
            else if (event.key === 'ArrowLeft') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            else nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
            items[nextIndex]?.focus();
        });
        this.$root.on('pointerenter.moodboardsEditor', '[data-align-popover-root]', (event) => {
            if (!this._supportsHover() || this.$(event.currentTarget).find('[data-role="align-trigger"]').prop('disabled')) {
                return;
            }
            clearTimeout(this.alignmentPopoverCloseTimer);
            this._setAlignmentPopoverOpen(true, { focus: false });
        });
        this.$root.on('pointerleave.moodboardsEditor', '[data-align-popover-root]', () => {
            if (!this._supportsHover()) {
                return;
            }
            clearTimeout(this.alignmentPopoverCloseTimer);
            this.alignmentPopoverCloseTimer = window.setTimeout(() => {
                const focusInside = this.$(document.activeElement).closest('[data-align-popover-root]').length > 0;
                if (!focusInside) {
                    this._setAlignmentPopoverOpen(false);
                }
            }, 180);
        });
        this.$root.on('focusout.moodboardsEditor', '[data-align-popover-root]', (event) => {
            requestAnimationFrame(() => {
                if (
                    this.alignmentPopoverOpen
                    && this.$(document.activeElement).closest(event.currentTarget).length === 0
                ) {
                    this._setAlignmentPopoverOpen(false);
                }
            });
        });
        this.$root.on('pointerenter.moodboardsEditor', '[data-contextual-more-root]', () => {
            if (!this._supportsHover() || this.$root.find('[data-role="contextual-more-trigger"]').prop('disabled')) {
                return;
            }
            clearTimeout(this.contextualMoreCloseTimer);
            this._setContextualMoreOpen(true);
        });
        this.$root.on('pointerleave.moodboardsEditor', '[data-contextual-more-root]', () => {
            if (!this._supportsHover()) {
                return;
            }
            clearTimeout(this.contextualMoreCloseTimer);
            this.contextualMoreCloseTimer = window.setTimeout(() => {
                const focusInside = this.$(document.activeElement).closest('[data-contextual-more-root]').length > 0;
                if (!focusInside) {
                    this._setContextualMoreOpen(false);
                }
            }, 180);
        });
        this.$root.on('focusout.moodboardsEditor', '[data-contextual-more-root]', (event) => {
            requestAnimationFrame(() => {
                if (
                    this.contextualMoreOpen
                    && this.$(document.activeElement).closest(event.currentTarget).length === 0
                ) {
                    this._setContextualMoreOpen(false);
                }
            });
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="contextual-more-menu"]', (event) => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                return;
            }
            if (event.target instanceof HTMLInputElement) {
                return;
            }
            const controls = this.$(event.currentTarget)
                .find('button:visible:not(:disabled), input:visible:not(:disabled)')
                .toArray();
            if (controls.length === 0) {
                return;
            }
            event.preventDefault();
            const currentIndex = controls.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = controls.length - 1;
            else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? controls.length - 1 : currentIndex - 1;
            else nextIndex = currentIndex < 0 || currentIndex >= controls.length - 1 ? 0 : currentIndex + 1;
            controls[nextIndex]?.focus();
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="align-popover"]', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            const items = this.$(event.currentTarget).find('[role="menuitem"]:not(:disabled)').get();
            if (items.length === 0) {
                return;
            }
            const currentIndex = items.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = items.length - 1;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            } else {
                nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
            }
            items[nextIndex]?.focus();
        });
        this.$root.on('click.moodboardsEditor', '[data-action="select-page"]', (event) => {
            this.onSelectPage(event.currentTarget.dataset.pageId);
            this._setPagesOpen(false);
        });
        this.$root.on('dragstart.moodboardsEditor', '[data-role="page-drag-handle"]', (event) => {
            const pageId = event.currentTarget.dataset.pageId;
            const nativeEvent = event.originalEvent;
            if (!pageId || this.renamingPageId || this.deletingPageId || !nativeEvent?.dataTransfer) {
                event.preventDefault();
                return;
            }
            this.draggingPageId = pageId;
            nativeEvent.dataTransfer.effectAllowed = 'move';
            nativeEvent.dataTransfer.setData('text/plain', pageId);
            this.$(event.currentTarget).closest('.page-switcher__item')
                .addClass('page-switcher__item--dragging');
        });
        this.$root.on('dragover.moodboardsEditor', '.page-switcher__item', (event) => {
            const targetPageId = event.currentTarget.dataset.pageId;
            if (!this.draggingPageId || !targetPageId || targetPageId === this.draggingPageId) {
                return;
            }
            event.preventDefault();
            if (event.originalEvent?.dataTransfer) {
                event.originalEvent.dataTransfer.dropEffect = 'move';
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const position = event.originalEvent.clientY < bounds.top + bounds.height / 2
                ? 'before'
                : 'after';
            this.$root.find('.page-switcher__item')
                .removeClass('page-switcher__item--drop-before page-switcher__item--drop-after');
            this.$(event.currentTarget).addClass(`page-switcher__item--drop-${position}`);
        });
        this.$root.on('drop.moodboardsEditor', '.page-switcher__item', (event) => {
            const targetPageId = event.currentTarget.dataset.pageId;
            const $target = this.$(event.currentTarget);
            const position = $target.hasClass('page-switcher__item--drop-after') ? 'after' : 'before';
            event.preventDefault();
            if (
                this.draggingPageId
                && targetPageId
                && targetPageId !== this.draggingPageId
                && this.onReorderPage(this.draggingPageId, targetPageId, position)
            ) {
                this.notify('Порядок листов изменён.', 'success');
            }
            this._clearPageDragState();
        });
        this.$root.on('dragend.moodboardsEditor', '[data-role="page-drag-handle"]', () => {
            this._clearPageDragState();
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="page-drag-handle"]', (event) => {
            if (!['ArrowUp', 'ArrowDown'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const pageId = event.currentTarget.dataset.pageId;
            const pages = this.store.getPages();
            const sourceIndex = pages.findIndex(({ id }) => id === pageId);
            const targetIndex = sourceIndex + (event.key === 'ArrowUp' ? -1 : 1);
            const targetPage = pages[targetIndex];
            if (!targetPage) {
                return;
            }
            const position = event.key === 'ArrowUp' ? 'before' : 'after';
            if (this.onReorderPage(pageId, targetPage.id, position)) {
                requestAnimationFrame(() => {
                    this.$root.find(`[data-role="page-drag-handle"][data-page-id="${CSS.escape(pageId)}"]`)
                        .trigger('focus');
                });
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="create-page"]', () => {
            try {
                if (this.onCreatePage()) {
                    this.notify('Новый лист создан.', 'success');
                    this._setPagesOpen(false);
                }
            } catch (error) {
                this.notify(error?.message || 'Не удалось создать лист.', 'error');
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="duplicate-page"]', (event) => {
            event.stopPropagation();
            try {
                if (this.onDuplicatePage(event.currentTarget.dataset.pageId)) {
                    this.notify('Копия листа создана.', 'success');
                    this._setPagesOpen(false);
                }
            } catch (error) {
                this.notify(error?.message || 'Не удалось скопировать лист.', 'error');
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="rename-page"]', (event) => {
            event.stopPropagation();
            this.renamingPageId = event.currentTarget.dataset.pageId;
            this.deletingPageId = null;
            this._renderPages();
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="page-name-input"]', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.renamingPageId = null;
                this._renderPages();
            }
        });
        this.$root.on('change.moodboardsEditor', '[data-role="page-name-input"]', (event) => {
            this._submitPageRename(event.currentTarget);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="delete-page"]', (event) => {
            event.stopPropagation();
            this.deletingPageId = event.currentTarget.dataset.pageId;
            this.renamingPageId = null;
            this._renderPages();
        });
        this.$root.on('click.moodboardsEditor', '[data-action="cancel-delete-page"]', () => {
            this.deletingPageId = null;
            this._renderPages();
        });
        this.$root.on('click.moodboardsEditor', '[data-action="confirm-delete-page"]', () => {
            const pageId = this.deletingPageId;
            if (!pageId) {
                return;
            }
            try {
                if (this.onDeletePage(pageId)) {
                    this.notify('Лист удалён.', 'success');
                }
                this.deletingPageId = null;
                this._renderPages();
            } catch (error) {
                this.notify(error?.message || 'Не удалось удалить лист.', 'error');
            }
        });
        this.$root.on('change.moodboardsEditor', '[data-role="project-name"]', (event) => {
            void this._submitProjectName(event.currentTarget);
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="project-name"]', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.$(event.currentTarget).val(this.store.title);
                event.currentTarget.blur();
            }
        });
        this.$root.on('change.moodboardsEditor', '[data-setting]', (event) => {
            this._handleSettingChange(event.currentTarget);
        });
        this.$root.on('click.moodboardsEditor', (event) => {
            if (this.settingsOpen && this.$(event.target).closest('.editor-settings').length === 0) {
                this._setSettingsOpen(false);
            }
            if (this.pagesOpen && this.$(event.target).closest('.page-switcher').length === 0) {
                this._setPagesOpen(false);
            }
            if (this.exportOpen && this.$(event.target).closest('.editor-export').length === 0) {
                this._setExportOpen(false);
            }
            if (this.actionPopover && this.$(event.target).closest('[data-action-popover-root]').length === 0) {
                this._setActionPopoverOpen(null);
            }
            if (this.alignmentPopoverOpen && this.$(event.target).closest('[data-align-popover-root]').length === 0) {
                this._setAlignmentPopoverOpen(false);
            }
            if (this.contextualMoreOpen && this.$(event.target).closest('[data-contextual-more-root]').length === 0) {
                this._setContextualMoreOpen(false);
            }
            if (
                this.toolbarLinkEditorOpen
                && this.$(event.target).closest('[data-role="toolbar-link-editor"], [data-object-action="edit-link"]').length === 0
            ) {
                this._setToolbarLinkEditorOpen(false);
            }
            if (this.navigatorOpen && this.$(event.target).closest('.canvas-navigator').length === 0) {
                this._setNavigatorOpen(false);
            }
            if (this.helpOpen && this.$(event.target).closest('.editor-help').length === 0) {
                this._setHelpOpen(false);
            }
            if (this.contextMenuOpen && this.$(event.target).closest('[data-role="canvas-context-menu"]').length === 0) {
                this._closeContextMenu();
            }
        });
        this.$root.on('click.moodboardsEditor', '[data-action="add-shape"]', (event) => {
            this.addShape(event.currentTarget.dataset.shapeType);
            this._setActionPopoverOpen(null);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="add-text"]', () => {
            this.addText();
            this._setActionPopoverOpen(null);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="add-sticker"]', () => {
            this.addSticker();
            this._setActionPopoverOpen(null);
        });
        this.$root.on('click.moodboardsEditor', '[data-action="select-images"]', () => {
            this._setActionPopoverOpen(null);
            this.$root.find('[data-role="image-input"]').trigger('click');
        });
        this.$root.on('click.moodboardsEditor', '[data-action="not-implemented"]', (event) => {
            const label = event.currentTarget.dataset.toolLabel || 'Инструмент';
            this._setActionPopoverOpen(null);
            this.notify(`Инструмент «${label}» пока не реализован в демо.`, 'info');
        });
        this.$root.on('change.moodboardsEditor', '[data-property]', (event) => {
            this._handlePropertyChange(event.currentTarget);
        });
        this.$root.on('input.moodboardsEditor', '[data-property="opacity"]', (event) => {
            this._renderOpacityValue(event.currentTarget.value);
        });
        this.$root.on('click.moodboardsEditor', '[data-property-action]', (event) => {
            this._handlePropertyAction(event.currentTarget);
        });
        this.$root.on('change.moodboardsEditor', '[data-object-property]:not([type="color"])', (event) => {
            this._handleObjectToolbarProperty(event.currentTarget);
        });
        this.$root.on('change.moodboardsEditor', '[data-role="frame-clip-toggle"]', (event) => {
            void this._handleObjectToolbarAction(event.currentTarget, event);
        });
        this.$root.on('input.moodboardsEditor', '[data-role="image-corner-radius-range"]', (event) => {
            const cornerRadius = Math.max(0, Math.min(1000, Math.round(Number(event.currentTarget.value) || 0)));
            this.$root.find('[data-role="image-corner-radius-value"]').text(`${cornerRadius} px`);
        });
        this.$root.on('input.moodboardsEditor', '[data-object-property][type="color"]', (event) => {
            this._debounceObjectToolbarColor(event.currentTarget);
        });
        this.$root.on('change.moodboardsEditor', '[data-object-property][type="color"]', (event) => {
            clearTimeout(this.colorInputTimer);
            this.colorInputTimer = null;
            this._handleObjectToolbarProperty(event.currentTarget);
        });
        this.$root.on('click.moodboardsEditor', '[data-object-action]', (event) => {
            if (event.currentTarget.matches('[data-role="frame-clip-toggle"]')) {
                return;
            }
            event.preventDefault();
            if (event.currentTarget.getAttribute('aria-disabled') === 'true') {
                return;
            }
            void this._handleObjectToolbarAction(event.currentTarget, event);
        });
        this.$root.on('keydown.moodboardsEditor', '[data-role="frame-clip-toggle"]', (event) => {
            if (!['Enter', ' '].includes(event.key) || event.currentTarget.getAttribute('aria-disabled') === 'true') {
                return;
            }
            event.preventDefault();
            this.$(event.currentTarget).trigger('click');
        });
        this.$root.on('input.moodboardsEditor', '[data-role="image-eraser-size"]', (event) => {
            this._setImageEraserSize(event.currentTarget.value);
        });
        this.$root.on('change.moodboardsEditor', '[data-role="image-eraser-size"]', (event) => {
            this._setImageEraserSize(event.currentTarget.value, { persist: true });
        });
        this.$root.on('click.moodboardsEditor', '[data-image-eraser-size]', (event) => {
            event.preventDefault();
            this._setImageEraserSize(event.currentTarget.dataset.imageEraserSize, { persist: true });
        });
        this.$root.on('submit.moodboardsEditor', '[data-role="toolbar-link-editor"]', (event) => {
            event.preventDefault();
            this._saveToolbarLink();
        });
        this.$root.on('change.moodboardsEditor', '[data-role="image-input"]', (event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = '';
            this._submitFiles(files);
        });
        this.$root.on('change.moodboardsEditor', '[data-role="replace-image-input"]', async (event) => {
            const [file] = Array.from(event.currentTarget.files || []);
            const elementId = this.imageReplacementElementId;
            event.currentTarget.value = '';
            this.imageReplacementElementId = null;
            if (!file || !elementId) {
                return;
            }
            try {
                await this.onReplaceImage(elementId, file);
                this.notify('Изображение заменено.', 'success');
            } catch (error) {
                this.notify(error?.message || 'Не удалось заменить изображение.', 'error');
            }
        });
        this.$root.on('dragenter.moodboardsEditor', '[data-role="canvas-shell"]', (event) => {
            if (!this._containsFiles(event.originalEvent)) {
                return;
            }
            event.preventDefault();
            this.dragDepth += 1;
            this._setDropTargetActive(true);
        });
        this.$root.on('dragover.moodboardsEditor', '[data-role="canvas-shell"]', (event) => {
            if (!this._containsFiles(event.originalEvent)) {
                return;
            }
            event.preventDefault();
            event.originalEvent.dataTransfer.dropEffect = 'copy';
        });
        this.$root.on('dragleave.moodboardsEditor', '[data-role="canvas-shell"]', (event) => {
            event.preventDefault();
            this.dragDepth = Math.max(0, this.dragDepth - 1);
            if (this.dragDepth === 0) {
                this._setDropTargetActive(false);
            }
        });
        this.$root.on('drop.moodboardsEditor', '[data-role="canvas-shell"]', (event) => {
            event.preventDefault();
            this.dragDepth = 0;
            this._setDropTargetActive(false);
            this._submitFiles(Array.from(event.originalEvent.dataTransfer?.files || []));
        });
        this.root.addEventListener('pointerdown', this.handleScenePointerDown, true);
        window.addEventListener('keydown', this.handleKeyboard, true);
        window.addEventListener('paste', this.handlePaste, true);
        window.addEventListener('pointerup', this.handleNavigatorPointerUp);

        this.unsubscribeStore = this.store.subscribe((event) => this.render(event));
        this.unsubscribeCommands = this.commandManager.subscribe((state) => this.renderHistory(state));
        this._renderSettings();
        this._renderPages();
        this._renderHelp();
        this._renderLayerMap();
    }

    render(event = {}) {
        const snapshot = this.store.getUiSnapshot();
        this._renderMultipagePdfAvailability();
        if (event.kind === 'moodboard-loaded' || event.kind === 'title-changed') {
            this.$root.find('[data-role="document-title"]')
                .text(snapshot.title)
                .attr('title', snapshot.title);
            this.$root.find('[data-role="project-name"]').val(snapshot.title);
            document.title = `${snapshot.title} — MoodBoards`;
        }

        if (
            event.kind === 'moodboard-loaded'
            || event.kind === 'document-changed'
            || event.kind === 'page-changed'
        ) {
            this._renderPages();
            this._renderNavigatorElements();
        }

        if (event.kind === 'save-status-changed' || event.kind === 'moodboard-loaded') {
            this._renderSaveStatus(snapshot.uiState.saveStatus, event.message || '');
        }

        if (
            event.kind === 'selection-changed'
            || event.kind === 'document-changed'
            || event.kind === 'page-changed'
            || event.kind === 'moodboard-loaded'
        ) {
            this._renderSelection(snapshot.uiState.selectedElementIds || []);
            this._renderCommandAvailability();
            this._renderLayerMap();
        }

        if (event.kind === 'viewport-changed' || event.kind === 'moodboard-loaded') {
            this._scheduleViewportRender(snapshot.uiState.viewport);
        }

        if (
            event.kind === 'viewport-changed'
            || event.kind === 'document-changed'
            || event.kind === 'page-changed'
            || event.kind === 'moodboard-loaded'
        ) {
            this._renderReturnToContent();
        }
    }

    renderHistory(state) {
        const undoLabel = state.undoBlocked
            ? 'Сначала отмените более новые изменения на связанном листе'
            : (state.undoLabel ? `Отменить: ${state.undoLabel}` : 'Нет изменений для отмены');
        const redoLabel = state.redoBlocked
            ? 'Сначала повторите связанные изменения на другом листе'
            : (state.redoLabel ? `Вернуть: ${state.redoLabel}` : 'Нет изменений для повтора');
        this.$root.find('[data-action="undo"]')
            .prop('disabled', !state.canUndo)
            .attr('aria-label', undoLabel)
            .attr('data-tooltip', undoLabel);
        this.$root.find('[data-action="redo"]')
            .prop('disabled', !state.canRedo)
            .attr('aria-label', redoLabel)
            .attr('data-tooltip', redoLabel);
    }

    _renderMultipagePdfAvailability() {
        const filledPageCount = selectFilledPages(this.store.getDocument()).length;
        this.$root.find('[data-role="multipage-pdf-option"]')
            .prop('hidden', filledPageCount <= 1);
    }

    showReady() {
        this.$root.find('[data-state="loading"]').prop('hidden', true);
        this.$root.find('[data-state="error"]').prop('hidden', true);
        this.$root.find('[data-role="canvas-shell"]').prop('hidden', false);
        this.$root.find('[data-editor-control]').prop('disabled', false);
        this.$root.find('.canvas-workspace').attr('aria-busy', 'false');
    }

    showError(message) {
        this.$root.find('[data-state="loading"]').prop('hidden', true);
        this.$root.find('[data-role="canvas-shell"]').prop('hidden', true);
        this.$root.find('[data-state="error"]').prop('hidden', false);
        this.$root.find('[data-role="error-message"]').text(message);
        this.$root.find('[data-editor-control]').prop('disabled', true);
        this.$root.find('[data-role="return-to-content"]').prop('hidden', true);
        this.$root.find('.canvas-workspace').attr('aria-busy', 'false');
    }

    addShape(shapeType) {
        if (!SUPPORTED_SHAPE_TYPES.includes(shapeType) || !SHAPE_PRESETS[shapeType]) {
            this.notify('Неизвестный тип фигуры.', 'error');
            return false;
        }
        const preset = SHAPE_PRESETS[shapeType];
        return this._beginObjectPlacement({
            kind: 'shape',
            shapeType,
            label: preset.label,
            minWidth: 24,
            minHeight: 24,
            aspectRatio: preset.width / preset.height,
            cornerRadius: preset.cornerRadius,
            previewFill: 'rgba(128, 148, 177, 0.22)',
        });
    }

    addRectangle() {
        return this.addShape('rectangle');
    }

    addCircle() {
        return this.addShape('circle');
    }

    activateSelectionTool() {
        this._setActiveTool('select');
    }

    addBrushStroke(stroke) {
        const type = stroke?.type === 'highlighter' ? 'highlighter' : 'brush';
        const allowedWidths = type === 'highlighter' ? [16, 28, 40, 56] : [2, 5, 10, 18];
        if (
            !stroke
            || !Array.isArray(stroke.points)
            || stroke.points.length < 2
            || !/^#[0-9a-f]{6}$/i.test(String(stroke.stroke || ''))
            || !allowedWidths.includes(Number(stroke.strokeWidth))
        ) {
            this.notify(`Не удалось создать штрих ${type === 'highlighter' ? 'выделителя' : 'кисти'}.`, 'error');
            return false;
        }
        const id = crypto.randomUUID();
        const changed = this.commandManager.execute(
            type === 'highlighter' ? 'Рисование выделителем' : 'Рисование кистью',
            (document) => {
                document.elements.push({
                    id,
                    type,
                    x: Number(stroke.x),
                    y: Number(stroke.y),
                    width: Number(stroke.width),
                    height: Number(stroke.height),
                    rotation: 0,
                    opacity: type === 'highlighter'
                        ? Math.min(0.75, Math.max(0.1, Number(stroke.opacity) || 0.35))
                        : 1,
                    points: [...stroke.points],
                    stroke: String(stroke.stroke).toLowerCase(),
                    strokeWidth: Number(stroke.strokeWidth),
                });
                const frameId = syncElementFrameMembership(document.elements, id);
                if (frameId) {
                    moveFrameBehindContents(document.elements, frameId);
                }
            },
        );
        if (changed) {
            this.store.setSelection(id);
            if (!this.toolLocked) {
                this._setActiveTool('select');
            }
        }
        return changed;
    }

    addArrow(arrow) {
        const geometry = normalizeArrowPoints(arrow?.points);
        const stroke = String(arrow?.stroke || '').toLowerCase();
        const strokeWidth = Number(arrow?.strokeWidth);
        const startCap = ARROW_CAP_TYPES.includes(arrow?.startCap) ? arrow.startCap : 'none';
        const endCap = ARROW_CAP_TYPES.includes(arrow?.endCap) ? arrow.endCap : 'arrow1';
        if (
            !geometry
            || !/^#[0-9a-f]{6}$/.test(stroke)
            || !ARROW_STROKE_WIDTHS.includes(strokeWidth)
        ) {
            this.notify('Не удалось создать стрелку или линию.', 'error');
            return false;
        }
        const id = crypto.randomUUID();
        const changed = this.commandManager.execute('Добавление стрелки или линии', (document) => {
            document.elements.push({
                id,
                type: 'arrow',
                x: geometry.x,
                y: geometry.y,
                width: geometry.width,
                height: geometry.height,
                rotation: 0,
                opacity: 1,
                points: [...geometry.points],
                stroke,
                strokeWidth,
                startCap,
                endCap,
                ...(arrow?.bindings ? { bindings: cloneValue(arrow.bindings) } : {}),
            });
            const frameId = syncElementFrameMembership(document.elements, id);
            if (frameId) {
                moveFrameBehindContents(document.elements, frameId);
            }
        });
        if (changed) {
            this.store.setSelection(id);
            if (!this.toolLocked) {
                this._setActiveTool('select');
            }
        }
        return changed;
    }

    addText() {
        return this._beginObjectPlacement({
            kind: 'text',
            label: 'текст',
            minWidth: 180,
            minHeight: 40,
            previewFill: 'rgba(49, 131, 255, 0.08)',
        });
    }

    addSticker() {
        return this._beginObjectPlacement({
            kind: 'sticker',
            label: 'стикер',
            minWidth: 120,
            minHeight: 100,
            cornerRadius: 14,
            previewFill: 'rgba(255, 223, 107, 0.48)',
        });
    }

    addPlacedObject(placement) {
        const bounds = placement?.bounds || {};
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const width = Number(bounds.width);
        const height = Number(bounds.height);
        if (![x, y, width, height].every(Number.isFinite) || width < 24 || height < 24) {
            return false;
        }
        const kind = placement.kind;
        const shapeType = placement.shapeType;
        if (
            !['shape', 'text', 'sticker'].includes(kind)
            || (kind === 'shape' && (!SUPPORTED_SHAPE_TYPES.includes(shapeType) || !SHAPE_PRESETS[shapeType]))
        ) {
            this.notify('Не удалось определить тип добавляемого объекта.', 'error');
            return false;
        }

        const id = crypto.randomUUID();
        const preset = kind === 'shape' ? SHAPE_PRESETS[shapeType] : null;
        const labels = { shape: `фигуры «${preset?.label}»`, text: 'текста', sticker: 'стикера' };
        const changed = this.commandManager.execute(`Добавление ${labels[kind]}`, (document) => {
            if (kind === 'shape') {
                document.elements.push({
                    id,
                    type: 'shape',
                    shapeType,
                    x,
                    y,
                    width,
                    height,
                    rotation: 0,
                    fill: preset.fill || '#8094b1',
                    stroke: '#707070',
                    strokeWidth: Number.isFinite(preset.strokeWidth) ? preset.strokeWidth : 1,
                    opacity: 1,
                    ...(Number.isFinite(preset.cornerRadius) ? { cornerRadius: preset.cornerRadius } : {}),
                });
            } else if (kind === 'text') {
                document.elements.push({
                    id,
                    type: 'text',
                    x,
                    y,
                    width,
                    height,
                    rotation: 0,
                    text: '',
                    fill: '#282828',
                    fontSize: Math.max(18, Math.min(72, Math.round(height * 0.58))),
                    fontFamily: 'Roboto',
                    fontStyle: 'normal',
                    align: 'left',
                    opacity: 1,
                });
            } else {
                document.elements.push({
                    id,
                    type: 'sticker',
                    x,
                    y,
                    width,
                    height,
                    rotation: 0,
                    text: 'Новая заметка',
                    fill: '#ffdf6b',
                    textColor: '#282828',
                    fontSize: Math.max(18, Math.min(40, Math.round(height * 0.11))),
                    fontFamily: 'Roboto',
                    fontStyle: 'normal',
                    align: 'left',
                    strokeWidth: 1,
                    opacity: 1,
                    hyperlink: null,
                });
            }
            const frameId = syncElementFrameMembership(document.elements, id);
            if (frameId) {
                moveFrameBehindContents(document.elements, frameId);
            }
        });
        if (!changed) {
            return false;
        }
        this.store.setSelection(id);
        if (!this.toolLocked || kind !== 'shape') {
            this._setActiveTool('select');
        }
        if (kind === 'text') {
            requestAnimationFrame(() => this.canvasAdapter.beginTextEditing(id));
        } else if (kind === 'sticker') {
            requestAnimationFrame(() => this.canvasAdapter.beginTextEditing(id, { selectAll: true }));
        }
        return true;
    }

    _beginObjectPlacement(options) {
        this.pendingPlacement = { ...options };
        this._setActiveTool('placement');
        this.notify(`Кликните или протяните область на холсте, чтобы добавить ${options.label}.`, 'info');
        return true;
    }

    addFrame(bounds) {
        const x = Number(bounds?.x);
        const y = Number(bounds?.y);
        const width = Number(bounds?.width);
        const height = Number(bounds?.height);
        if (
            ![x, y, width, height].every(Number.isFinite)
            || width < 24
            || height < 24
        ) {
            return false;
        }
        const id = crypto.randomUUID();
        const page = this.store.getActivePage();
        const frameNumber = (page?.elements.filter(({ type }) => type === 'frame').length || 0) + 1;
        const changed = this.commandManager.execute('Добавление фрейма', (document) => {
            document.elements.push({
                id,
                type: 'frame',
                name: `Фрейм ${frameNumber}`,
                x,
                y,
                width,
                height,
                rotation: 0,
                opacity: 1,
                stroke: '#3183ff',
                backgroundColor: '#ffffff',
                backgroundOpacity: 0,
                clipContent: true,
                layoutGridColumns: 0,
                layoutGridGap: 16,
                layoutGridPadding: 16,
                locked: false,
            });
            syncFrameMembership(document.elements, id);
            moveFrameBehindContents(document.elements, id);
        });
        if (changed) {
            this.store.setSelection(id);
            if (!this.toolLocked) {
                this._setActiveTool('select');
            }
        }
        return changed;
    }

    removeFrame(frameId = this.store.getSelectedElementId()) {
        const frame = this.store.getElement(frameId);
        if (!frame || frame.type !== 'frame' || frame.locked === true) {
            return false;
        }
        const changed = this.commandManager.execute('Удаление фрейма без содержимого', (document) => {
            document.elements = document.elements.filter(({ id }) => id !== frameId);
            for (const element of document.elements) {
                if (element.frameId === frameId) {
                    delete element.frameId;
                }
            }
        });
        if (changed) {
            this.store.setSelections([]);
            this.notify('Фрейм удалён, содержимое осталось на холсте.', 'success');
        }
        return changed;
    }

    deleteSelection() {
        return this.commandRegistry.execute('delete');
    }

    duplicateSelection() {
        return this.commandRegistry.execute('duplicate');
    }

    setUploadState({ active, current = 0, total = 0, fileName = '' }) {
        this.uploadActive = Boolean(active);
        this._renderActionPanelActiveTool();
        const $status = this.$root.find('[data-role="upload-status"]');
        const $progress = this.$root.find('[data-role="upload-progress"]');
        this.$root.find([
            '[data-action="select-images"]',
            '[data-role="image-input"]',
            '[data-role="replace-image-input"]',
            '[data-object-action="replace-image"]',
        ].join(', '))
            .prop('disabled', Boolean(active));
        $status
            .prop('hidden', !active)
            .attr('aria-busy', active ? 'true' : 'false');
        if (!active) {
            $progress.attr('value', 0).attr('max', Math.max(total, 1));
            return;
        }
        const visibleIndex = Math.min(current + 1, total);
        $progress.attr('max', Math.max(total, 1)).attr('value', current);
        this.$root.find('[data-role="upload-status-text"]')
            .text(`Обрабатываем ${visibleIndex} из ${total}${fileName ? `: ${fileName}` : ''}`);
    }

    setExportState({ status = 'idle', message = '', format = 'png' } = {}) {
        const active = status === 'exporting';
        const formatLabel = String(format).toUpperCase();
        const labels = {
            idle: 'Экспорт',
            exporting: 'Экспорт',
            error: 'Экспорт',
        };
        this.$root.find('[data-action="toggle-export"]')
            .prop('disabled', active)
            .attr('aria-busy', active ? 'true' : 'false')
            .attr('aria-label', active ? `Готовим ${formatLabel}-файл` : 'Выбрать формат экспорта');
        this.$root.find('[data-role="export-trigger-label"]').text(labels[status] || labels.idle);
        this.$root.find('[data-export-option]').prop('disabled', active || this.sharePending);
        this.$root.find('[data-role="export-status"]')
            .text(status === 'exporting' ? `Создаём ${formatLabel}-файл` : message)
            .prop('hidden', status === 'idle');
    }

    setShareState(active) {
        this.sharePending = Boolean(active);
        this.$root.find('[data-export-option]')
            .prop('disabled', this.sharePending)
            .filter('[data-action="create-share-link"]')
            .attr('aria-busy', this.sharePending ? 'true' : 'false');
        this.$root.find('[data-role="share-option-label"]')
            .text(this.sharePending ? 'Создаём ссылку…' : 'Создать публичную ссылку');
    }

    notify(message, type = 'info') {
        clearTimeout(this.notificationTimer);
        const $notification = this.$root.find('[data-role="notification"]');
        $notification
            .removeClass('editor-notification--error editor-notification--success editor-notification--info')
            .addClass(type === 'error' ? 'editor-notification--error' : (type === 'success' ? 'editor-notification--success' : 'editor-notification--info'))
            .attr('role', type === 'error' ? 'alert' : 'status')
            .text(message)
            .prop('hidden', false);
        this.notificationTimer = setTimeout(() => {
            $notification.prop('hidden', true);
        }, type === 'error' ? 7000 : 3500);
    }

    promptDraftRecovery({ updatedAt = null } = {}) {
        this._resolveDraftRecovery(false);
        const parsedDate = updatedAt ? new Date(updatedAt) : null;
        const dateLabel = parsedDate && Number.isFinite(parsedDate.getTime())
            ? parsedDate.toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            })
            : null;
        this.$root.find('[data-role="recovery-draft-message"]').text(
            dateLabel
                ? `Найден несохранённый черновик от ${dateLabel}. Восстановить его поверх последней сохранённой версии?`
                : 'Найдено состояние, которое не успело сохраниться. Восстановить его поверх последней сохранённой версии?',
        );
        this.$root.find('[data-role="recovery-draft"]').prop('hidden', false);
        return new Promise((resolve) => {
            this.recoveryDraftResolver = resolve;
            requestAnimationFrame(() => {
                this.$root.find('[data-action="restore-recovery-draft"]').trigger('focus');
            });
        });
    }

    _resolveDraftRecovery(restore) {
        if (!this.recoveryDraftResolver) {
            return false;
        }
        const resolve = this.recoveryDraftResolver;
        this.recoveryDraftResolver = null;
        this.$root.find('[data-role="recovery-draft"]').prop('hidden', true);
        resolve(Boolean(restore));
        return true;
    }

    _handleObjectToolbarProperty(control) {
        const property = control.dataset.objectProperty;
        const rawValue = this.$(control).val();
        const element = this.store.getElement(this.store.getSelectedElementId());
        if (property === 'rotation') {
            const numericValue = Number(rawValue);
            if (!element || !Number.isFinite(numericValue)) {
                this._renderContextualObjectTools(element);
                return;
            }
            const rotation = Math.max(-360, Math.min(360, Math.round(numericValue)));
            this._updateSelectedElement('Поворот объекта', { rotation });
            return;
        }
        if (property === 'text' && element?.type === 'sticker') {
            this._updateSelectedElement('Изменение текста стикера', {
                text: String(rawValue ?? '').slice(0, 2000),
            });
            return;
        }
        if (property === 'name' && element?.type === 'frame') {
            const name = String(rawValue || '').trim().slice(0, 80);
            if (!name) {
                this.notify('Название фрейма не может быть пустым.', 'error');
                this._renderContextualObjectTools(element);
                return;
            }
            this._updateSelectedElement('Переименование фрейма', { name });
            return;
        }
        if (property === 'layoutGridColumns' && element?.type === 'frame') {
            const columns = Number.parseInt(rawValue, 10);
            if ([0, 2, 3, 4, 6, 12].includes(columns)) {
                this._updateSelectedElement(
                    columns === 0 ? 'Отключение сетки фрейма' : 'Изменение сетки фрейма',
                    { layoutGridColumns: columns },
                );
            } else {
                this._renderContextualObjectTools(element);
            }
            return;
        }
        if (property === 'backgroundColor' && element?.type === 'frame') {
            const color = String(rawValue || '').toLowerCase();
            if (!/^#[0-9a-f]{6}$/.test(color)) {
                this._renderContextualObjectTools(element);
                return;
            }
            const patch = { backgroundColor: color };
            if (!(Number(element.backgroundOpacity) > 0)) {
                patch.backgroundOpacity = 1;
            }
            this._updateSelectedElement('Изменение фона фрейма', patch);
            return;
        }
        if (property === 'backgroundOpacity' && element?.type === 'frame') {
            const opacity = Number(rawValue);
            if (![0, 0.25, 0.5, 0.75, 1].includes(opacity)) {
                this._renderContextualObjectTools(element);
                return;
            }
            this._updateSelectedElement(
                opacity === 0 ? 'Отключение фона фрейма' : 'Изменение прозрачности фона фрейма',
                { backgroundOpacity: opacity },
            );
            return;
        }
        if (property === 'cornerRadius' && element?.type === 'image') {
            const cornerRadius = Number.parseInt(rawValue, 10);
            const isPreciseRange = control.matches?.('[data-role="image-corner-radius-range"]');
            if (
                !Number.isInteger(cornerRadius)
                || cornerRadius < 0
                || cornerRadius > 1000
                || (!isPreciseRange && ![0, 8, 16, 24, 40, 64].includes(cornerRadius))
            ) {
                this._renderContextualObjectTools(element);
                return;
            }
            this._updateSelectedElement(
                cornerRadius === 0
                    ? 'Отключение скругления изображения'
                    : 'Изменение скругления изображения',
                { cornerRadius },
            );
            return;
        }
        if (['fill', 'stroke', 'textColor'].includes(property)) {
            const color = String(rawValue || '').toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(color)) {
                if (element?.[property] === color) {
                    return;
                }
                const isDrawingStroke = ['brush', 'highlighter', 'arrow'].includes(element?.type) && property === 'stroke';
                const label = element?.type === 'sticker'
                    ? (property === 'fill' ? 'Изменение цвета стикера' : 'Изменение цвета текста стикера')
                    : (isDrawingStroke
                        ? `Изменение цвета ${element.type === 'highlighter'
                            ? 'выделителя'
                            : (element.type === 'arrow' ? 'линии' : 'кисти')}`
                        : (property === 'fill' ? 'Изменение цвета' : 'Изменение обводки'));
                this._updateSelectedElement(
                    label,
                    { [property]: color },
                );
                if (element?.type === 'brush' && property === 'stroke') {
                    this._setBrushSettings({ stroke: color });
                } else if (element?.type === 'highlighter' && property === 'stroke') {
                    this._setHighlighterSettings({ stroke: color });
                } else if (element?.type === 'arrow' && property === 'stroke') {
                    this._setArrowSettings({ stroke: color });
                }
            }
            return;
        }
        if (property === 'strokeWidth') {
            const strokeWidth = Number(rawValue);
            const allowedWidths = element?.type === 'brush'
                ? [2, 5, 10, 18]
                : (element?.type === 'highlighter'
                    ? [16, 28, 40, 56]
                    : (element?.type === 'arrow' ? ARROW_STROKE_WIDTHS : [0, 1, 3, 6]));
            if (allowedWidths.includes(strokeWidth)) {
                this._updateSelectedElement(
                    element?.type === 'brush'
                        ? 'Толщина кисти'
                        : (element?.type === 'highlighter'
                            ? 'Толщина выделителя'
                            : (element?.type === 'arrow' ? 'Толщина линии' : 'Толщина рамки')),
                    { strokeWidth },
                );
                if (element?.type === 'brush') {
                    this._setBrushSettings({ strokeWidth });
                } else if (element?.type === 'highlighter') {
                    this._setHighlighterSettings({ strokeWidth });
                } else if (element?.type === 'arrow') {
                    this._setArrowSettings({ strokeWidth });
                }
            }
            return;
        }
        if (['startCap', 'endCap'].includes(property)) {
            const cap = String(rawValue || '');
            if (element?.type === 'arrow' && ARROW_CAP_TYPES.includes(cap)) {
                this._updateSelectedElement(
                    property === 'startCap' ? 'Начало линии' : 'Конец линии',
                    { [property]: cap },
                );
                this._setArrowSettings({ [property]: cap });
            }
            return;
        }
        if (property === 'opacity') {
            const opacity = Math.min(1, Math.max(0.05, Number(rawValue) || 1));
            this._updateSelectedElement(
                element?.type === 'highlighter' ? 'Прозрачность выделителя' : 'Прозрачность фигуры',
                { opacity },
            );
            if (element?.type === 'highlighter') {
                this._setHighlighterSettings({ opacity });
            }
            return;
        }
        if (property === 'fontFamily') {
            const fontFamilies = ['Roboto', 'Inter', 'Georgia', 'Comic Sans MS', 'Roboto Condensed'];
            if (fontFamilies.includes(rawValue)) {
                this._updateSelectedElement('Изменение шрифта', { fontFamily: rawValue });
            }
            return;
        }
        if (property === 'fontSize' && ['text', 'sticker'].includes(element?.type)) {
            const numericValue = String(rawValue ?? '').trim() === '' ? Number.NaN : Number(rawValue);
            if (!Number.isFinite(numericValue)) {
                this._renderContextualObjectTools(element);
                return;
            }
            const fontSize = Math.min(240, Math.max(8, Math.round(numericValue)));
            this._updateSelectedElement('Изменение размера шрифта', { fontSize });
        }
    }

    _debounceObjectToolbarColor(control) {
        clearTimeout(this.colorInputTimer);
        this.colorInputTimer = window.setTimeout(() => {
            this.colorInputTimer = null;
            this._handleObjectToolbarProperty(control);
        }, 150);
    }

    _setBrushSettings(patch) {
        const next = { ...this.brushSettings };
        if (typeof patch.stroke === 'string' && /^#[0-9a-f]{6}$/i.test(patch.stroke)) {
            next.stroke = patch.stroke.toLowerCase();
        }
        if ([2, 5, 10, 18].includes(Number(patch.strokeWidth))) {
            next.strokeWidth = Number(patch.strokeWidth);
        }
        this.brushSettings = next;
        if (this.activeTool === 'brush') {
            this.canvasAdapter.setBrushOptions({ type: 'brush', opacity: 1, ...next });
        }
    }

    _setHighlighterSettings(patch) {
        const next = { ...this.highlighterSettings };
        if (typeof patch.stroke === 'string' && /^#[0-9a-f]{6}$/i.test(patch.stroke)) {
            next.stroke = patch.stroke.toLowerCase();
        }
        if ([16, 28, 40, 56].includes(Number(patch.strokeWidth))) {
            next.strokeWidth = Number(patch.strokeWidth);
        }
        const opacity = Number(patch.opacity);
        if (Number.isFinite(opacity) && opacity >= 0.1 && opacity <= 0.75) {
            next.opacity = opacity;
        }
        this.highlighterSettings = next;
        if (this.activeTool === 'highlighter') {
            this.canvasAdapter.setBrushOptions({ type: 'highlighter', ...next });
        }
    }

    _setArrowSettings(patch) {
        const next = { ...this.arrowSettings };
        if (typeof patch.stroke === 'string' && /^#[0-9a-f]{6}$/i.test(patch.stroke)) {
            next.stroke = patch.stroke.toLowerCase();
        }
        if (ARROW_STROKE_WIDTHS.includes(Number(patch.strokeWidth))) {
            next.strokeWidth = Number(patch.strokeWidth);
        }
        if (ARROW_CAP_TYPES.includes(patch.startCap)) {
            next.startCap = patch.startCap;
        }
        if (ARROW_CAP_TYPES.includes(patch.endCap)) {
            next.endCap = patch.endCap;
        }
        this.arrowSettings = next;
        if (this.activeTool === 'arrow') {
            this.canvasAdapter.setArrowOptions(next);
        }
    }

    async _handleObjectToolbarAction(control, event = null) {
        const action = control.dataset.objectAction;
        if (action === 'toggle-contextual-more') {
            const pointerClick = this._supportsHover() && Number(event?.detail) > 0;
            this._setContextualMoreOpen(pointerClick ? true : !this.contextualMoreOpen, { focus: true });
            return;
        }
        const element = this.store.getElement(this.store.getSelectedElementId());
        if (!element) {
            return;
        }
        if (action === 'toggle-align-popover') {
            const pointerClick = this._supportsHover() && Number(event?.detail) > 0;
            this._setAlignmentPopoverOpen(pointerClick ? true : !this.alignmentPopoverOpen, { focus: true });
            return;
        }
        if (action === 'step-font-size' && ['text', 'sticker'].includes(element.type)) {
            const step = Number(control.dataset.step) === -1 ? -1 : 1;
            const currentSize = Math.min(240, Math.max(8, Math.round(Number(element.fontSize) || 24)));
            const fontSize = Math.min(240, Math.max(8, currentSize + step));
            if (fontSize !== currentSize) {
                this._updateSelectedElement('Изменение размера шрифта', { fontSize });
            }
            return;
        }
        if (action === 'flip-x' || action === 'flip-y') {
            this._toggleSelectedImageFlip(action === 'flip-x' ? 'horizontal' : 'vertical');
            return;
        }
        if (action === 'remove-background' && element.type === 'image') {
            await this._removeSelectedImageBackground(element, control);
            return;
        }
        if (action === 'toggle-image-eraser' && element.type === 'image') {
            if (this.activeTool === 'image-eraser') {
                this._setActiveTool('select');
            } else if (element.locked !== true) {
                this.imageEraserElementId = element.id;
                this.imageEraserSettingsOpen = true;
                this._setActiveTool('image-eraser');
                this.notify('Проведите ластиком по изображению. Каждый штрих можно отменить.', 'info');
            }
            return;
        }
        if (action === 'finish-image-eraser') {
            this.imageEraserSettingsOpen = false;
            this._setActiveTool('select');
            return;
        }
        if (action === 'clear-image-erase-mask' && element.type === 'image') {
            if (hasImageEraseMask(element.eraseMask) && this.onClearImageEraseMask(element.id)) {
                this.notify('Ручная маска очищена.', 'success');
            }
            return;
        }
        if (action === 'replace-image' && element.type === 'image') {
            if (this.uploadActive) {
                this.notify('Дождитесь завершения обработки изображения.', 'info');
                return;
            }
            this.imageReplacementElementId = element.id;
            this._setContextualMoreOpen(false);
            this.$root.find('[data-role="replace-image-input"]').val('').trigger('click');
            return;
        }
        if (action === 'toggle-lock') {
            this._toggleSelectionLock();
            this._setContextualMoreOpen(false, { restoreFocus: true });
            return;
        }
        if (action === 'toggle-frame-clip' && element.type === 'frame') {
            this._updateSelectedElement(
                element.clipContent === false
                    ? 'Включение обрезки содержимого фрейма'
                    : 'Отключение обрезки содержимого фрейма',
                { clipContent: element.clipContent === false },
            );
            return;
        }
        if (action === 'remove-frame') {
            this.removeFrame(element.id);
            return;
        }
        if (action === 'set-align' && ['left', 'center', 'right'].includes(control.dataset.value)) {
            this._updateSelectedElement('Выравнивание текста', { align: control.dataset.value });
            this._setAlignmentPopoverOpen(false, { restoreFocus: true });
            return;
        }
        if (action === 'edit-link') {
            this._setContextualMoreOpen(false);
            this._setToolbarLinkEditorOpen(!this.toolbarLinkEditorOpen, { focus: true });
            return;
        }
        if (action === 'remove-link') {
            if (this._updateSelectedElement('Удаление ссылки', { hyperlink: null })) {
                this._setToolbarLinkEditorOpen(false, { restoreFocus: true });
                this.notify('Ссылка удалена.', 'success');
            }
            return;
        }
        if (action === 'pick-color') {
            await this._pickObjectToolbarColor(control.dataset.colorProperty);
        }
    }

    async _removeSelectedImageBackground(element, control) {
        if (element.backgroundRemoved === true) {
            this.notify('Фон у этого изображения уже удалён.', 'info');
            return;
        }
        if (this.backgroundRemovalElementId !== null) {
            this.notify('Генерация удаления фона уже запущена.', 'info');
            return;
        }
        if (element.locked === true) {
            return;
        }
        this.backgroundRemovalElementId = element.id;
        this._renderBackgroundRemovalState(control, element);
        try {
            await this.onRemoveImageBackground(element.id);
            this.notify('Фон изображения удалён.', 'success');
        } catch (error) {
            this.notify(error?.message || 'Не удалось удалить фон изображения.', 'error');
        } finally {
            if (this.backgroundRemovalElementId === element.id) {
                this.backgroundRemovalElementId = null;
            }
            this._renderBackgroundRemovalState(control);
        }
    }

    _renderBackgroundRemovalState(control, element = null) {
        const selectedElement = element || this.store.getElement(this.store.getSelectedElementId());
        const removalPending = this.backgroundRemovalElementId === selectedElement?.id;
        const removalComplete = selectedElement?.backgroundRemoved === true && !removalPending;
        const disabled = selectedElement?.locked === true;
        const $control = this.$(control);
        $control
            .toggleClass('is-loading', removalPending)
            .toggleClass('is-complete', removalComplete)
            .prop('disabled', disabled)
            .attr('aria-busy', String(removalPending))
            .attr('aria-pressed', String(removalComplete))
            .attr(
                'aria-label',
                removalPending ? 'ИИ удаляет фон' : (removalComplete ? 'Фон удалён' : 'ИИ удаление фона'),
            )
            .attr(
                'data-tooltip',
                removalPending
                    ? 'ИИ удаляет фон…'
                    : (removalComplete ? 'Фон удалён' : 'ИИ удаление фона'),
            );
    }

    _toggleSelectedImageFlip(direction) {
        const element = this.store.getElement(this.store.getSelectedElementId());
        if (!element || element.type !== 'image' || element.locked === true) {
            return false;
        }
        const horizontal = direction === 'horizontal';
        const property = horizontal ? 'flipX' : 'flipY';
        return this._updateSelectedElement(
            horizontal ? 'Отражение по горизонтали' : 'Отражение по вертикали',
            { [property]: element[property] !== true },
        );
    }

    _setImageEraserSize(value, { persist = false } = {}) {
        const size = Math.min(256, Math.max(8, Math.round(Number(value) || 64)));
        this.imageEraserSize = size;
        this.settings.imageEraserSize = size;
        this.canvasAdapter.setImageEraserSize(size);
        this.$root.find('[data-role="image-eraser-size"]').val(String(size));
        this.$root.find('[data-role="image-eraser-size-value"]').text(`${size} px`);
        this.$root.find('[data-image-eraser-size]')
            .attr('aria-pressed', 'false')
            .filter(`[data-image-eraser-size="${size}"]`)
            .attr('aria-pressed', 'true');
        if (persist) {
            this.onSettingsChange({ ...this.settings });
        }
    }

    _renderImageEraserState(element = null) {
        const eraserActive = Boolean(
            element?.type === 'image'
            && this.activeTool === 'image-eraser'
            && this.imageEraserElementId === element.id
        );
        const settingsOpen = eraserActive;
        const $toolbar = this.$root.find('[data-role="contextual-toolbar"]');
        $toolbar.find('[data-object-action="toggle-image-eraser"]')
            .attr('aria-pressed', String(eraserActive))
            .attr('aria-expanded', String(settingsOpen))
            .attr('data-tooltip', eraserActive ? 'Настройки ручного ластика' : 'Ручное удаление фона');
        $toolbar.find('[data-role="image-eraser-popover"]').prop('hidden', !settingsOpen);
        $toolbar.find('[data-object-action="clear-image-erase-mask"]')
            .prop('disabled', element?.locked === true || !hasImageEraseMask(element?.eraseMask));
        this._setImageEraserSize(this.imageEraserSize);
        if (settingsOpen) {
            this.positionContextualToolbar();
        }
    }

    async _pickObjectToolbarColor(property) {
        if (!['fill', 'stroke', 'textColor'].includes(property)) {
            return;
        }
        if (typeof globalThis.EyeDropper !== 'function') {
            this.notify('Пипетка не поддерживается этим браузером. Используйте палитру цвета.', 'info');
            return;
        }
        try {
            const result = await new globalThis.EyeDropper().open();
            const color = String(result?.sRGBHex || '').toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(color)) {
                this._updateSelectedElement('Выбор цвета пипеткой', { [property]: color });
                const element = this.store.getElement(this.store.getSelectedElementId());
                if (element?.type === 'brush' && property === 'stroke') {
                    this._setBrushSettings({ stroke: color });
                } else if (element?.type === 'highlighter' && property === 'stroke') {
                    this._setHighlighterSettings({ stroke: color });
                } else if (element?.type === 'arrow' && property === 'stroke') {
                    this._setArrowSettings({ stroke: color });
                }
            }
        } catch (error) {
            if (error?.name !== 'AbortError') {
                this.notify('Не удалось выбрать цвет пипеткой.', 'error');
            }
        }
    }

    _setToolbarLinkEditorOpen(open, { focus = false, restoreFocus = false } = {}) {
        const element = this.store.getElement(this.store.getSelectedElementId());
        const supported = element && ['image', 'shape', 'rectangle', 'sticker'].includes(element.type);
        this.toolbarLinkEditorOpen = Boolean(open && supported && element.locked !== true);
        const $editor = this.$root.find('[data-role="toolbar-link-editor"]');
        const $trigger = this.$root.find('[data-object-action="edit-link"]:not([hidden])');
        $editor.prop('hidden', !this.toolbarLinkEditorOpen);
        $trigger.attr('aria-expanded', String(this.toolbarLinkEditorOpen));
        if (this.toolbarLinkEditorOpen) {
            this.$root.find('[data-role="toolbar-link-input"]').val(element.hyperlink || '');
            if (focus) {
                requestAnimationFrame(() => this.$root.find('[data-role="toolbar-link-input"]').trigger('focus'));
            }
        } else if (restoreFocus) {
            this.$root.find('[data-role="contextual-more-trigger"]').trigger('focus');
        }
    }

    _setAlignmentPopoverOpen(open, { focus = false, restoreFocus = false } = {}) {
        clearTimeout(this.alignmentPopoverCloseTimer);
        this.alignmentPopoverCloseTimer = null;
        const $trigger = this.$root.find('[data-role="align-trigger"]:visible');
        const canOpen = $trigger.length > 0 && !$trigger.prop('disabled');
        this.alignmentPopoverOpen = Boolean(open && canOpen);
        $trigger.attr('aria-expanded', String(this.alignmentPopoverOpen));
        this.$root.find('[data-role="align-popover"]').prop('hidden', !this.alignmentPopoverOpen);
        if (this.alignmentPopoverOpen && focus) {
            requestAnimationFrame(() => {
                this.$root.find('[data-role="align-popover"] [aria-pressed="true"]:not(:disabled)')
                    .first()
                    .trigger('focus');
            });
        } else if (!this.alignmentPopoverOpen && restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _setContextualMoreOpen(open, { focus = false, restoreFocus = false } = {}) {
        clearTimeout(this.contextualMoreCloseTimer);
        this.contextualMoreCloseTimer = null;
        const $trigger = this.$root.find('[data-role="contextual-more-trigger"]');
        const canOpen = $trigger.length > 0 && !$trigger.prop('disabled');
        this.contextualMoreOpen = Boolean(open && canOpen);
        this.contextualMoreElementId = this.contextualMoreOpen
            ? this.store.getSelectedElementId()
            : null;
        $trigger.attr('aria-expanded', String(this.contextualMoreOpen));
        const $menu = this.$root.find('[data-role="contextual-more-menu"]');
        $menu.prop('hidden', !this.contextualMoreOpen);
        if (this.contextualMoreOpen && focus) {
            requestAnimationFrame(() => {
                $menu.find('[role="menuitem"]:not(:disabled):not([hidden])').first().trigger('focus');
            });
        } else if (!this.contextualMoreOpen && restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _saveToolbarLink() {
        const input = this.$root.find('[data-role="toolbar-link-input"]')[0];
        const rawValue = String(input?.value || '').trim();
        if (!rawValue) {
            this.notify('Введите адрес ссылки.', 'error');
            input?.focus();
            return;
        }
        let hyperlink;
        try {
            const url = new URL(rawValue);
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('unsupported protocol');
            }
            hyperlink = url.toString();
        } catch (_) {
            this.notify('Введите корректный адрес http:// или https://.', 'error');
            input?.focus();
            return;
        }
        if (this._updateSelectedElement('Изменение ссылки', { hyperlink })) {
            this._setToolbarLinkEditorOpen(false, { restoreFocus: true });
            this.notify('Ссылка сохранена.', 'success');
        }
    }

    _handlePropertyChange(control) {
        const property = control.dataset.property;
        const rawValue = this.$(control).val();

        if (property === 'text') {
            const text = String(rawValue ?? '').slice(0, 2000);
            this._updateSelectedElement('Изменение текста', { text });
            return;
        }
        if (property === 'fontSize') {
            const fontSize = Math.min(240, Math.max(8, Math.round(Number(rawValue) || 8)));
            this._updateSelectedElement('Размер текста', { fontSize });
            return;
        }
        if (property === 'fill') {
            const fill = String(rawValue).toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(fill)) {
                this._updateSelectedElement('Цвет объекта', (element) => ({
                    fill,
                    ...(element.type === 'rectangle' ? { type: 'shape', shapeType: 'rectangle' } : {}),
                }));
            }
            return;
        }
        if (property === 'opacity') {
            const opacity = Math.min(1, Math.max(0.05, Number(rawValue) || 0.05));
            this._updateSelectedElement('Прозрачность фигуры', (element) => ({
                opacity,
                ...(element.type === 'rectangle' ? { type: 'shape', shapeType: 'rectangle' } : {}),
            }));
            return;
        }
        if (property === 'shapeType' && SUPPORTED_SHAPE_TYPES.includes(rawValue)) {
            this._updateSelectedElement('Тип фигуры', (element) => {
                const patch = { type: 'shape', shapeType: rawValue };
                if (rawValue === 'circle') {
                    const side = Math.max(48, Math.min(element.width, element.height));
                    patch.width = side;
                    patch.height = side;
                }
                return patch;
            });
        }
    }

    _handlePropertyAction(control) {
        const action = control.dataset.propertyAction;
        const element = this.store.getElement(this.store.getSelectedElementId());
        if (!element || element.type !== 'text') {
            return;
        }
        if (action === 'toggle-bold') {
            this._updateSelectedElement('Начертание текста', {
                fontStyle: element.fontStyle === 'bold' ? 'normal' : 'bold',
            });
            return;
        }
        if (action === 'set-align' && ['left', 'center', 'right'].includes(control.dataset.value)) {
            this._updateSelectedElement('Выравнивание текста', { align: control.dataset.value });
        }
    }

    _updateSelectedElement(label, patchOrFactory) {
        const selectedElementId = this.store.getSelectedElementId();
        const selectedElement = this.store.getElement(selectedElementId);
        if (!selectedElementId || selectedElement?.locked === true) {
            return false;
        }
        return this.commandManager.execute(label, (document) => {
            const element = document.elements.find(({ id }) => id === selectedElementId);
            if (!element) {
                return;
            }
            const patch = typeof patchOrFactory === 'function'
                ? patchOrFactory(element)
                : patchOrFactory;
            Object.assign(element, patch);
        });
    }

    openCanvasContextMenu({
        elementId = null,
        preserveSelection = false,
        clientX = 0,
        clientY = 0,
    } = {}) {
        const selectedElementIds = this.store.getSelectedElementIds();
        const shouldPreserveSelection = preserveSelection && selectedElementIds.length > 0;
        if (!shouldPreserveSelection) {
            if (elementId && this.store.getElement(elementId)) {
                if (!selectedElementIds.includes(elementId)) {
                    this.store.setSelections(expandGroupedSelectionIds(
                        this.store.getActivePage()?.elements,
                        [elementId],
                    ));
                }
            } else {
                this.store.setSelections([]);
            }
        }
        this._setNavigatorOpen(false);
        this._setHelpOpen(false);
        this.contextMenuOpen = true;
        this._renderContextMenu();

        const workspace = this.$root.find('.canvas-workspace').get(0);
        const menu = this.$root.find('[data-role="canvas-context-menu"]')
            .prop('hidden', false)
            .get(0);
        if (!(workspace instanceof HTMLElement) || !(menu instanceof HTMLElement)) {
            return;
        }
        const workspaceRect = workspace.getBoundingClientRect();
        requestAnimationFrame(() => {
            const left = Math.max(8, Math.min(
                clientX - workspaceRect.left,
                workspaceRect.width - menu.offsetWidth - 8,
            ));
            const top = Math.max(8, Math.min(
                clientY - workspaceRect.top,
                workspaceRect.height - menu.offsetHeight - 8,
            ));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
        });
    }

    _renderContextMenu() {
        const $menu = this.$root.find('[data-role="canvas-context-menu"]').empty();
        const elements = this.store.getSelectedElementIds()
            .map((id) => this.store.getElement(id))
            .filter(Boolean);
        const hasSelection = elements.length > 0;
        $menu.attr(
            'aria-label',
            hasSelection
                ? `Действия с выбранными объектами: ${elements.length}`
                : 'Действия с холстом',
        );
        const addSeparator = () => this.$('<span>', {
            class: 'canvas-context-menu__separator',
            role: 'separator',
        }).appendTo($menu);
        const addHeading = (text) => this.$('<span>', {
            class: 'canvas-context-menu__heading',
            text,
        }).appendTo($menu);
        const addItem = (action, label, shortcut = '', options = {}) => {
            const $button = this.$('<button>', {
                class: `canvas-context-menu__item${options.danger ? ' canvas-context-menu__item--danger' : ''}`,
                type: 'button',
                role: 'menuitem',
                disabled: Boolean(options.disabled),
                'data-context-action': action,
                'data-page-id': options.pageId,
                'data-command': options.command,
                'data-format': options.format,
            });
            this.$('<span>', { text: label }).appendTo($button);
            if (shortcut) {
                this.$('<kbd>', { text: shortcut }).appendTo($button);
            }
            $button.appendTo($menu);
            return $button;
        };

        if (!hasSelection) {
            addItem('paste', 'Вставить', 'Ctrl+V');
            addItem('select-all', 'Выбрать всё', 'Ctrl+A', {
                disabled: (this.store.getActivePage()?.elements.length || 0) === 0,
            });
            return;
        }

        const anyLocked = elements.some(({ locked }) => locked === true);
        const allLocked = elements.every(({ locked }) => locked === true);
        const selectedFrame = elements.length === 1 && elements[0].type === 'frame'
            ? elements[0]
            : null;
        if (elements.length > 1) {
            addHeading(getSelectionSummary(elements));
        }
        addItem('cut', 'Вырезать', 'Ctrl+X', { disabled: anyLocked });
        addItem('copy', 'Копировать', 'Ctrl+C');
        addItem('paste', 'Вставить', 'Ctrl+V');
        addItem('editor-command', 'Дублировать', 'Ctrl+D', {
            command: 'duplicate',
            disabled: anyLocked || !this.commandRegistry.canExecute('duplicate'),
        });
        addItem('editor-command', 'Сгруппировать', 'Ctrl+G', {
            command: 'group',
            disabled: !this.commandRegistry.canExecute('group'),
        });
        addItem('editor-command', 'Разгруппировать', 'Ctrl+Shift+G', {
            command: 'ungroup',
            disabled: !this.commandRegistry.canExecute('ungroup'),
        });
        addSeparator();
        addHeading('Скопировать как');
        addItem('copy-png', 'PNG');
        addItem('copy-json', 'JSON');
        addHeading('Экспортировать как');
        addItem('export-element', 'PNG', '', { format: 'png' });
        addItem('export-element', 'PDF', '', { format: 'pdf' });
        addSeparator();
        addHeading('Переупорядочить');
        for (const [command, label, shortcut] of [
            ['bring-to-front', 'На передний план', '↑'],
            ['bring-forward', 'Поднять выше', 'Shift + ↑'],
            ['send-backward', 'Опустить ниже', 'Shift + ↓'],
            ['send-to-back', 'На задний план', '↓'],
        ]) {
            addItem('editor-command', label, shortcut, {
                command,
                disabled: anyLocked || !this.commandRegistry.canExecute(command),
            });
        }
        if (elements.length > 1) {
            addSeparator();
            addHeading('Выровнять');
            for (const [command, label, shortcut] of [
                ['align-top', 'По верхнему краю', 'Alt+W'],
                ['align-vertical', 'По вертикали', 'Alt+V'],
                ['align-bottom', 'По нижнему краю', 'Alt+S'],
                ['align-left', 'По левому краю', 'Alt+A'],
                ['align-horizontal', 'По горизонтали', 'Alt+H'],
                ['align-right', 'По правому краю', 'Alt+D'],
            ]) {
                addItem('editor-command', label, shortcut, {
                    command,
                    disabled: anyLocked || !this.commandRegistry.canExecute(command),
                });
            }
        }
        const pages = this.store.getPages().filter(({ id }) => id !== this.store.getActivePageId());
        if (pages.length > 0) {
            addSeparator();
            addHeading('Перенести на страницу');
            for (const page of pages) {
                addItem('move-to-page', page.name, '', { pageId: page.id, disabled: anyLocked });
            }
        }
        addSeparator();
        if (selectedFrame) {
            addItem('remove-frame', 'Удалить только фрейм', '', { disabled: anyLocked });
        }
        addItem('toggle-lock', allLocked ? 'Разблокировать' : 'Заблокировать');
        addItem('delete', 'Удалить', 'Delete', { danger: true, disabled: anyLocked });
    }

    async _executeContextAction(control) {
        const action = control.dataset.contextAction;
        const selectedElementIds = this.store.getSelectedElementIds();
        const effectiveElementIds = this._expandFrameSelectionIds(selectedElementIds);
        try {
            if (action === 'copy') {
                await this._copySelection();
            } else if (action === 'cut') {
                await this._cutSelection();
            } else if (action === 'paste') {
                await this._pasteFromSystemClipboard();
            } else if (action === 'select-all') {
                this._selectAll();
            } else if (action === 'copy-json') {
                await this._copySelectionAsJson();
            } else if (action === 'copy-png') {
                await this._copySelectionAsPng();
            } else if (action === 'export-element') {
                await this.onExportElement(control.dataset.format, effectiveElementIds);
            } else if (action === 'editor-command') {
                this.commandRegistry.execute(control.dataset.command);
            } else if (action === 'move-to-page') {
                this._moveSelectionToPage(control.dataset.pageId);
            } else if (action === 'toggle-lock') {
                this._toggleSelectionLock();
            } else if (action === 'remove-frame') {
                this.removeFrame(selectedElementIds[0]);
            } else if (action === 'delete') {
                this.deleteSelection();
            }
        } catch (error) {
            this.notify(error?.message || 'Не удалось выполнить команду.', 'error');
        }
        this._closeContextMenu();
    }

    async _copySelection() {
        const elements = this._expandFrameSelectionIds(this.store.getSelectedElementIds())
            .map((id) => this.store.getElement(id))
            .filter(Boolean);
        if (elements.length === 0) {
            return false;
        }
        this.clipboardElements = cloneValue(elements);
        this.pasteOffset = 0;
        const clipboardPayload = elements.length === 1 ? elements[0] : elements;
        this.internalClipboardText = JSON.stringify(clipboardPayload);
        try {
            await navigator.clipboard?.writeText(this.internalClipboardText);
        } catch (_) {
            // Внутренний clipboard редактора остаётся доступен без системного разрешения.
        }
        this.notify(elements.length === 1 ? 'Объект скопирован.' : `Скопировано объектов: ${elements.length}.`, 'success');
        return true;
    }

    async _cutSelection() {
        const elements = this._expandFrameSelectionIds(this.store.getSelectedElementIds())
            .map((id) => this.store.getElement(id))
            .filter(Boolean);
        if (elements.length === 0 || elements.some(({ locked }) => locked === true)) {
            return false;
        }
        await this._copySelection();
        const changed = this.deleteSelection();
        if (changed) {
            this.notify(elements.length === 1 ? 'Объект вырезан.' : `Вырезано объектов: ${elements.length}.`, 'success');
        }
        return changed;
    }

    _pasteClipboard() {
        if (this.clipboardElements.length === 0) {
            return false;
        }
        const sources = cloneValue(this.clipboardElements);
        this.pasteOffset = (this.pasteOffset % 6) + 1;
        const offset = this.pasteOffset * 24;
        const pastedIds = [];
        const changed = this.commandManager.execute(
            sources.length === 1 ? 'Вставка объекта' : 'Вставка объектов',
            (page) => {
                const reservedIds = new Set(page.elements.map(({ id }) => id));
                const idMap = new Map(sources.map((source) => {
                    let id;
                    do {
                        id = crypto.randomUUID();
                    } while (reservedIds.has(id));
                    reservedIds.add(id);
                    return [source.id, id];
                }));
                const groupIdMap = new Map(
                    [...collectGroupIds(sources)]
                        .map((groupId) => [groupId, `group-${crypto.randomUUID()}`]),
                );
                const pasted = sources.map((source) => {
                    const id = idMap.get(source.id);
                    pastedIds.push(id);
                    return {
                        ...source,
                        id,
                        x: Number(source.x || 0) + offset,
                        y: Number(source.y || 0) + offset,
                        locked: false,
                        ...(idMap.has(source.frameId) ? { frameId: idMap.get(source.frameId) } : {}),
                        ...remapElementGroups(source, groupIdMap),
                        ...(source.type === 'arrow' && source.bindings
                            ? { bindings: remapArrowBindings(source.bindings, idMap) }
                            : {}),
                    };
                });
                page.elements.push(...pasted);
            },
        );
        if (changed) {
            this.store.setSelections(pastedIds);
            this.notify(pastedIds.length === 1 ? 'Объект вставлен.' : `Вставлено объектов: ${pastedIds.length}.`, 'success');
        }
        return changed;
    }

    _selectAll() {
        const ids = this.store.getActivePage()?.elements.map(({ id }) => id) || [];
        if (ids.length === 0) {
            return false;
        }
        this.store.setSelections(ids);
        this.notify(`Выбрано объектов: ${ids.length}.`, 'success');
        return true;
    }

    async _copySelectionAsJson() {
        const elements = this._expandFrameSelectionIds(this.store.getSelectedElementIds())
            .map((id) => this.store.getElement(id))
            .filter(Boolean);
        if (elements.length === 0) {
            return false;
        }
        const payload = elements.length === 1 ? elements[0] : elements;
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            this.notify(elements.length === 1 ? 'JSON объекта скопирован.' : 'JSON выбранных объектов скопирован.', 'success');
            return true;
        } catch (_) {
            this.notify('Браузер запретил доступ к буферу обмена.', 'error');
            return false;
        }
    }

    async _copySelectionAsPng() {
        const elementIds = this._expandFrameSelectionIds(this.store.getSelectedElementIds());
        if (elementIds.length === 0) {
            return false;
        }
        if (typeof ClipboardItem !== 'function' || typeof navigator.clipboard?.write !== 'function') {
            this.notify('Копирование PNG не поддерживается этим браузером.', 'error');
            return false;
        }
        try {
            const { blob } = await this.canvasAdapter.exportElementsAsBlob(elementIds, {
                pixelRatio: 2,
                mimeType: 'image/png',
            });
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            this.notify(elementIds.length === 1 ? 'PNG объекта скопирован.' : 'PNG выбранных объектов скопирован.', 'success');
            return true;
        } catch (error) {
            this.notify(error?.message || 'Не удалось скопировать PNG объекта.', 'error');
            return false;
        }
    }

    _moveSelectionToPage(pageId) {
        const elementIds = this._expandFrameSelectionIds(this.store.getSelectedElementIds());
        const selectedIds = new Set(elementIds);
        const sourcePageId = this.store.getActivePageId();
        if (elementIds.length === 0 || !pageId || pageId === sourcePageId) {
            return false;
        }
        const changed = this.commandManager.executeDocument(
            elementIds.length === 1 ? 'Перенос объекта на другой лист' : 'Перенос объектов на другой лист',
            (document) => {
                const source = document.pages.find(({ id }) => id === sourcePageId);
                const target = document.pages.find(({ id }) => id === pageId);
                const moving = source?.elements.filter(({ id }) => selectedIds.has(id)) || [];
                if (
                    !source
                    || !target
                    || moving.length !== elementIds.length
                    || moving.some(({ locked }) => locked === true)
                ) {
                    return;
                }
                const movingFrameIds = new Set(
                    moving.filter(({ type }) => type === 'frame').map(({ id }) => id),
                );
                const targetGroupIds = collectGroupIds(target.elements);
                const collidingGroupIds = new Map(
                    [...collectGroupIds(moving)].filter((groupId) => targetGroupIds.has(groupId))
                        .map((groupId) => [groupId, `group-${crypto.randomUUID()}`]),
                );
                for (const element of moving) {
                    if (element.frameId && !movingFrameIds.has(element.frameId)) {
                        delete element.frameId;
                    }
                    const remappedGroups = remapElementGroups(element, collidingGroupIds);
                    if (Object.keys(remappedGroups).length > 0) {
                        applyElementGroupPath(
                            element,
                            getElementGroupPath(remappedGroups),
                            remappedGroups.groupNames,
                        );
                    }
                }
                target.elements.push(...moving);
                source.elements = source.elements.filter(({ id }) => !selectedIds.has(id));
            },
            {
                pageIds: [sourcePageId, pageId],
                undoPageId: sourcePageId,
                redoPageId: sourcePageId,
            },
        );
        if (changed) {
            this.store.setSelections([]);
            this.notify(
                elementIds.length === 1 ? 'Объект перенесён на другой лист.' : `Перенесено объектов: ${elementIds.length}.`,
                'success',
            );
        }
        return changed;
    }

    _expandFrameSelectionIds(elementIds) {
        const requestedIds = new Set(Array.isArray(elementIds) ? elementIds : []);
        const page = this.store.getActivePage();
        if (!page || requestedIds.size === 0) {
            return [];
        }
        const selectedFrameIds = new Set(
            page.elements
                .filter(({ id, type }) => requestedIds.has(id) && type === 'frame')
                .map(({ id }) => id),
        );
        return page.elements
            .filter((element) => requestedIds.has(element.id) || selectedFrameIds.has(element.frameId))
            .map(({ id }) => id);
    }

    _toggleSelectionLock() {
        const elementIds = this.store.getSelectedElementIds();
        const selectedIds = new Set(elementIds);
        const elements = elementIds.map((id) => this.store.getElement(id)).filter(Boolean);
        if (elements.length === 0 || elements.length !== elementIds.length) {
            return false;
        }
        const locked = !elements.every((element) => element.locked === true);
        const changed = this.commandManager.execute(
            locked ? 'Блокировка объектов' : 'Разблокировка объектов',
            (page) => {
                for (const target of page.elements) {
                    if (selectedIds.has(target.id)) {
                        target.locked = locked;
                    }
                }
            },
        );
        if (changed) {
            const message = elements.length === 1
                ? `Объект ${locked ? 'заблокирован' : 'разблокирован'}.`
                : `${locked ? 'Заблокировано' : 'Разблокировано'} объектов: ${elements.length}.`;
            this.notify(message, 'success');
        }
        return changed;
    }

    _closeContextMenu() {
        this.contextMenuOpen = false;
        this.$root.find('[data-role="canvas-context-menu"]').prop('hidden', true).empty();
    }

    _toggleToolLock() {
        this.toolLocked = !this.toolLocked;
        this.$root.find('.action-panel').attr('data-tool-locked', String(this.toolLocked));
        this.notify(
            `Фиксация инструмента ${this.toolLocked ? 'включена' : 'выключена'}.`,
            'info',
        );
        return true;
    }

    _setActiveTool(tool) {
        const previousTool = this.activeTool;
        this.activeTool = ['select', 'hand', 'brush', 'highlighter', 'arrow', 'frame', 'placement', 'image-eraser'].includes(tool)
            ? tool
            : 'select';
        if (this.activeTool !== 'placement') {
            this.pendingPlacement = null;
        }
        const brushActive = ['brush', 'highlighter'].includes(this.activeTool);
        const arrowActive = this.activeTool === 'arrow';
        const frameActive = this.activeTool === 'frame';
        const placementActive = this.activeTool === 'placement';
        const imageEraserActive = this.activeTool === 'image-eraser';
        const handActive = this.activeTool === 'hand';
        const drawingActive = brushActive || arrowActive || frameActive || placementActive || imageEraserActive;
        if (this.activeTool === 'brush') {
            this.canvasAdapter.setBrushOptions({ type: 'brush', opacity: 1, ...this.brushSettings });
        } else if (this.activeTool === 'highlighter') {
            this.canvasAdapter.setBrushOptions({ type: 'highlighter', ...this.highlighterSettings });
        }
        this.canvasAdapter.setBrushEnabled(brushActive);
        this.canvasAdapter.setArrowToolEnabled(arrowActive);
        if (arrowActive) {
            this.canvasAdapter.setArrowOptions(this.arrowSettings);
        }
        this.canvasAdapter.setFrameToolEnabled(frameActive);
        this.canvasAdapter.setPlacementTool(placementActive ? this.pendingPlacement : null);
        this.canvasAdapter.setImageEraser(imageEraserActive ? {
            elementId: this.imageEraserElementId,
            size: this.imageEraserSize,
        } : null);
        if (!imageEraserActive) {
            this.imageEraserElementId = null;
            this.imageEraserSettingsOpen = false;
        }
        this.viewportController.setHandToolActive(handActive);
        this.viewportController.setDrawingToolActive(drawingActive);
        if (
            previousTool !== this.activeTool
            && (handActive || (drawingActive && !imageEraserActive))
        ) {
            this.store.setSelections([]);
        }
        if (previousTool !== this.activeTool && this.activeTool === 'brush') {
            this.notify('Зажмите левую кнопку мыши и проведите по холсту, чтобы рисовать кистью.', 'info');
        } else if (previousTool !== this.activeTool && this.activeTool === 'highlighter') {
            this.notify('Зажмите левую кнопку мыши и проведите по холсту, чтобы рисовать выделителем.', 'info');
        } else if (previousTool !== this.activeTool && this.activeTool === 'arrow') {
            this.notify('Зажмите левую кнопку мыши и протяните по холсту, чтобы нарисовать стрелку или линию.', 'info');
        }
        this._renderActionPanelActiveTool();
        this._renderImageEraserState(this.store.getElement(this.store.getSelectedElementId()));
        this.$root.find('.action-panel').attr('data-tool-locked', String(this.toolLocked));
        this._closeContextMenu();
        this._setActionPopoverOpen(null);
    }

    _renderActionPanelActiveTool() {
        const indicator = resolveActionPanelActiveTool({
            activeTool: this.activeTool,
            placementKind: this.pendingPlacement?.kind,
            uploadActive: this.uploadActive,
        });
        this.$root.find('[data-tool-indicator]')
            .attr('aria-pressed', 'false')
            .removeClass('tool-button--active')
            .filter(`[data-tool-indicator="${indicator}"]`)
            .attr('aria-pressed', 'true')
            .addClass('tool-button--active');

        const $nestedTools = this.$root.find(
            '[data-action="add-shape"], [data-action="add-sticker"], [data-tool="highlighter"]',
        ).attr('aria-pressed', 'false');
        if (this.activeTool === 'placement' && this.pendingPlacement?.kind === 'shape') {
            $nestedTools
                .filter(`[data-shape-type="${this.pendingPlacement.shapeType}"]`)
                .attr('aria-pressed', 'true');
        } else if (this.activeTool === 'placement' && this.pendingPlacement?.kind === 'sticker') {
            $nestedTools.filter('[data-action="add-sticker"]').attr('aria-pressed', 'true');
        } else if (this.activeTool === 'highlighter') {
            $nestedTools.filter('[data-tool="highlighter"]').attr('aria-pressed', 'true');
        }
    }

    _setNavigatorOpen(open, { restoreFocus = false } = {}) {
        this.navigatorOpen = Boolean(open);
        const $trigger = this.$root.find('[data-action="toggle-navigator"]');
        $trigger.attr('aria-expanded', String(this.navigatorOpen));
        this.$root.find('[data-role="navigator-popover"]').prop('hidden', !this.navigatorOpen);
        if (this.navigatorOpen) {
            this._setHelpOpen(false);
            this._closeContextMenu();
            this._renderNavigatorElements();
            this._renderNavigatorViewport();
        } else if (restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _renderNavigatorElements() {
        if (!this.navigatorOpen) {
            return;
        }
        const page = this.store.getActivePage();
        const $surface = this.$root.find('[data-role="navigator-surface"]');
        const $elements = this.$root.find('[data-role="navigator-elements"]').empty();
        if (!page) {
            return;
        }
        const scene = this.viewportController.getNavigatorState().scene;
        $surface.css('aspect-ratio', `${scene.width} / ${scene.height}`);
        for (const element of page.elements) {
            const left = (Number(element.x || 0) - scene.x) / scene.width * 100;
            const top = (Number(element.y || 0) - scene.y) / scene.height * 100;
            const width = Number(element.width || 1) / scene.width * 100;
            const height = Number(element.height || 1) / scene.height * 100;
            this.$('<span>', {
                class: `canvas-navigator__element canvas-navigator__element--${element.type}`,
            }).css({
                left: `${left}%`,
                top: `${top}%`,
                width: `${Math.max(width, 0.6)}%`,
                height: `${Math.max(height, 0.6)}%`,
                backgroundColor: element.type === 'frame'
                    ? 'transparent'
                    : (element.type === 'image'
                    ? '#c7dcff'
                    : (['brush', 'highlighter'].includes(element.type)
                        ? (element.stroke || '#282828')
                        : (element.fill || '#8094b1'))),
                borderColor: element.type === 'frame' ? '#3183ff' : '',
                opacity: element.type === 'highlighter' ? (element.opacity || 0.35) : 1,
                transform: `rotate(${Number(element.rotation || 0)}deg)`,
            }).appendTo($elements);
        }
    }

    _renderNavigatorViewport() {
        if (!this.navigatorOpen) {
            return;
        }
        const state = this.viewportController.getNavigatorState();
        const { scene, stage, viewport } = state;
        if (!scene.width || !scene.height || !viewport.scale) {
            return;
        }
        const worldLeft = -viewport.x / viewport.scale - scene.x;
        const worldTop = -viewport.y / viewport.scale - scene.y;
        const worldWidth = stage.width / viewport.scale;
        const worldHeight = stage.height / viewport.scale;
        const left = Math.max(0, Math.min(100, worldLeft / scene.width * 100));
        const top = Math.max(0, Math.min(100, worldTop / scene.height * 100));
        const width = Math.max(3, Math.min(100 - left, worldWidth / scene.width * 100));
        const height = Math.max(3, Math.min(100 - top, worldHeight / scene.height * 100));
        this.$root.find('[data-role="navigator-viewport"]').css({
            left: `${left}%`,
            top: `${top}%`,
            width: `${width}%`,
            height: `${height}%`,
        });
    }

    _renderReturnToContent() {
        const shouldShow = this.viewportController.shouldShowReturnToContent();
        this.$root.find('[data-role="return-to-content"]')
            .prop('hidden', !shouldShow)
            .attr('aria-hidden', shouldShow ? 'false' : 'true');
    }

    _navigateFromMapPointer(event) {
        const map = this.$root.find('[data-role="navigator-map"]').get(0);
        const page = this.store.getActivePage();
        if (!(map instanceof HTMLElement) || !page) {
            return;
        }
        const rect = map.getBoundingClientRect();
        const scene = this.viewportController.getNavigatorState().scene;
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        this.viewportController.centerAtWorldPoint(
            scene.x + x * scene.width,
            scene.y + y * scene.height,
        );
    }

    _handleNavigatorKeyboard(event) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const state = this.viewportController.getNavigatorState();
        const center = {
            x: (state.stage.width / 2 - state.viewport.x) / state.viewport.scale,
            y: (state.stage.height / 2 - state.viewport.y) / state.viewport.scale,
        };
        const stepX = state.scene.width * 0.08;
        const stepY = state.scene.height * 0.08;
        if (event.key === 'ArrowLeft') center.x -= stepX;
        if (event.key === 'ArrowRight') center.x += stepX;
        if (event.key === 'ArrowUp') center.y -= stepY;
        if (event.key === 'ArrowDown') center.y += stepY;
        this.viewportController.centerAtWorldPoint(center.x, center.y);
    }

    _setHelpOpen(open, { restoreFocus = false } = {}) {
        this.helpOpen = Boolean(open);
        const $trigger = this.$root.find('[data-action="toggle-help"]');
        $trigger.attr('aria-expanded', String(this.helpOpen));
        this.$root.find('[data-role="help-popover"]').prop('hidden', !this.helpOpen);
        if (this.helpOpen) {
            this._setNavigatorOpen(false);
            this._setLayerMapOpen(false);
            this._closeContextMenu();
            this._renderHelp();
        } else if (restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _setLayerMapOpen(open, { restoreFocus = false } = {}) {
        this.layerMapOpen = Boolean(open);
        const $trigger = this.$root.find('[data-action="toggle-layer-map"]');
        $trigger.attr('aria-expanded', String(this.layerMapOpen));
        this.$root.find('[data-role="layer-map-popover"]').prop('hidden', !this.layerMapOpen);
        if (this.layerMapOpen) {
            this._setNavigatorOpen(false);
            this._setHelpOpen(false);
            this._closeContextMenu();
            this._renderLayerMap();
        } else {
            this._clearLayerMapDragState();
            if (restoreFocus) {
                $trigger.trigger('focus');
            }
        }
    }

    _setLayerMapNavigationOpen(open) {
        this.layerMapNavigationOpen = Boolean(open);
        const $trigger = this.$root.find('[data-action="toggle-layer-map-navigation"]');
        $trigger
            .attr('aria-expanded', String(this.layerMapNavigationOpen))
            .attr('aria-label', this.layerMapNavigationOpen
                ? 'Скрыть навигацию по слоям'
                : 'Показать навигацию по слоям');
        this.$root.find('[data-role="layer-map-navigation"]')
            .prop('hidden', !this.layerMapNavigationOpen);
    }

    _renderLayerMap() {
        if (!this.layerMapOpen) {
            return;
        }
        const page = this.store.getActivePage();
        const elements = page?.elements || [];
        const selectedIds = new Set(this.store.getSelectedElementIds());
        const fullTree = buildLayerHierarchy(elements);
        const filters = {
            query: this.layerMapQuery,
            type: this.layerMapTypeFilter,
            scope: this.layerMapScopeFilter,
        };
        const filtersActive = String(filters.query || '').trim() !== ''
            || filters.type !== 'all'
            || filters.scope !== 'all';
        const tree = filterLayerHierarchy(fullTree, elements, filters);
        const activeElement = document.activeElement;
        const focusedNodeId = activeElement?.closest?.('[data-layer-node-id]')?.dataset?.layerNodeId || null;
        const treeElement = this.$root.find('[data-role="layer-map-tree"]').get(0);
        const previousScrollTop = treeElement?.scrollTop || 0;
        const stats = getLayerMapStats(elements, [...selectedIds]);
        this.$root.find('[data-role="layer-map-page-name"]')
            .text(page?.name || 'Лист')
            .attr('title', page?.name || '');
        this.$root.find('[data-role="layer-map-count"]')
            .text(formatElementCount(stats.total));
        this.$root.find('[data-role="layer-map-selected-count"]')
            .text(`Выбрано: ${stats.selected}`);
        this.$root.find('[data-role="layer-map-locked-count"]')
            .text(`Заблокировано: ${stats.locked}`);
        this.$root.find('[data-role="layer-map-search"]').val(this.layerMapQuery);
        this.$root.find('[data-role="layer-map-type-filter"]').val(this.layerMapTypeFilter);
        this.$root.find('[data-role="layer-map-scope-filter"]').val(this.layerMapScopeFilter);
        this.$root.find('[data-action="clear-layer-map-filters"]').prop('hidden', !filtersActive);
        const $tree = this.$root.find('[data-role="layer-map-tree"]').empty();
        this.layerMapTargets.clear();
        this.layerMapDragEntries.clear();
        const treeIsEmpty = tree.length === 0;
        this.$root.find('[data-role="layer-map-empty"]').prop('hidden', !treeIsEmpty);
        this.$root.find('[data-role="layer-map-empty-title"]')
            .text(elements.length > 0 ? 'Ничего не найдено' : 'На листе пока нет элементов');
        this.$root.find('[data-role="layer-map-empty-text"]')
            .text(elements.length > 0
                ? 'Измените запрос или сбросьте фильтры.'
                : 'Добавленные объекты появятся здесь в порядке слоёв.');
        $tree.prop('hidden', tree.length === 0);

        const allNodeIds = new Set();
        const fullNodeElementIds = new Map();
        const collectNodeIds = (nodes) => {
            for (const node of nodes) {
                allNodeIds.add(node.id);
                fullNodeElementIds.set(node.id, collectLayerNodeElementIds(node));
                collectNodeIds(node.children || []);
            }
        };
        collectNodeIds(fullTree);
        this.collapsedLayerNodeIds = new Set(
            [...this.collapsedLayerNodeIds].filter((nodeId) => allNodeIds.has(nodeId)),
        );

        const elementsById = new Map(elements.map((element) => [element.id, element]));
        const appendNodes = (nodes, depth = 0, parentKey = 'root') => {
            for (const node of nodes) {
                const orderElementIds = fullNodeElementIds.get(node.id) || collectLayerNodeElementIds(node);
                const selectedCount = orderElementIds.filter((id) => selectedIds.has(id)).length;
                const lockedCount = orderElementIds.filter((id) => elementsById.get(id)?.locked === true).length;
                const allLocked = orderElementIds.length > 0 && lockedCount === orderElementIds.length;
                const partiallyLocked = lockedCount > 0 && !allLocked;
                const dragLocked = lockedCount > 0;
                const hasChildren = node.children.length > 0;
                const collapsed = hasChildren
                    && !filtersActive
                    && this.collapsedLayerNodeIds.has(node.id);
                const selectionClass = selectedCount === orderElementIds.length && selectedCount > 0
                    ? ' layer-map__row--selected'
                    : (selectedCount > 0 ? ' layer-map__row--partially-selected' : '');
                const $row = this.$('<div>', {
                    class: `layer-map__row${selectionClass}`,
                    role: 'treeitem',
                    'aria-level': depth + 1,
                    'aria-expanded': hasChildren ? String(!collapsed) : undefined,
                    'aria-selected': selectedCount > 0 ? 'true' : 'false',
                    'aria-haspopup': 'menu',
                    'aria-label': lockedCount > 0
                        ? `${node.label}, заблокировано ${lockedCount}`
                        : node.label,
                    tabindex: 0,
                    'data-layer-node-id': node.id,
                    'data-layer-parent-key': parentKey,
                    draggable: dragLocked || this.renamingLayerNodeId === node.id ? undefined : 'true',
                    title: node.label,
                }).css('--layer-depth', depth);
                this.layerMapTargets.set(node.id, [...node.elementIds]);
                this.layerMapDragEntries.set(node.id, {
                    elementIds: orderElementIds,
                    selectionIds: [...node.elementIds],
                    renameElementIds: node.kind === 'group' ? [...node.elementIds] : [node.id],
                    groupId: node.groupId || null,
                    parentKey,
                    kind: node.kind,
                    label: node.label,
                    hasChildren,
                    locked: dragLocked,
                });
                if (hasChildren) {
                    this.$('<button>', {
                        class: 'layer-map__branch',
                        type: 'button',
                        'data-layer-action': 'toggle-branch',
                        'aria-label': `${collapsed ? 'Раскрыть' : 'Свернуть'} ${node.label}`,
                        'aria-expanded': String(!collapsed),
                        disabled: filtersActive,
                        text: collapsed ? '▸' : '▾',
                    }).appendTo($row);
                } else {
                    this.$('<span>', {
                        class: 'layer-map__branch-placeholder',
                        'aria-hidden': 'true',
                    }).appendTo($row);
                }
                this.$('<span>', {
                    class: `layer-map__type layer-map__type--${node.type}`,
                    'aria-hidden': 'true',
                    text: LAYER_TYPE_ICONS[node.type] || '◇',
                }).appendTo($row);
                if (this.renamingLayerNodeId === node.id) {
                    this.$('<input>', {
                        class: 'layer-map__rename-input',
                        type: 'text',
                        maxlength: MAX_PAGE_NAME_LENGTH,
                        value: node.label,
                        'data-role': 'layer-map-rename-input',
                        'aria-label': `Новое имя для ${node.label}`,
                    }).appendTo($row);
                } else {
                    this.$('<span>', {
                        class: 'layer-map__name',
                        text: node.label,
                        'data-layer-name': '',
                    }).appendTo($row);
                    this.$('<button>', {
                        class: 'layer-map__row-action layer-map__row-action--rename',
                        type: 'button',
                        'data-layer-action': 'rename',
                        'aria-label': `Переименовать ${node.label}`,
                        text: '✎',
                    }).appendTo($row);
                }
                const lockLabel = allLocked ? 'Разблокировать' : 'Заблокировать';
                const $lockButton = this.$('<button>', {
                    class: `layer-map__row-action layer-map__row-action--lock${partiallyLocked ? ' is-partial' : ''}`,
                    type: 'button',
                    'data-layer-action': 'toggle-lock',
                    'aria-label': `${lockLabel} ${node.label}`,
                    'aria-pressed': String(allLocked),
                });
                this.$('<span>', {
                    class: `layer-map__lock${allLocked ? '' : ' layer-map__lock--open'}`,
                    'aria-hidden': 'true',
                }).appendTo($lockButton);
                $lockButton.appendTo($row);
                $row.appendTo($tree);
                if (hasChildren && !collapsed) {
                    appendNodes(node.children, depth + 1, node.id);
                }
            }
        };
        appendNodes(tree);
        if (treeElement) {
            treeElement.scrollTop = previousScrollTop;
        }
        if (this.renamingLayerNodeId && this.layerMapTargets.has(this.renamingLayerNodeId)) {
            requestAnimationFrame(() => {
                const input = this.$root.find('[data-role="layer-map-rename-input"]').get(0);
                input?.focus();
                input?.select();
            });
        } else if (this.layerMapOpen && focusedNodeId && this.layerMapTargets.has(focusedNodeId)) {
            requestAnimationFrame(() => {
                this.$root.find(`[data-layer-node-id="${CSS.escape(focusedNodeId)}"]`).trigger('focus');
            });
        }
    }

    _layerMapFiltersActive() {
        return String(this.layerMapQuery || '').trim() !== ''
            || this.layerMapTypeFilter !== 'all'
            || this.layerMapScopeFilter !== 'all';
    }

    _toggleLayerMapBranch(control) {
        if (this._layerMapFiltersActive()) {
            return false;
        }
        const row = control?.closest?.('[data-layer-node-id]') || control;
        const nodeId = row?.dataset?.layerNodeId;
        const entry = this.layerMapDragEntries.get(nodeId);
        if (!nodeId || !entry?.hasChildren) {
            return false;
        }
        if (this.collapsedLayerNodeIds.has(nodeId)) {
            this.collapsedLayerNodeIds.delete(nodeId);
        } else {
            this.collapsedLayerNodeIds.add(nodeId);
        }
        this._renderLayerMap();
        requestAnimationFrame(() => {
            this.$root.find(`[data-layer-node-id="${CSS.escape(nodeId)}"]`).trigger('focus');
        });
        return true;
    }

    _startLayerMapRename(control) {
        const nodeId = control?.dataset?.layerNodeId;
        if (!nodeId || !this.layerMapDragEntries.has(nodeId)) {
            return false;
        }
        this._closeContextMenu();
        this.renamingLayerNodeId = nodeId;
        this._renderLayerMap();
        return true;
    }

    _finishLayerMapRename(input, { cancel = false } = {}) {
        const nodeId = input?.closest?.('[data-layer-node-id]')?.dataset?.layerNodeId;
        if (!nodeId || this.renamingLayerNodeId !== nodeId) {
            return false;
        }
        const entry = this.layerMapDragEntries.get(nodeId);
        const nextName = String(input.value || '').replace(/\s+/g, ' ').trim();
        this.renamingLayerNodeId = null;
        if (cancel) {
            this._renderLayerMap();
            return false;
        }
        if (!nextName) {
            this.notify('Имя слоя не может быть пустым.', 'error');
            this._renderLayerMap();
            return false;
        }
        const renameIds = new Set(entry?.renameElementIds || []);
        const changed = this.commandManager.execute(
            entry?.kind === 'group' ? 'Переименование группы' : 'Переименование слоя',
            (page) => {
                for (const element of page.elements) {
                    if (renameIds.has(element.id)) {
                        if (entry?.kind === 'group' && entry.groupId) {
                            const names = getElementGroupNames(element);
                            names[entry.groupId] = nextName.slice(0, MAX_PAGE_NAME_LENGTH);
                            applyElementGroupPath(element, getElementGroupPath(element), names);
                        } else {
                            element.name = nextName.slice(0, MAX_PAGE_NAME_LENGTH);
                        }
                    }
                }
            },
        );
        if (changed) {
            this.notify(entry?.kind === 'group' ? 'Группа переименована.' : 'Слой переименован.', 'success');
        } else {
            this._renderLayerMap();
        }
        return changed;
    }

    _toggleLayerMapNodeLock(control) {
        const nodeId = control?.dataset?.layerNodeId;
        const entry = this.layerMapDragEntries.get(nodeId);
        const targetIds = new Set(entry?.elementIds || []);
        const elements = [...targetIds].map((id) => this.store.getElement(id)).filter(Boolean);
        if (elements.length === 0) {
            return false;
        }
        const locked = !elements.every((element) => element.locked === true);
        const changed = this.commandManager.execute(
            locked ? 'Блокировка слоёв' : 'Разблокировка слоёв',
            (page) => {
                for (const element of page.elements) {
                    if (targetIds.has(element.id)) {
                        element.locked = locked;
                    }
                }
            },
        );
        if (changed) {
            this.notify(
                elements.length === 1
                    ? `Слой ${locked ? 'заблокирован' : 'разблокирован'}.`
                    : `${locked ? 'Заблокировано' : 'Разблокировано'} слоёв: ${elements.length}.`,
                'success',
            );
        }
        return changed;
    }

    _selectLayerMapNode(control, additive = false) {
        const expandedIds = this._getLayerMapTargetIds(control);
        if (expandedIds.length === 0) {
            return false;
        }
        const currentIds = this.store.getSelectedElementIds();
        const nextIds = resolveLayerMapSelection(currentIds, expandedIds, additive);
        return this.store.setSelections(nextIds);
    }

    _getLayerMapTargetIds(control) {
        const elementIds = this.layerMapTargets.get(control?.dataset?.layerNodeId) || [];
        return [...elementIds];
    }

    _startLayerMapDrag(control, nativeEvent) {
        const nodeId = control?.dataset?.layerNodeId;
        const entry = this.layerMapDragEntries.get(nodeId);
        if (!entry || entry.locked) {
            nativeEvent?.preventDefault?.();
            return false;
        }
        this._closeContextMenu();
        this.draggingLayerNodeId = nodeId;
        this.$(control).addClass('layer-map__row--dragging');
        if (nativeEvent?.dataTransfer) {
            nativeEvent.dataTransfer.effectAllowed = 'move';
            nativeEvent.dataTransfer.setData('text/plain', nodeId);
        }
        return true;
    }

    _updateLayerMapDropTarget(control, nativeEvent) {
        const source = this.layerMapDragEntries.get(this.draggingLayerNodeId);
        const targetId = control?.dataset?.layerNodeId;
        const target = this.layerMapDragEntries.get(targetId);
        if (
            !source
            || !target
            || targetId === this.draggingLayerNodeId
            || source.parentKey !== target.parentKey
            || source.elementIds.some((id) => target.elementIds.includes(id))
        ) {
            return false;
        }
        nativeEvent?.preventDefault?.();
        if (nativeEvent?.dataTransfer) {
            nativeEvent.dataTransfer.dropEffect = 'move';
        }
        const bounds = control.getBoundingClientRect();
        const position = nativeEvent.clientY < bounds.top + bounds.height / 2
            ? 'before'
            : 'after';
        this.$root.find('[data-layer-node-id]').removeClass([
            'layer-map__row--drop-before',
            'layer-map__row--drop-after',
        ].join(' '));
        this.$(control).addClass(`layer-map__row--drop-${position}`);
        return true;
    }

    _reorderLayerMapNode(sourceNodeId, targetNodeId, position) {
        const source = this.layerMapDragEntries.get(sourceNodeId);
        const target = this.layerMapDragEntries.get(targetNodeId);
        if (
            !source
            || !target
            || source.locked
            || source.parentKey !== target.parentKey
        ) {
            return false;
        }
        const page = this.store.getActivePage();
        const scopeElementIds = [...new Set(
            [...this.layerMapDragEntries.values()]
                .filter((entry) => entry.parentKey === source.parentKey)
                .flatMap((entry) => entry.elementIds),
        )];
        const reordered = reorderLayerElements(
            page?.elements,
            source.elementIds,
            target.elementIds,
            position,
            scopeElementIds,
        );
        if (!reordered) {
            return false;
        }
        const changed = this.commandManager.execute('Изменение порядка слоёв', (document) => {
            document.elements = reordered;
        });
        if (changed) {
            this.store.setSelections(source.selectionIds);
        }
        return changed;
    }

    _clearLayerMapDragState() {
        this.draggingLayerNodeId = null;
        this.$root.find('[data-layer-node-id]').removeClass([
            'layer-map__row--dragging',
            'layer-map__row--drop-before',
            'layer-map__row--drop-after',
        ].join(' '));
    }

    _openLayerMapContextMenu(control, { clientX = 0, clientY = 0 } = {}) {
        const targetIds = this._getLayerMapTargetIds(control);
        if (targetIds.length === 0) {
            return false;
        }
        const selectedIds = new Set(this.store.getSelectedElementIds());
        const targetAlreadySelected = targetIds.every((id) => selectedIds.has(id));
        if (!targetAlreadySelected) {
            this.store.setSelections(targetIds);
        }
        this.openCanvasContextMenu({
            elementId: targetIds[0],
            preserveSelection: true,
            clientX,
            clientY,
        });
        return true;
    }

    _renderHelp() {
        const groups = [
            {
                title: 'Инструменты',
                rows: [
                    ['Зафиксировать инструмент', 'Q'],
                    ['Выбор', 'V'],
                    ['Рука', 'H'],
                    ['Прямоугольник', 'R'],
                    ['Овал', 'O'],
                    ['Фрейм', 'F'],
                    ['Загрузить изображение', 'Ctrl/Cmd + U'],
                    ['Экспортировать PDF', 'Ctrl/Cmd + P'],
                ],
            },
            {
                title: 'Настройки',
                rows: [
                    ['Тёмный режим', 'Ctrl/Cmd + /'],
                    ['Фокус-режим', 'Ctrl/Cmd + .'],
                    ['Выйти из фокус-режима', 'Escape'],
                    ['Показать/скрыть сетку', "Ctrl/Cmd + '"],
                ],
            },
            {
                title: 'Редактирование',
                rows: [
                    ['Отменить', 'Ctrl/Cmd + Z'],
                    ['Вернуть', 'Ctrl/Cmd + Shift + Z / Y'],
                    ['Вырезать / Копировать / Вставить', 'Ctrl/Cmd + X / C / V'],
                    ['Выбрать всё', 'Ctrl/Cmd + A'],
                    ['Дублировать', 'Ctrl/Cmd + D'],
                    ['Удалить', 'Delete / Backspace'],
                    ['Сгруппировать', 'Ctrl/Cmd + G'],
                    ['Разгруппировать', 'Ctrl/Cmd + Shift + G'],
                ],
            },
            {
                title: 'Вид',
                rows: [
                    ['Увеличить масштаб', 'Ctrl/Cmd + ='],
                    ['Уменьшить масштаб', 'Ctrl/Cmd + −'],
                    ['Масштаб 100%', 'Shift + 0'],
                    ['Вписать холст', 'Shift + 1 / Ctrl/Cmd + 0'],
                    ['Масштаб к выделению', 'Shift + 2'],
                    ['Масштаб под курсором', 'Колесо мыши · 10–500%'],
                ],
            },
            {
                title: 'Трансформация',
                rows: [
                    ['На передний план', '↑'],
                    ['Поднять на один слой', 'Shift + ↑'],
                    ['На задний план', '↓'],
                    ['Опустить на один слой', 'Shift + ↓'],
                    ['Отразить изображение по ширине', 'Shift + H'],
                    ['Отразить изображение по глубине', 'Shift + V'],
                    ['Выровнять сверху / вертикально / снизу', 'Alt + W / V / S'],
                    ['Выровнять слева / горизонтально / справа', 'Alt + A / H / D'],
                ],
            },
            {
                title: 'Навигация',
                rows: [
                    ['Панорамирование', 'СКМ / Пробел + протягивание'],
                    ['Добавить/убрать из выделения', 'Ctrl/Cmd + клик'],
                    ['Отмена / снять выделение', 'Escape'],
                ],
            },
        ];
        const $table = this.$root.find('[data-role="hotkeys-table"]').empty();
        for (const group of groups) {
            const $heading = this.$('<tr>', { class: 'editor-help__section' });
            this.$('<th>', { colspan: 2, scope: 'colgroup', text: group.title }).appendTo($heading);
            $heading.appendTo($table);
            for (const [label, shortcut] of group.rows) {
                const $row = this.$('<tr>');
                this.$('<th>', { scope: 'row', text: label }).appendTo($row);
                this.$('<td>').append(this.$('<kbd>', { text: shortcut })).appendTo($row);
                $row.appendTo($table);
            }
        }
    }

    destroy() {
        clearTimeout(this.notificationTimer);
        clearTimeout(this.alignmentPopoverCloseTimer);
        clearTimeout(this.colorInputTimer);
        if (this.toolbarPositionFrame !== null) {
            cancelAnimationFrame(this.toolbarPositionFrame);
            this.toolbarPositionFrame = null;
        }
        if (this.dimensionsPositionFrame !== null) {
            cancelAnimationFrame(this.dimensionsPositionFrame);
            this.dimensionsPositionFrame = null;
        }
        if (this.viewportRenderFrame !== null) {
            cancelAnimationFrame(this.viewportRenderFrame);
            this.viewportRenderFrame = null;
        }
        this.pendingViewportRender = null;
        this._resolveDraftRecovery(false);
        for (const timer of Object.values(this.popoverCloseTimers)) {
            clearTimeout(timer);
        }
        this.$root.off('.moodboardsEditor');
        this.root.removeEventListener('pointerdown', this.handleScenePointerDown, true);
        window.removeEventListener('keydown', this.handleKeyboard, true);
        window.removeEventListener('paste', this.handlePaste, true);
        window.removeEventListener('pointerup', this.handleNavigatorPointerUp);
        this.unsubscribeStore?.();
        this.unsubscribeCommands?.();
        this.unsubscribeStore = null;
        this.unsubscribeCommands = null;
        this.settingsOpen = false;
        this.pagesOpen = false;
        this.exportOpen = false;
        this.colorInputTimer = null;
        this.navigatorOpen = false;
        this.helpOpen = false;
        this.layerMapOpen = false;
        this.layerMapNavigationOpen = false;
        this.layerMapTargets.clear();
        this.layerMapDragEntries.clear();
        this.collapsedLayerNodeIds.clear();
        this.renamingLayerNodeId = null;
        this.actionPopover = null;
        this.toolbarLinkEditorOpen = false;
        this.alignmentPopoverOpen = false;
        this.alignmentPopoverCloseTimer = null;
        this.contextualMoreOpen = false;
        this.contextualMoreCloseTimer = null;
        this.contextualMoreElementId = null;
        this.contextMenuOpen = false;
        this.renamingPageId = null;
        this.deletingPageId = null;
        this.bound = false;
    }

    _handleScenePointerDown(event) {
        if (
            event.button === 0
            && this.contextMenuOpen
            && !event.target?.closest?.('[data-role="canvas-context-menu"]')
        ) {
            this._closeContextMenu();
        }

        const field = globalThis.document?.activeElement;
        if (!this.root.contains(field) || !event.target?.closest?.('[data-role="canvas-container"]')) {
            return;
        }
        if (field.matches?.('[data-object-property="rotation"]')) {
            this._handleObjectToolbarProperty(field);
            field.blur();
        } else if (field.matches?.('[data-role="project-name"]')) {
            field.blur();
        }
    }

    _handlePaste(event) {
        if (isEditableTarget(event.target)) {
            return;
        }

        const { files, text } = extractClipboardContent(event.clipboardData);
        if (files.length > 0) {
            event.preventDefault();
            if (this.uploadActive) {
                this.notify('Дождитесь завершения текущей загрузки изображений.', 'error');
                return;
            }
            Promise.resolve(this.onPasteContent({ files, text: '' })).catch((error) => {
                this.notify(error?.message || 'Не удалось вставить изображение из буфера обмена.', 'error');
            });
            return;
        }

        if (
            text !== ''
            && this.clipboardElements.length > 0
            && text === this.internalClipboardText
        ) {
            event.preventDefault();
            this._pasteClipboard();
            return;
        }

        if (text.trim() !== '') {
            event.preventDefault();
            Promise.resolve(this.onPasteContent({ files: [], text })).catch((error) => {
                this.notify(error?.message || 'Не удалось вставить текст из буфера обмена.', 'error');
            });
            return;
        }

        if (this.clipboardElements.length > 0) {
            event.preventDefault();
            this._pasteClipboard();
        }
    }

    async _pasteFromSystemClipboard() {
        const clipboard = globalThis.navigator?.clipboard;
        try {
            if (typeof clipboard?.read === 'function') {
                const items = await clipboard.read();
                const imageBlobs = [];
                let text = '';
                for (const item of items) {
                    const imageType = Array.from(item.types || [])
                        .find((type) => String(type).startsWith('image/'));
                    if (imageType) {
                        imageBlobs.push(await item.getType(imageType));
                    } else if (text === '' && Array.from(item.types || []).includes('text/plain')) {
                        text = await (await item.getType('text/plain')).text();
                    }
                }
                if (imageBlobs.length > 0) {
                    if (this.uploadActive) {
                        throw new Error('Дождитесь завершения текущей загрузки изображений.');
                    }
                    return this.onPasteContent({ files: imageBlobs, text: '' });
                }
                if (text.trim() !== '') {
                    if (this.clipboardElements.length > 0 && text === this.internalClipboardText) {
                        return this._pasteClipboard();
                    }
                    return this.onPasteContent({ files: [], text });
                }
            } else if (typeof clipboard?.readText === 'function') {
                const text = await clipboard.readText();
                if (text.trim() !== '') {
                    if (this.clipboardElements.length > 0 && text === this.internalClipboardText) {
                        return this._pasteClipboard();
                    }
                    return this.onPasteContent({ files: [], text });
                }
            }
        } catch (error) {
            if (error?.message === 'Дождитесь завершения текущей загрузки изображений.') {
                throw error;
            }
            if (this.clipboardElements.length > 0) {
                return this._pasteClipboard();
            }
            throw new Error('Браузер запретил чтение буфера. Используйте Ctrl/Cmd+V над холстом.');
        }

        if (this.clipboardElements.length > 0) {
            return this._pasteClipboard();
        }
        throw new Error('Буфер обмена пуст. Скопируйте изображение или текст и повторите вставку.');
    }

    _executeHotkey(action) {
        if (action === 'toggle-tool-lock') {
            return this._toggleToolLock();
        }
        if (action === 'select-tool') {
            this._setActiveTool('select');
            return true;
        }
        if (action === 'hand-tool') {
            this._setActiveTool('hand');
            return true;
        }
        if (action === 'rectangle-tool') {
            return this.addShape('rectangle');
        }
        if (action === 'oval-tool') {
            return this.addShape('oval');
        }
        if (action === 'frame-tool') {
            this._setActiveTool('frame');
            return true;
        }
        if (action === 'upload-image') {
            const $input = this.$root.find('[data-role="image-input"]');
            if (this.uploadActive || $input.prop('disabled')) {
                return false;
            }
            $input.trigger('click');
            return true;
        }
        if (action === 'export-pdf') {
            Promise.resolve(this.onExport('pdf', 1)).catch((error) => {
                const message = error?.message || 'Не удалось экспортировать PDF.';
                this.setExportState({ status: 'error', message, format: 'pdf' });
                this.notify(message, 'error');
            });
            return true;
        }
        if (action === 'toggle-grid') {
            this.settings.showGrid = !this.settings.showGrid;
            this._renderSettings();
            this.onSettingsChange({ ...this.settings });
            return true;
        }
        if (action === 'toggle-dark-mode' || action === 'toggle-focus-mode') {
            const settingName = action === 'toggle-dark-mode' ? 'darkMode' : 'focusMode';
            this.settings[settingName] = !this.settings[settingName];
            this._renderSettings();
            this.onSettingsChange({ ...this.settings });
            this.notify(
                settingName === 'darkMode'
                    ? `Тёмный режим ${this.settings[settingName] ? 'включён' : 'выключен'}.`
                    : `Фокус-режим ${this.settings[settingName] ? 'включён' : 'выключен'}.`,
                'info',
            );
            return true;
        }
        if (action === 'zoom-in') {
            this.viewportController.zoomIn();
            return true;
        }
        if (action === 'zoom-out') {
            this.viewportController.zoomOut();
            return true;
        }
        if (action === 'zoom-100') {
            this.viewportController.setScale(1);
            return true;
        }
        if (action === 'zoom-fit') {
            this.viewportController.fit();
            return true;
        }
        if (action === 'zoom-selection') {
            const focused = this.viewportController.focusSelection();
            if (!focused) {
                this.notify('Сначала выберите один или несколько объектов.', 'info');
            }
            return focused;
        }
        if (action === 'flip-horizontal' || action === 'flip-vertical') {
            return this._toggleSelectedImageFlip(
                action === 'flip-horizontal' ? 'horizontal' : 'vertical',
            );
        }
        if (['bring-to-front', 'bring-forward', 'send-backward', 'send-to-back'].includes(action)) {
            return this.commandRegistry.execute(action);
        }
        if (['group', 'ungroup'].includes(action)) {
            const changed = this.commandRegistry.execute(action);
            if (!changed) {
                this.notify(
                    action === 'group'
                        ? 'Для группировки выберите минимум два незаблокированных объекта в одной области или фрейме.'
                        : 'В выделении нет сгруппированных объектов.',
                    'info',
                );
            }
            return changed;
        }
        if ([
            'align-top',
            'align-vertical',
            'align-bottom',
            'align-left',
            'align-horizontal',
            'align-right',
        ].includes(action)) {
            return this.commandRegistry.execute(action);
        }
        return false;
    }

    _handleKeyboard(event) {
        if (this.recoveryDraftResolver) {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.$root.find('[data-action="discard-recovery-draft"]').trigger('focus');
            } else if (event.key === 'Tab') {
                const controls = this.$root.find('[data-role="recovery-draft"] button:visible').toArray();
                const currentIndex = controls.indexOf(document.activeElement);
                const movingBeforeFirst = event.shiftKey && currentIndex <= 0;
                const movingAfterLast = !event.shiftKey && currentIndex === controls.length - 1;
                if (controls.length > 0 && (movingBeforeFirst || movingAfterLast || currentIndex === -1)) {
                    event.preventDefault();
                    const nextControl = event.shiftKey ? controls.at(-1) : controls[0];
                    nextControl?.focus();
                }
            }
            return;
        }
        if (event.key === 'Escape' && this.contextMenuOpen) {
            event.preventDefault();
            this._closeContextMenu();
            return;
        }
        if (event.key === 'Escape' && this.toolbarLinkEditorOpen) {
            event.preventDefault();
            this._setToolbarLinkEditorOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.alignmentPopoverOpen) {
            event.preventDefault();
            this._setAlignmentPopoverOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.contextualMoreOpen) {
            event.preventDefault();
            this._setContextualMoreOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.helpOpen) {
            event.preventDefault();
            this._setHelpOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.actionPopover) {
            event.preventDefault();
            const type = this.actionPopover;
            this._setActionPopoverOpen(null, { restoreFocus: true, triggerType: type });
            return;
        }
        if (event.key === 'Escape' && this.navigatorOpen) {
            event.preventDefault();
            this._setNavigatorOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.exportOpen) {
            event.preventDefault();
            this._setExportOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && this.pagesOpen) {
            event.preventDefault();
            if (this.deletingPageId || this.renamingPageId) {
                this.deletingPageId = null;
                this.renamingPageId = null;
                this._renderPages();
            } else {
                this._setPagesOpen(false, { restoreFocus: true });
            }
            return;
        }
        if (event.key === 'Escape' && this.settingsOpen) {
            event.preventDefault();
            this._setSettingsOpen(false, { restoreFocus: true });
            return;
        }
        if (event.key === 'Escape' && event.target?.matches?.('[data-role="project-name"]')) {
            event.preventDefault();
            this.$(event.target).val(this.store.title);
            event.target.blur?.();
            return;
        }
        if (isEditableTarget(event.target)) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.target.blur?.();
            }
            return;
        }
        if (event.key === 'Escape' && this.settings.focusMode) {
            event.preventDefault();
            this._executeHotkey('toggle-focus-mode');
            return;
        }
        if (
            ['ArrowUp', 'ArrowDown'].includes(event.key)
            && event.target instanceof Element
            && event.target.closest([
                '[role="menu"]',
                '[role="dialog"]',
                '[data-role="navigator-map"]',
                '[data-role="action-popover"]',
                '[data-role="align-popover"]',
            ].join(', '))
        ) {
            return;
        }
        const editorHotkey = resolveEditorHotkey(event);
        if (editorHotkey !== null) {
            event.preventDefault();
            if (
                event.repeat
                && [
                    'toggle-tool-lock',
                    'toggle-dark-mode',
                    'toggle-focus-mode',
                    'toggle-grid',
                    'upload-image',
                    'export-pdf',
                    'group',
                    'ungroup',
                ].includes(editorHotkey)
            ) {
                return;
            }
            this._executeHotkey(editorHotkey);
            return;
        }
        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        const matchesKey = (latinKey, code) => key === latinKey || event.code === code;
        if (modifier && !event.altKey && matchesKey('z', 'KeyZ')) {
            event.preventDefault();
            if (event.shiftKey) {
                this.commandManager.redo();
            } else {
                this.commandManager.undo();
            }
            return;
        }
        if (modifier && !event.altKey && matchesKey('y', 'KeyY')) {
            event.preventDefault();
            this.commandManager.redo();
            return;
        }
        if (modifier && !event.altKey && matchesKey('d', 'KeyD')) {
            event.preventDefault();
            this.duplicateSelection();
            return;
        }
        if (modifier && !event.altKey && matchesKey('c', 'KeyC')) {
            event.preventDefault();
            void this._copySelection();
            return;
        }
        if (modifier && !event.altKey && matchesKey('x', 'KeyX')) {
            event.preventDefault();
            void this._cutSelection();
            return;
        }
        if (modifier && !event.altKey && matchesKey('a', 'KeyA')) {
            event.preventDefault();
            this._selectAll();
            return;
        }
        if (modifier && !event.altKey && (event.code === 'Digit0' || key === '0')) {
            event.preventDefault();
            this.viewportController.fit();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            if (['brush', 'highlighter', 'arrow', 'frame', 'placement', 'image-eraser'].includes(this.activeTool)) {
                this._setActiveTool('select');
                return;
            }
            this.store.setSelections([]);
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            this.deleteSelection();
        }
    }

    _renderSelection(elementIds) {
        const $toolbar = this.$root.find('[data-role="contextual-toolbar"]');
        const elements = elementIds.map((id) => this.store.getElement(id)).filter(Boolean);
        if (
            this.activeTool === 'image-eraser'
            && (
                elements.length !== 1
                || elements[0].type !== 'image'
                || elements[0].locked === true
                || elements[0].id !== this.imageEraserElementId
            )
        ) {
            this._setActiveTool('select');
        }
        if (elements.length === 0) {
            $toolbar.prop('hidden', true);
            this.$root.find('[data-role="contextual-group-actions"]').prop('hidden', true);
            this._hideSelectionDimensions();
            this.$root.find('[data-role="rotation-control"]').prop('hidden', true);
            this._setToolbarLinkEditorOpen(false);
            if (this.toolbarPositionFrame !== null) {
                cancelAnimationFrame(this.toolbarPositionFrame);
                this.toolbarPositionFrame = null;
            }
            this._renderProperties(null);
            return;
        }
        if (elements.length > 1) {
            const lockedCount = elements.filter(({ locked }) => locked === true).length;
            const lockLabel = lockedCount > 0 ? ` · заблокировано: ${lockedCount}` : '';
            this._renderContextualObjectTools(null, `${getSelectionSummary(elements)}${lockLabel}`);
            $toolbar.prop('hidden', false);
            this.positionSelectionOverlays();
            this._renderProperties(null);
            return;
        }
        const [element] = elements;
        this._renderContextualObjectTools(element);
        $toolbar.prop('hidden', false);
        this.positionSelectionOverlays();
        this._renderProperties(element);
        this.$root.find('[data-properties-for] input, [data-properties-for] select, [data-properties-for] button')
            .prop('disabled', element.locked === true);
    }

    _renderContextualObjectTools(element, summary = '') {
        this._setToolbarLinkEditorOpen(false);
        this._setAlignmentPopoverOpen(false);
        const $rotationControl = this.$root.find('[data-role="rotation-control"]');
        const $moreRoot = this.$root.find('[data-contextual-more-root]');
        const $summary = this.$root.find('[data-role="selected-type"]');
        const $toolbars = this.$root.find('[data-object-toolbar]').prop('hidden', true);
        const canGroup = this.commandRegistry.canExecute('group');
        const canUngroup = this.commandRegistry.canExecute('ungroup');
        const $groupActions = this.$root.find('[data-role="contextual-group-actions"]')
            .prop('hidden', !canGroup && !canUngroup);
        $groupActions.find('[data-editor-command="group"]').prop('hidden', !canGroup);
        $groupActions.find('[data-editor-command="ungroup"]').prop('hidden', !canUngroup);
        this.$root.find('[data-more-types]').prop('hidden', true);
        if (!element) {
            this._setContextualMoreOpen(false);
            $rotationControl.prop('hidden', true);
            $summary.text(summary || 'Объект').prop('hidden', false);
            return;
        }
        const rotation = Number.isFinite(Number(element.rotation)) ? Number(element.rotation) : 0;
        $rotationControl
            .prop('hidden', false)
            .find('[data-object-property="rotation"]')
            .val(String(Math.round(rotation)))
            .prop('disabled', element.locked === true);

        const type = element.type === 'rectangle' ? 'shape' : element.type;
        if (this.contextualMoreOpen && this.contextualMoreElementId !== element.id) {
            this._setContextualMoreOpen(false);
        }
        const $toolbar = $toolbars.filter(`[data-object-toolbar="${type}"]`);
        if ($toolbar.length === 0) {
            $summary.text('Объект').prop('hidden', false);
            return;
        }
        this.$root.find('[data-more-types]').each((_, control) => {
            const supportedTypes = String(control.dataset.moreTypes || '').split(/\s+/).filter(Boolean);
            this.$(control).prop('hidden', !supportedTypes.includes(type));
        });
        $summary.prop('hidden', true);
        $toolbar.prop('hidden', false);
        const locked = element.locked === true;
        $toolbar.find('button, input, select').prop('disabled', locked);
        $moreRoot.find('[data-object-property], [data-object-action]:not([data-object-action="toggle-contextual-more"])')
            .prop('disabled', locked);
        $moreRoot.find('[data-role="frame-clip-toggle"]')
            .attr('aria-disabled', String(locked))
            .attr('tabindex', locked ? '-1' : '0');
        $moreRoot.find('[data-role="contextual-more-trigger"]').prop('disabled', false);
        const $lockButton = this.$root.find('[data-role="contextual-toolbar"] [data-object-action="toggle-lock"]:not([hidden])');
        const lockTargetLabel = type === 'image' ? 'изображение' : type === 'shape' ? 'фигуру' : 'объект';
        $lockButton
            .prop('disabled', false)
            .attr('aria-pressed', String(locked))
            .attr('aria-label', `${locked ? 'Разблокировать' : 'Заблокировать'} ${lockTargetLabel}`);
        $lockButton.filter('.contextual-toolbar__button')
            .attr('data-tooltip', locked ? 'Разблокировать' : 'Заблокировать');
        $lockButton.filter('.contextual-toolbar__more-item').removeAttr('data-tooltip');
        $lockButton.find('[data-role="contextual-lock-label"]')
            .text(locked ? 'Разблокировать' : 'Заблокировать');

        if (type === 'image') {
            $toolbar.find('[data-object-action="flip-x"]').attr('aria-pressed', String(element.flipX === true));
            $toolbar.find('[data-object-action="flip-y"]').attr('aria-pressed', String(element.flipY === true));
            const cornerRadiusPresets = [0, 8, 16, 24, 40, 64];
            const cornerRadius = Math.max(0, Math.min(1000, Math.round(Number(element.cornerRadius) || 0)));
            const $cornerRadiusSelect = $moreRoot.find('select[data-object-property="cornerRadius"]');
            const $customCornerRadius = $cornerRadiusSelect.find('[data-role="image-corner-radius-custom"]');
            if (cornerRadiusPresets.includes(cornerRadius)) {
                $customCornerRadius.attr('value', 'custom').prop('hidden', true);
            } else {
                $customCornerRadius.attr('value', String(cornerRadius)).text(`${cornerRadius} px`).prop('hidden', false);
            }
            $cornerRadiusSelect.val(String(cornerRadius));
            $moreRoot.find('[data-role="image-corner-radius-range"]').val(String(cornerRadius));
            $moreRoot.find('[data-role="image-corner-radius-value"]').text(`${cornerRadius} px`);
            const $backgroundRemovalButton = $toolbar.find('[data-object-action="remove-background"]');
            this._renderBackgroundRemovalState($backgroundRemovalButton[0], element);
            this._renderImageEraserState(element);
        } else if (type === 'shape') {
            $toolbar.find('[data-object-property="fill"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#8094b1');
            $toolbar.find('[data-object-property="stroke"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.stroke) ? element.stroke : '#707070');
            const strokeWidth = [0, 1, 3, 6].includes(Number(element.strokeWidth))
                ? Number(element.strokeWidth)
                : 1;
            $toolbar.find('[data-object-property="strokeWidth"]').val(String(strokeWidth));
            const opacityOptions = [1, 0.75, 0.5, 0.25, 0.1];
            const opacity = Number.isFinite(element.opacity) ? element.opacity : 1;
            const nearestOpacity = opacityOptions.reduce((nearest, option) => (
                Math.abs(option - opacity) < Math.abs(nearest - opacity) ? option : nearest
            ), 1);
            $toolbar.find('[data-object-property="opacity"]').val(String(nearestOpacity));
        } else if (type === 'brush') {
            const stroke = /^#[0-9a-f]{6}$/i.test(element.stroke) ? element.stroke : '#282828';
            const strokeWidth = [2, 5, 10, 18].includes(Number(element.strokeWidth))
                ? Number(element.strokeWidth)
                : 5;
            $toolbar.find('[data-object-property="stroke"]').val(stroke);
            $toolbar.find('[data-object-property="strokeWidth"]').val(String(strokeWidth));
            this._setBrushSettings({ stroke, strokeWidth });
        } else if (type === 'arrow') {
            const stroke = /^#[0-9a-f]{6}$/i.test(element.stroke) ? element.stroke : '#282828';
            const strokeWidth = ARROW_STROKE_WIDTHS.includes(Number(element.strokeWidth))
                ? Number(element.strokeWidth)
                : 5;
            const startCap = ARROW_CAP_TYPES.includes(element.startCap) ? element.startCap : 'none';
            const endCap = ARROW_CAP_TYPES.includes(element.endCap) ? element.endCap : 'arrow1';
            $toolbar.find('[data-object-property="stroke"]').val(stroke);
            $toolbar.find('[data-object-property="strokeWidth"]').val(String(strokeWidth));
            $toolbar.find('[data-object-property="startCap"]').val(startCap);
            $toolbar.find('[data-object-property="endCap"]').val(endCap);
            this._setArrowSettings({ stroke, strokeWidth, startCap, endCap });
        } else if (type === 'highlighter') {
            const stroke = /^#[0-9a-f]{6}$/i.test(element.stroke) ? element.stroke : '#ffdf5d';
            const strokeWidth = [16, 28, 40, 56].includes(Number(element.strokeWidth))
                ? Number(element.strokeWidth)
                : 40;
            const opacityOptions = [0.15, 0.25, 0.35, 0.5];
            const opacity = opacityOptions.includes(Number(element.opacity)) ? Number(element.opacity) : 0.35;
            $toolbar.find('[data-object-property="stroke"]').val(stroke);
            $toolbar.find('[data-object-property="strokeWidth"]').val(String(strokeWidth));
            $toolbar.find('[data-object-property="opacity"]').val(String(opacity));
            this._setHighlighterSettings({ stroke, strokeWidth, opacity });
        } else if (type === 'sticker') {
            $toolbar.find('[data-object-property="fill"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#ffdf6b');
            $toolbar.find('[data-object-property="textColor"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.textColor) ? element.textColor : '#282828');
            const fontFamilies = ['Roboto', 'Inter', 'Georgia', 'Comic Sans MS', 'Roboto Condensed'];
            $toolbar.find('[data-object-property="fontFamily"]')
                .val(fontFamilies.includes(element.fontFamily) ? element.fontFamily : 'Roboto');
            const fontSize = Math.min(240, Math.max(8, Math.round(Number(element.fontSize) || 24)));
            $moreRoot.find('[data-object-property="fontSize"]').val(String(fontSize));
            const align = ['left', 'center', 'right'].includes(element.align) ? element.align : 'left';
            $toolbar.find('[data-object-action="set-align"]')
                .attr('aria-pressed', 'false')
                .filter(`[data-value="${align}"]`)
                .attr('aria-pressed', 'true');
            const alignLabels = {
                left: 'по левому краю',
                center: 'по центру',
                right: 'по правому краю',
            };
            $toolbar.find('[data-role="align-trigger"]')
                .attr('data-align', align)
                .attr('aria-label', `Выравнивание текста стикера: ${alignLabels[align]}`);
        } else if (type === 'frame') {
            const $frameControls = $toolbar.add($moreRoot);
            $frameControls.find('[data-object-property="name"]').val(element.name || 'Фрейм');
            const backgroundColor = /^#[0-9a-f]{6}$/i.test(element.backgroundColor)
                ? element.backgroundColor.toLowerCase()
                : '#ffffff';
            const backgroundOpacityOptions = [0, 0.25, 0.5, 0.75, 1];
            const backgroundOpacity = backgroundOpacityOptions.includes(Number(element.backgroundOpacity))
                ? Number(element.backgroundOpacity)
                : 0;
            $frameControls.find('[data-object-property="backgroundColor"]').val(backgroundColor);
            $frameControls.find('[data-object-property="backgroundOpacity"]').val(String(backgroundOpacity));
            const clipContent = element.clipContent !== false;
            $frameControls.find('[data-role="frame-clip-toggle"]')
                .prop('checked', clipContent);
            const layoutGridColumns = [0, 2, 3, 4, 6, 12].includes(Number(element.layoutGridColumns))
                ? Number(element.layoutGridColumns)
                : 0;
            $frameControls.find('[data-object-property="layoutGridColumns"]').val(String(layoutGridColumns));
        } else if (type === 'text') {
            $toolbar.find('[data-object-property="fill"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#282828');
            const fontFamilies = ['Roboto', 'Inter', 'Georgia', 'Comic Sans MS', 'Roboto Condensed'];
            $toolbar.find('[data-object-property="fontFamily"]')
                .val(fontFamilies.includes(element.fontFamily) ? element.fontFamily : 'Roboto');
            const fontSize = Math.min(240, Math.max(8, Math.round(Number(element.fontSize) || 24)));
            $moreRoot.find('[data-object-property="fontSize"]').val(String(fontSize));
            const align = ['left', 'center', 'right'].includes(element.align) ? element.align : 'left';
            $toolbar.find('[data-object-action="set-align"]')
                .attr('aria-pressed', 'false')
                .filter(`[data-value="${align}"]`)
                .attr('aria-pressed', 'true');
            const alignLabels = {
                left: 'по левому краю',
                center: 'по центру',
                right: 'по правому краю',
            };
            $toolbar.find('[data-role="align-trigger"]')
                .attr('data-align', align)
                .attr('aria-label', `Выравнивание текста: ${alignLabels[align]}`);
        }

        const $linkButton = this.$root.find(
            '[data-role="contextual-toolbar"] [data-object-action="edit-link"]:not([hidden])',
        );
        $linkButton
            .attr('aria-pressed', String(Boolean(element.hyperlink)))
            .attr('aria-label', element.hyperlink ? 'Изменить прикреплённую ссылку' : 'Прикрепить ссылку');
        $linkButton.filter('.contextual-toolbar__button')
            .attr('data-tooltip', element.hyperlink ? 'Изменить ссылку' : 'Добавить ссылку');
        $linkButton.filter('.contextual-toolbar__more-item')
            .removeAttr('data-tooltip')
            .find('span')
            .text(element.hyperlink ? 'Изменить ссылку' : 'Добавить ссылку');
    }

    setContextualToolbarRotationActive(active) {
        const $toolbar = this.$root.find('[data-role="contextual-toolbar"]');
        $toolbar.toggleClass('contextual-toolbar--rotation-hidden', active === true);
        if (active === true) {
            $toolbar.attr('aria-hidden', 'true');
            if (this.toolbarPositionFrame !== null) {
                cancelAnimationFrame(this.toolbarPositionFrame);
                this.toolbarPositionFrame = null;
            }
            return;
        }
        $toolbar.removeAttr('aria-hidden');
        this.positionContextualToolbar();
    }

    positionContextualToolbar() {
        if (this.toolbarPositionFrame !== null) {
            cancelAnimationFrame(this.toolbarPositionFrame);
        }
        this.toolbarPositionFrame = requestAnimationFrame(() => {
            this.toolbarPositionFrame = null;
            const toolbar = this.$root.find('[data-role="contextual-toolbar"]')[0];
            const workspace = this.$root.find('.canvas-workspace')[0];
            const selectionRect = this.canvasAdapter.getSelectionClientRect?.();
            if (!toolbar || !workspace || toolbar.hidden || !selectionRect) {
                return;
            }

            const margin = 12;
            const gap = 18;
            const reservedBottom = 82;
            const toolbarWidth = toolbar.offsetWidth;
            const toolbarHeight = toolbar.offsetHeight;
            const maxLeft = Math.max(margin, workspace.clientWidth - toolbarWidth - margin);
            const maxTop = Math.max(margin, workspace.clientHeight - toolbarHeight - reservedBottom);
            const centeredLeft = selectionRect.x + selectionRect.width / 2 - toolbarWidth / 2;
            const aboveTop = selectionRect.y - toolbarHeight - gap;
            const belowTop = selectionRect.y + selectionRect.height + gap;
            const preferredTop = aboveTop >= margin ? aboveTop : belowTop;

            toolbar.style.left = `${Math.round(Math.min(maxLeft, Math.max(margin, centeredLeft)))}px`;
            toolbar.style.top = `${Math.round(Math.min(maxTop, Math.max(margin, preferredTop)))}px`;
            this._positionImageEraserPopover({ toolbar, workspace, selectionRect });
        });
    }

    _positionImageEraserPopover({ toolbar, workspace, selectionRect }) {
        const popover = toolbar.querySelector('[data-role="image-eraser-popover"]');
        if (!popover || popover.hidden) {
            return;
        }

        const margin = 12;
        const gap = 12;
        const reservedBottom = 82;
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const workspaceWidth = workspace.clientWidth;
        const workspaceHeight = workspace.clientHeight;
        const toolbarLeft = toolbar.offsetLeft;
        const toolbarTop = toolbar.offsetTop;
        const toolbarWidth = toolbar.offsetWidth;
        const maxX = Math.max(margin, workspaceWidth - width - margin);
        const maxY = Math.max(margin, workspaceHeight - height - reservedBottom);
        const clampX = (value) => Math.min(maxX, Math.max(margin, value));
        const clampY = (value) => Math.min(maxY, Math.max(margin, value));
        const fits = ({ x, y }) => (
            x >= margin
            && y >= margin
            && x + width <= workspaceWidth - margin
            && y + height <= workspaceHeight - reservedBottom
        );
        const candidates = [
            {
                placement: 'right',
                x: selectionRect.x + selectionRect.width + gap,
                y: selectionRect.y,
            },
            {
                placement: 'left',
                x: selectionRect.x - width - gap,
                y: selectionRect.y,
            },
            {
                placement: 'top',
                x: toolbarLeft + toolbarWidth / 2 - width / 2,
                y: toolbarTop - height - gap,
            },
            {
                placement: 'bottom',
                x: selectionRect.x + selectionRect.width / 2 - width / 2,
                y: selectionRect.y + selectionRect.height + gap,
            },
        ];
        const resolved = candidates.find(fits) || candidates
            .map((candidate) => ({
                ...candidate,
                x: clampX(candidate.x),
                y: clampY(candidate.y),
            }))
            .sort((first, second) => {
                const overlapArea = ({ x, y }) => (
                    Math.max(0, Math.min(x + width, selectionRect.x + selectionRect.width) - Math.max(x, selectionRect.x))
                    * Math.max(0, Math.min(y + height, selectionRect.y + selectionRect.height) - Math.max(y, selectionRect.y))
                );
                return overlapArea(first) - overlapArea(second);
            })[0];
        const workspaceRect = workspace.getBoundingClientRect();

        popover.dataset.placement = resolved.placement;
        popover.style.left = `${Math.round(workspaceRect.left + clampX(resolved.x))}px`;
        popover.style.top = `${Math.round(workspaceRect.top + clampY(resolved.y))}px`;
    }

    positionSelectionOverlays() {
        this.positionContextualToolbar();
        this.positionSelectionDimensions();
    }

    positionSelectionDimensions() {
        if (this.dimensionsPositionFrame !== null) {
            cancelAnimationFrame(this.dimensionsPositionFrame);
        }
        const badge = this.$root.find('[data-role="selection-dimensions"]')[0];
        if (!badge || !this.settings.showElementDimensions || this.store.getSelectedElementIds().length === 0) {
            this._hideSelectionDimensions();
            return;
        }
        badge.hidden = false;
        this.dimensionsPositionFrame = requestAnimationFrame(() => {
            this.dimensionsPositionFrame = null;
            const workspace = this.$root.find('.canvas-workspace')[0];
            const selectionRect = this.canvasAdapter.getSelectionClientRect?.();
            const dimensions = this.canvasAdapter.getSelectionDimensions?.();
            const label = formatSelectionDimensions(dimensions);
            if (!workspace || !selectionRect || !label || !this.settings.showElementDimensions) {
                this._hideSelectionDimensions();
                return;
            }

            badge.textContent = label;
            badge.hidden = false;
            const position = resolveSelectionDimensionsPosition({
                selectionRect,
                badgeWidth: badge.offsetWidth,
                badgeHeight: badge.offsetHeight,
                workspaceWidth: workspace.clientWidth,
                workspaceHeight: workspace.clientHeight,
            });
            if (!position) {
                this._hideSelectionDimensions();
                return;
            }
            badge.style.left = `${position.left}px`;
            badge.style.top = `${position.top}px`;
            badge.dataset.placement = position.placement;
        });
    }

    _hideSelectionDimensions() {
        if (this.dimensionsPositionFrame !== null) {
            cancelAnimationFrame(this.dimensionsPositionFrame);
            this.dimensionsPositionFrame = null;
        }
        const badge = this.$root.find('[data-role="selection-dimensions"]')[0];
        if (badge) {
            badge.hidden = true;
            badge.textContent = '';
            delete badge.dataset.placement;
        }
    }

    _renderProperties(element) {
        this.$root.find('[data-properties-for]').prop('hidden', true);
        if (!element) {
            this.$root.find('[data-properties-for="none"]').prop('hidden', false);
            return;
        }

        const type = element.type === 'rectangle' ? 'shape' : element.type;
        this.$root.find(`[data-properties-for="${type}"]`).prop('hidden', false);
        if (type === 'text') {
            this.$root.find('[data-property="text"]').val(element.text || '');
            this.$root.find('[data-property="fontSize"]').val(element.fontSize || 48);
            this.$root.find('[data-properties-for="text"] [data-property="fill"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#282828');
            const isBold = element.fontStyle === 'bold';
            this.$root.find('[data-property-action="toggle-bold"]')
                .attr('aria-pressed', String(isBold))
                .toggleClass('property-toggle--active', isBold);
            const align = ['left', 'center', 'right'].includes(element.align) ? element.align : 'left';
            this.$root.find('[data-property-action="set-align"]')
                .attr('aria-pressed', 'false')
                .removeClass('property-toggle--active')
                .filter(`[data-value="${align}"]`)
                .attr('aria-pressed', 'true')
                .addClass('property-toggle--active');
        } else if (type === 'shape') {
            const shapeType = element.type === 'rectangle' ? 'rectangle' : (element.shapeType || 'rectangle');
            this.$root.find('[data-property="shapeType"]').val(shapeType);
            this.$root.find('[data-properties-for="shape"] [data-property="fill"]')
                .val(/^#[0-9a-f]{6}$/i.test(element.fill) ? element.fill : '#8094b1');
            const opacity = Number.isFinite(element.opacity) ? element.opacity : 1;
            this.$root.find('[data-property="opacity"]').val(opacity);
            this._renderOpacityValue(opacity);
        }
    }

    _renderOpacityValue(value) {
        const opacity = Math.min(1, Math.max(0, Number(value) || 0));
        this.$root.find('[data-role="opacity-value"]').text(`${Math.round(opacity * 100)}%`);
    }

    _renderCommandAvailability() {
        this.$root.find('[data-editor-command]').each((_, control) => {
            const commandName = control.dataset.editorCommand;
            this.$(control).prop('disabled', !this.commandRegistry.canExecute(commandName));
        });
    }

    _renderSaveStatus(status, message) {
        const labels = {
            loading: 'Загрузка сцены…',
            dirty: 'Сцена изменена',
            saving: 'Сохраняем сцену…',
            saved: 'Сцена сохранена',
            error: message ? `Ошибка сохранения сцены: ${message}` : 'Ошибка сохранения сцены',
        };
        this.$root.find('[data-role="save-status"]')
            .attr('data-status', status)
            .attr('title', status === 'error' ? message : labels[status])
            .text(labels[status] || status);
    }

    _setSettingsOpen(open, { restoreFocus = false, focus = true } = {}) {
        this.settingsOpen = Boolean(open);
        if (this.settingsOpen && this.actionPopover) {
            this._setActionPopoverOpen(null);
        }
        if (this.settingsOpen && this.pagesOpen) {
            this._setPagesOpen(false);
        }
        if (this.settingsOpen && this.exportOpen) {
            this._setExportOpen(false);
        }
        const $trigger = this.$root.find('[data-action="toggle-settings"]');
        const $popover = this.$root.find('[data-role="settings-popover"]');
        $trigger.attr('aria-expanded', String(this.settingsOpen));
        $popover.prop('hidden', !this.settingsOpen);

        if (this.settingsOpen) {
            this.$root.find('[data-role="project-name"]').val(this.store.title);
            if (focus) {
                requestAnimationFrame(() => {
                    this.$root.find('[data-role="project-name"]:not(:disabled)').trigger('focus');
                });
            }
        } else if (restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _setPagesOpen(open, { restoreFocus = false } = {}) {
        this.pagesOpen = Boolean(open);
        if (this.pagesOpen && this.actionPopover) {
            this._setActionPopoverOpen(null);
        }
        if (this.pagesOpen && this.settingsOpen) {
            this._setSettingsOpen(false);
        }
        if (this.pagesOpen && this.exportOpen) {
            this._setExportOpen(false);
        }
        if (!this.pagesOpen) {
            this.renamingPageId = null;
            this.deletingPageId = null;
            this._clearPageDragState();
        }
        const $trigger = this.$root.find('[data-action="toggle-pages"]');
        $trigger.attr('aria-expanded', String(this.pagesOpen));
        this.$root.find('[data-role="pages-popover"]').prop('hidden', !this.pagesOpen);
        this._renderPages();
        if (!this.pagesOpen && restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _setExportOpen(open, { restoreFocus = false, focus = true } = {}) {
        this.exportOpen = Boolean(open);
        if (this.exportOpen) {
            this._renderMultipagePdfAvailability();
        }
        if (this.exportOpen && this.actionPopover) {
            this._setActionPopoverOpen(null);
        }
        if (this.exportOpen && this.settingsOpen) {
            this._setSettingsOpen(false);
        }
        if (this.exportOpen && this.pagesOpen) {
            this._setPagesOpen(false);
        }
        const $trigger = this.$root.find('[data-action="toggle-export"]');
        $trigger.attr('aria-expanded', String(this.exportOpen));
        this.$root.find('[data-role="export-menu"]').prop('hidden', !this.exportOpen);
        if (this.exportOpen && focus) {
            requestAnimationFrame(() => {
                this.$root.find('[data-export-option]:visible:not(:disabled)').first().trigger('focus');
            });
        } else if (restoreFocus) {
            $trigger.trigger('focus');
        }
    }

    _bindHoverPopover(selector, type) {
        this.$root.on('pointerenter.moodboardsEditor', selector, () => {
            if (!this._supportsHover()) {
                return;
            }
            if (this.$root.find(selector).find('[aria-haspopup]:disabled').length > 0) {
                return;
            }
            this._clearPopoverCloseTimer(type);
            const $focusedPopover = this.$(document.activeElement).closest(
                '.editor-export, .editor-settings, .page-switcher',
            );
            if ($focusedPopover.length > 0 && !$focusedPopover.is(selector)) {
                return;
            }
            this._setPopoverOpen(type, true, { focus: false });
        });
        this.$root.on('pointerleave.moodboardsEditor', selector, () => {
            if (!this._supportsHover()) {
                return;
            }
            this._clearPopoverCloseTimer(type);
            this.popoverCloseTimers[type] = window.setTimeout(() => {
                if (type === 'pages' && this.draggingPageId) {
                    return;
                }
                const focusInside = this.$(document.activeElement).closest(selector).length > 0;
                if (!focusInside) {
                    this._setPopoverOpen(type, false);
                }
            }, 180);
        });
    }

    _togglePopoverFromTrigger(type, event) {
        this._clearPopoverCloseTimer(type);
        const pointerClick = this._supportsHover() && event.detail > 0;
        const shouldOpen = pointerClick ? true : !this._isPopoverOpen(type);
        this._setPopoverOpen(type, shouldOpen, { focus: true });
    }

    _setPopoverOpen(type, open, options = {}) {
        if (open) {
            this._clearPopoverCloseTimer(type);
        }
        if (type === 'settings') {
            this._setSettingsOpen(open, options);
        } else if (type === 'pages') {
            this._setPagesOpen(open, options);
        } else if (type === 'export') {
            this._setExportOpen(open, options);
        } else if (type === 'shapes' || type === 'more') {
            this._setActionPopoverOpen(open ? type : null, { ...options, triggerType: type });
        }
    }

    _isPopoverOpen(type) {
        if (type === 'settings') {
            return this.settingsOpen;
        }
        if (type === 'pages') {
            return this.pagesOpen;
        }
        if (type === 'export') {
            return this.exportOpen;
        }
        return this.actionPopover === type;
    }

    _setActionPopoverOpen(type, { restoreFocus = false, focus = true, triggerType = null } = {}) {
        const nextType = ['shapes', 'more'].includes(type) ? type : null;
        const previousType = this.actionPopover;
        if (previousType) {
            this._clearPopoverCloseTimer(previousType);
        }
        this.actionPopover = nextType;
        this.$root.find('[data-action="toggle-action-popover"]').each((_, trigger) => {
            const expanded = trigger.dataset.actionPopover === nextType;
            this.$(trigger).attr('aria-expanded', String(expanded));
        });
        this.$root.find('[data-role="action-popover"]').each((_, popover) => {
            this.$(popover).prop('hidden', popover.dataset.actionPopoverPanel !== nextType);
        });

        if (nextType) {
            this._clearPopoverCloseTimer(nextType);
            if (this.settingsOpen) this._setSettingsOpen(false);
            if (this.pagesOpen) this._setPagesOpen(false);
            if (this.exportOpen) this._setExportOpen(false);
            if (this.navigatorOpen) this._setNavigatorOpen(false);
            if (this.helpOpen) this._setHelpOpen(false);
            this._closeContextMenu();
            if (focus) {
                requestAnimationFrame(() => {
                    this.$root.find(`[data-action-popover-panel="${nextType}"] [role="menuitem"]:not(:disabled)`).first().trigger('focus');
                });
            }
        } else if (restoreFocus) {
            const restoreType = triggerType || previousType;
            this.$root.find(`[data-action="toggle-action-popover"][data-action-popover="${restoreType}"]`).trigger('focus');
        }
    }

    _clearPopoverCloseTimer(type) {
        clearTimeout(this.popoverCloseTimers[type]);
        this.popoverCloseTimers[type] = null;
    }

    _supportsHover() {
        return typeof window.matchMedia !== 'function'
            || window.matchMedia('(hover: hover)').matches;
    }

    _renderPages() {
        const pages = this.store.getPages();
        const activePageId = this.store.getActivePageId();
        const renderSignature = JSON.stringify({
            activePageId,
            deletingPageId: this.deletingPageId,
            pages: pages.map(({ id, name }) => [id, name]),
            renamingPageId: this.renamingPageId,
        });
        if (renderSignature === this.pagesRenderSignature) {
            return;
        }
        this.pagesRenderSignature = renderSignature;
        const activePage = pages.find(({ id }) => id === activePageId) || pages[0];
        this.$root.find('[data-role="active-page-name"]')
            .text(activePage?.name || 'Лист')
            .attr('title', activePage?.name || '');
        this.$root.find('[data-action="toggle-pages"]')
            .attr('aria-label', activePage ? `Текущий лист: ${activePage.name}. Выбрать лист` : 'Выбрать лист');

        const $list = this.$root.find('[data-role="pages-list"]').empty();
        const canDelete = pages.length > 1;
        const canAdd = pages.length < this.maxPages;
        const limitMessage = `Достигнут лимит: ${this.maxPages} листов в одном мудборде.`;
        let renameInput = null;
        for (const page of pages) {
            const isActive = page.id === activePageId;
            const $item = this.$('<div>', {
                class: `page-switcher__item${isActive ? ' page-switcher__item--active' : ''}`,
                role: 'listitem',
                'data-page-id': page.id,
            });

            if (this.renamingPageId === page.id) {
                renameInput = this.$('<input>', {
                    class: 'page-switcher__rename',
                    type: 'text',
                    maxlength: 80,
                    value: page.name,
                    'data-role': 'page-name-input',
                    'data-page-id': page.id,
                    'aria-label': `Новое название листа «${page.name}»`,
                });
                $item.append(renameInput);
            } else {
                const $dragHandle = this.$('<button>', {
                    class: 'page-switcher__grip',
                    type: 'button',
                    draggable: true,
                    'data-role': 'page-drag-handle',
                    'data-page-id': page.id,
                    'aria-label': `Изменить положение листа «${page.name}»`,
                    title: 'Перетащить лист',
                    text: '⠿',
                });
                const $select = this.$('<button>', {
                    class: 'page-switcher__select',
                    type: 'button',
                    'data-action': 'select-page',
                    'data-page-id': page.id,
                    'aria-current': isActive ? 'page' : undefined,
                    'aria-label': `Открыть лист «${page.name}»`,
                });
                this.$('<span>', {
                    class: 'page-switcher__name',
                    title: page.name,
                    text: page.name,
                }).appendTo($select);

                const $actions = this.$('<span>', {
                    class: 'page-switcher__actions',
                    'aria-label': `Действия с листом «${page.name}»`,
                });
                this._createPageAction('duplicate-page', page, 'Копировать лист', '⧉', {
                    disabled: !canAdd,
                    disabledReason: limitMessage,
                }).appendTo($actions);
                this._createPageAction('rename-page', page, 'Переименовать лист', '✎').appendTo($actions);
                this._createPageAction('delete-page', page, 'Удалить лист', '×', {
                    danger: true,
                    disabled: !canDelete,
                }).appendTo($actions);
                $item.append($dragHandle, $select, $actions);
            }
            $list.append($item);
        }

        const deletingPage = pages.find(({ id }) => id === this.deletingPageId);
        const showDeleteConfirm = Boolean(deletingPage);
        $list.prop('hidden', showDeleteConfirm);
        this.$root.find('[data-action="create-page"]')
            .prop('hidden', showDeleteConfirm)
            .prop('disabled', !canAdd)
            .attr('aria-label', canAdd ? 'Создать новый лист' : limitMessage)
            .attr('title', canAdd ? 'Создать новый лист' : limitMessage);
        const $confirm = this.$root.find('[data-role="page-delete-confirm"]')
            .prop('hidden', !showDeleteConfirm);
        if (showDeleteConfirm) {
            this.$root.find('[data-role="page-delete-message"]')
                .text(`Лист «${deletingPage.name}» и все его элементы будут удалены.`);
            requestAnimationFrame(() => {
                $confirm.find('[data-action="cancel-delete-page"]').trigger('focus');
            });
        } else if (renameInput) {
            requestAnimationFrame(() => {
                renameInput.trigger('focus').get(0)?.select();
            });
        }
    }

    _clearPageDragState() {
        this.draggingPageId = null;
        this.$root.find('.page-switcher__item').removeClass([
            'page-switcher__item--dragging',
            'page-switcher__item--drop-before',
            'page-switcher__item--drop-after',
        ].join(' '));
    }

    _createPageAction(
        action,
        page,
        label,
        icon,
        { danger = false, disabled = false, disabledReason = '' } = {},
    ) {
        const accessibleLabel = disabled && disabledReason
            ? `${label} недоступно. ${disabledReason}`
            : `${label} «${page.name}»`;
        return this.$('<button>', {
            class: `page-switcher__action${danger ? ' page-switcher__action--danger' : ''}`,
            type: 'button',
            disabled,
            'data-action': action,
            'data-page-id': page.id,
            'aria-label': accessibleLabel,
            title: disabled && disabledReason ? disabledReason : label,
            text: icon,
        });
    }

    _submitPageRename(control) {
        const pageId = control.dataset.pageId;
        const currentPage = this.store.getPages().find(({ id }) => id === pageId);
        const nextName = String(this.$(control).val() || '').trim();
        if (!currentPage) {
            this.renamingPageId = null;
            this._renderPages();
            return;
        }
        if (nextName === currentPage.name) {
            this.renamingPageId = null;
            this._renderPages();
            return;
        }
        if (nextName === '' || nextName.length > 80) {
            this.notify('Название листа должно содержать от 1 до 80 символов.', 'error');
            this.$(control).val(currentPage.name).trigger('focus').get(0)?.select();
            return;
        }
        try {
            if (this.onRenamePage(pageId, nextName)) {
                this.notify('Название листа сохранено.', 'success');
            }
            this.renamingPageId = null;
            this._renderPages();
        } catch (error) {
            this.notify(error?.message || 'Не удалось переименовать лист.', 'error');
            this.$(control).val(currentPage.name).trigger('focus').get(0)?.select();
        }
    }

    async _submitProjectName(control) {
        if (this.renamePending) {
            return;
        }
        const nextTitle = String(this.$(control).val() || '').trim();
        if (nextTitle === this.store.title) {
            this.$(control).val(this.store.title);
            return;
        }
        if (nextTitle === '' || nextTitle.length > 160) {
            this.$(control).val(this.store.title);
            this.notify('Название должно содержать от 1 до 160 символов.', 'error');
            return;
        }

        this.renamePending = true;
        const $field = this.$(control).closest('.editor-settings__field');
        $field.attr('aria-busy', 'true');
        this.$(control).prop('disabled', true);
        try {
            const savedTitle = await this.onRename(nextTitle);
            this.$(control).val(savedTitle || nextTitle);
            this.notify('Название проекта сохранено.', 'success');
        } catch (error) {
            this.$(control).val(this.store.title);
            this.notify(error?.message || 'Не удалось переименовать проект.', 'error');
        } finally {
            this.renamePending = false;
            $field.removeAttr('aria-busy');
            this.$(control).prop('disabled', false);
        }
    }

    _handleSettingChange(control) {
        const name = control.dataset.setting;
        if (!['showGrid', 'showCanvasSheet', 'showElementDimensions', 'alwaysSnap', 'showBindingGuides', 'darkMode', 'focusMode'].includes(name)) {
            return;
        }
        this.settings[name] = Boolean(control.checked);
        this._renderSettings();
        this.onSettingsChange({ ...this.settings });
    }

    _renderSettings() {
        const focusModeChanged = this.$root.hasClass('editor-shell--focus-mode') !== this.settings.focusMode;
        for (const [name, enabled] of Object.entries(this.settings)) {
            this.$root.find(`[data-setting="${name}"]`).prop('checked', enabled);
        }
        this.$root.find('.canvas-workspace')
            .toggleClass('canvas-workspace--grid-hidden', !this.settings.showGrid);
        this.$root
            .toggleClass('editor-shell--dark', this.settings.darkMode)
            .toggleClass('editor-shell--focus-mode', this.settings.focusMode)
            .attr('data-focus-mode', String(this.settings.focusMode));
        this.positionSelectionDimensions();
        if (focusModeChanged) {
            requestAnimationFrame(() => this.viewportController.refresh());
        }
    }

    _renderCanvasGrid(viewport = this.store.getViewport()) {
        const workspace = this.$root.find('.canvas-workspace')[0];
        if (!workspace) {
            return;
        }
        const scale = Math.max(0.1, Number(viewport?.scale) || 1);
        let spacing = 18 * scale;
        while (spacing < 12) spacing *= 2;
        while (spacing > 32) spacing /= 2;

        const normalizeOffset = (value) => {
            const offset = (Number(value) || 0) % spacing;
            return offset < 0 ? offset + spacing : offset;
        };
        workspace.style.setProperty('--canvas-grid-spacing', `${spacing.toFixed(3)}px`);
        workspace.style.setProperty('--canvas-grid-offset-x', `${normalizeOffset(viewport?.x).toFixed(3)}px`);
        workspace.style.setProperty('--canvas-grid-offset-y', `${normalizeOffset(viewport?.y).toFixed(3)}px`);
    }

    _scheduleViewportRender(viewport) {
        this.pendingViewportRender = viewport;
        if (this.viewportRenderFrame !== null) {
            return;
        }
        this.viewportRenderFrame = requestAnimationFrame(() => {
            this.viewportRenderFrame = null;
            const nextViewport = this.pendingViewportRender;
            this.pendingViewportRender = null;
            if (!nextViewport) {
                return;
            }
            this.$root.find('[data-role="zoom-value"]')
                .text(`${Math.round(nextViewport.scale * 100)}%`);
            this._renderCanvasGrid(nextViewport);
            this._renderNavigatorViewport();
            this.positionSelectionOverlays();
        });
    }

    _containsFiles(event) {
        return Array.from(event?.dataTransfer?.types || []).includes('Files');
    }

    _setDropTargetActive(active) {
        this.$root.find('[data-role="drop-overlay"]').prop('hidden', !active);
        this.$root.find('[data-role="canvas-shell"]').toggleClass('canvas-shell--drop-active', active);
    }

    _submitFiles(files) {
        if (files.length === 0) {
            return;
        }
        if (this.uploadActive) {
            this.notify('Дождитесь завершения текущей загрузки изображений.', 'error');
            return;
        }
        this._setActiveTool('select');
        Promise.resolve(this.onFilesSelected(files)).catch((error) => {
            this.setUploadState({ active: false });
            this.notify(error.message || 'Не удалось добавить изображения.', 'error');
        });
    }
}
