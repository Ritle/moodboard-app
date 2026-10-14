import { bootstrapPage } from '../app-bootstrap.js';
import { renderMoodboardsAccountControl } from '../access/moodboards-account-control.js';
import { fetchMoodboardsAccess } from '../access/moodboards-access-service.js';
import { CanvasAdapter } from '../editor/canvas-adapter.js';
import { createPdfFromJpeg, createPdfFromJpegs } from '../editor/pdf-exporter.js';
import { selectFilledPages } from '../editor/preview-manager.js';
import {
    createPublicMoodboardRepository,
    resolvePublicViewerReference,
} from '../repositories/public-repository-factory.js';

const VIEWER_MIN_SCALE = 0.1;
const VIEWER_MAX_SCALE = 5;
const VIEWER_ZOOM_STEP = 1.15;

export function clampViewerScale(scale) {
    return Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, Number(scale) || 1));
}

export function resolveViewerZoomViewport(viewport, requestedScale, point) {
    const currentScale = clampViewerScale(viewport?.scale);
    const scale = clampViewerScale(requestedScale);
    const anchor = {
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
    };
    const viewportX = Number(viewport?.x) || 0;
    const viewportY = Number(viewport?.y) || 0;
    const worldPoint = {
        x: (anchor.x - viewportX) / currentScale,
        y: (anchor.y - viewportY) / currentScale,
    };
    return {
        scale,
        x: anchor.x - worldPoint.x * scale,
        y: anchor.y - worldPoint.y * scale,
    };
}

export function resolveViewerPanViewport(viewport, delta) {
    return {
        scale: clampViewerScale(viewport?.scale),
        x: (Number(viewport?.x) || 0) + (Number(delta?.x) || 0),
        y: (Number(viewport?.y) || 0) + (Number(delta?.y) || 0),
    };
}

export class PublicMoodboardViewer {
    constructor(pageRuntime) {
        this.runtime = pageRuntime;
        this.root = document.querySelector('[data-page="viewer"]');
        this.workspace = this.root?.querySelector('.viewer-workspace') || null;
        this.canvasShell = this.root?.querySelector('[data-role="viewer-canvas-shell"]') || null;
        this.container = this.root?.querySelector('[data-role="viewer-canvas-container"]') || null;
        this.repository = null;
        this.record = null;
        this.activePageId = null;
        this.canvasAdapter = null;
        this.resizeObserver = null;
        this.notificationTimer = null;
        this.exportCloseTimer = null;
        this.exportOpen = false;
        this.viewport = { scale: 1, x: 0, y: 0 };
        this.isPanning = false;
        this.lastPanPointer = null;
        this.accessAbortController = new AbortController();
        this.destroyed = false;
        this.handlePageExit = () => this.destroy();
        this.handlePanEnd = () => this._finishCanvasPan();
    }

    async init() {
        if (!(this.root instanceof HTMLElement) || !(this.container instanceof HTMLElement)) {
            return;
        }
        this._bindEvents();
        void this._loadAccountState();

        try {
            const publicReference = resolvePublicViewerReference(
                window.location.search,
                this.runtime.config,
            );
            if (!publicReference.reference) {
                throw new Error('В публичной ссылке отсутствует token мудборда.');
            }
            this.repository = createPublicMoodboardRepository(this.runtime.config, {
                reference: publicReference.reference,
            });
            const record = await this.repository.getSnapshot();
            if (!record) {
                throw new Error('Ссылка недействительна либо мудборд был удалён владельцем.');
            }
            if (!Array.isArray(record.document?.pages) || record.document.pages.length === 0) {
                throw new Error('В мудборде нет доступных для просмотра листов.');
            }

            this.record = record;
            this.activePageId = record.document.pages[0].id;
            this._renderHeader();
            this._showCanvas();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            this._createCanvas();
            this._renderActivePage();
            this.root.querySelectorAll('[data-viewer-control]').forEach((control) => {
                control.disabled = false;
            });
            this._updateZoomControls();
            this.workspace?.setAttribute('aria-busy', 'false');
            window.addEventListener('pagehide', this.handlePageExit, { once: true });
        } catch (error) {
            await this.repository?.close?.();
            this.repository = null;
            this._showError(error?.message || 'Не удалось открыть публичный мудборд.');
        }
    }

    _bindEvents() {
        this.root.addEventListener('change', (event) => {
            if (event.target?.matches('[data-role="viewer-page-select"]')) {
                this.activePageId = event.target.value;
                this._renderActivePage();
            }
        });
        this.root.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const exportTrigger = target?.closest('[data-action="toggle-viewer-export"]');
            if (exportTrigger) {
                event.preventDefault();
                this._setExportOpen(event.detail > 0 ? true : !this.exportOpen);
                return;
            }
            const exportButton = target?.closest('[data-action="viewer-export"]');
            if (exportButton) {
                this._setExportOpen(false);
                void this._export(exportButton.dataset.format);
                return;
            }
            if (target?.closest('[data-action="viewer-zoom-out"]')) {
                this._zoomAtCenter(this.viewport.scale / VIEWER_ZOOM_STEP);
                return;
            }
            if (target?.closest('[data-action="viewer-zoom-in"]')) {
                this._zoomAtCenter(this.viewport.scale * VIEWER_ZOOM_STEP);
                return;
            }
            if (target?.closest('[data-action="viewer-zoom-fit"]')) {
                this._fitCanvas();
                return;
            }
            if (this.exportOpen && !target?.closest('.viewer-export')) {
                this._setExportOpen(false);
            }
        });

        const exportRoot = this.root.querySelector('.viewer-export');
        exportRoot?.addEventListener('pointerenter', () => {
            window.clearTimeout(this.exportCloseTimer);
            if (!exportRoot.querySelector('[data-action="toggle-viewer-export"]')?.disabled) {
                this._setExportOpen(true, { focus: false });
            }
        });
        exportRoot?.addEventListener('pointerleave', () => {
            window.clearTimeout(this.exportCloseTimer);
            this.exportCloseTimer = window.setTimeout(() => {
                if (!exportRoot.contains(document.activeElement)) {
                    this._setExportOpen(false);
                }
            }, 140);
        });
        exportRoot?.addEventListener('focusout', () => {
            requestAnimationFrame(() => {
                if (this.exportOpen && !exportRoot.contains(document.activeElement)) {
                    this._setExportOpen(false);
                }
            });
        });
        exportRoot?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.exportOpen) {
                event.preventDefault();
                event.stopPropagation();
                this._setExportOpen(false, { restoreFocus: true });
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
            }
            const options = Array.from(exportRoot.querySelectorAll('[role="menuitem"]:not(:disabled)'))
                .filter((option) => !option.hidden);
            if (options.length === 0) {
                return;
            }
            event.preventDefault();
            const currentIndex = options.indexOf(document.activeElement);
            let nextIndex;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = options.length - 1;
            else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
            else nextIndex = currentIndex >= options.length - 1 ? 0 : currentIndex + 1;
            options[nextIndex]?.focus();
        });
    }

    _setExportOpen(open, { focus = true, restoreFocus = false } = {}) {
        this.exportOpen = Boolean(open);
        const trigger = this.root.querySelector('[data-action="toggle-viewer-export"]');
        const menu = this.root.querySelector('[data-role="viewer-export-menu"]');
        trigger?.setAttribute('aria-expanded', String(this.exportOpen));
        if (menu) {
            menu.hidden = !this.exportOpen;
        }
        if (this.exportOpen && focus) {
            requestAnimationFrame(() => {
                const firstOption = Array.from(menu?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])
                    .find((option) => !option.hidden);
                firstOption?.focus();
            });
        } else if (!this.exportOpen && restoreFocus) {
            trigger?.focus();
        }
    }

    async _loadAccountState() {
        try {
            const policy = await fetchMoodboardsAccess(this.runtime.config.access.endpoint, {
                signal: this.accessAbortController.signal,
            });
            document.documentElement.dataset.moodboardsTariff = policy.tariffPlan;
            renderMoodboardsAccountControl(policy, {
                loginUrl: this.runtime.config.access.loginUrl,
                accountUrl: this.runtime.config.access.accountUrl,
                root: this.root,
            });
        } catch (error) {
            if (error?.name !== 'AbortError') {
                // При недоступном сервисе оставляем безопасное состояние «Войти».
                document.documentElement.dataset.moodboardsTariff = 'guest';
            }
        }
    }

    _renderHeader() {
        this.root.querySelector('[data-role="viewer-title"]').textContent = this.record.title;
        document.title = `${this.record.title} — публичный просмотр MoodBoards`;
        const pageControl = this.root.querySelector('[data-role="viewer-page-control"]');
        const select = this.root.querySelector('[data-role="viewer-page-select"]');
        select.replaceChildren();
        for (const page of this.record.document.pages) {
            const option = document.createElement('option');
            option.value = page.id;
            option.textContent = page.name;
            select.append(option);
        }
        select.value = this.activePageId;
        pageControl.hidden = this.record.document.pages.length <= 1;
        const multipagePdfOption = this.root.querySelector('[data-role="multipage-pdf-option"]');
        if (multipagePdfOption) {
            multipagePdfOption.hidden = selectFilledPages(this.record.document).length <= 1;
        }
    }

    _showCanvas() {
        this.root.querySelector('[data-state="loading"]').hidden = true;
        this.root.querySelector('[data-state="error"]').hidden = true;
        this.canvasShell.hidden = false;
    }

    _createCanvas() {
        this.canvasAdapter = new CanvasAdapter({
            Konva: this.runtime.Konva,
            container: this.container,
            onSelect: () => {},
            onCommit: () => {},
            assetLoader: (assetId) => this.repository.getAsset(assetId),
            onAssetError: () => this._notify('Часть изображений недоступна.', 'error'),
        });
        this.canvasAdapter.setInteractionEnabled(false);
        const stage = this.canvasAdapter.getStage();
        stage.container().style.cursor = 'grab';
        stage.on('wheel.viewerZoom', (event) => this._handleCanvasWheel(event));
        stage.on('mousedown.viewerPan touchstart.viewerPan', (event) => this._startCanvasPan(event));
        stage.on('mousemove.viewerPan touchmove.viewerPan', (event) => this._moveCanvasPan(event));
        stage.on('mouseup.viewerPan touchend.viewerPan', () => this._finishCanvasPan());
        window.addEventListener('mouseup', this.handlePanEnd);
        window.addEventListener('touchend', this.handlePanEnd);
        window.addEventListener('blur', this.handlePanEnd);
        this.resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => this._fitCanvas())
            : null;
        this.resizeObserver?.observe(this.canvasShell);
        if (!this.resizeObserver) {
            this.handleResize = () => this._fitCanvas();
            window.addEventListener('resize', this.handleResize);
        }
    }

    _getActivePage() {
        return this.record?.document.pages.find(({ id }) => id === this.activePageId)
            || this.record?.document.pages[0]
            || null;
    }

    _renderActivePage() {
        const page = this._getActivePage();
        if (!page || !this.canvasAdapter) {
            return;
        }
        this.activePageId = page.id;
        this.root.querySelector('[data-role="viewer-page-select"]').value = page.id;
        this.canvasAdapter.renderDocument(page);
        this.canvasAdapter.setInteractionEnabled(false);
        this._fitCanvas();
    }

    _fitCanvas() {
        const page = this._getActivePage();
        if (!page || !this.canvasAdapter || !this.canvasShell) {
            return;
        }
        const width = Math.max(this.canvasShell.clientWidth, 1);
        const height = Math.max(this.canvasShell.clientHeight, 1);
        const padding = Math.min(72, Math.max(28, Math.min(width, height) * 0.08));
        const scale = Math.max(0.1, Math.min(
            1,
            (width - padding * 2) / page.canvas.width,
            (height - padding * 2) / page.canvas.height,
        ));
        this.canvasAdapter.resize(width, height);
        this._applyViewport({
            scale,
            x: (width - page.canvas.width * scale) / 2,
            y: (height - page.canvas.height * scale) / 2,
        });
    }

    _handleCanvasWheel(event) {
        event.evt.preventDefault();
        const pointer = this.canvasAdapter?.getStage().getPointerPosition();
        if (!pointer) {
            return;
        }
        const direction = event.evt.deltaY > 0 ? -1 : 1;
        const requestedScale = this.viewport.scale * (direction > 0 ? VIEWER_ZOOM_STEP : 1 / VIEWER_ZOOM_STEP);
        this._applyViewport(resolveViewerZoomViewport(this.viewport, requestedScale, pointer));
    }

    _startCanvasPan(event) {
        const nativeEvent = event.evt;
        const isTouch = nativeEvent.type?.startsWith('touch');
        if (!isTouch && nativeEvent.button !== 0) {
            return;
        }
        const stage = this.canvasAdapter?.getStage();
        const pointer = stage?.getPointerPosition();
        if (!stage || !pointer) {
            return;
        }
        nativeEvent.preventDefault();
        event.cancelBubble = true;
        this.isPanning = true;
        this.lastPanPointer = { ...pointer };
        stage.container().style.cursor = 'grabbing';
    }

    _moveCanvasPan(event) {
        if (!this.isPanning || !this.lastPanPointer) {
            return;
        }
        const pointer = this.canvasAdapter?.getStage().getPointerPosition();
        if (!pointer) {
            return;
        }
        event.evt.preventDefault();
        this._applyViewport(resolveViewerPanViewport(this.viewport, {
            x: pointer.x - this.lastPanPointer.x,
            y: pointer.y - this.lastPanPointer.y,
        }));
        this.lastPanPointer = { ...pointer };
    }

    _finishCanvasPan() {
        this.isPanning = false;
        this.lastPanPointer = null;
        const stage = this.canvasAdapter?.getStage();
        if (stage) {
            stage.container().style.cursor = 'grab';
        }
    }

    _zoomAtCenter(requestedScale) {
        const stage = this.canvasAdapter?.getStage();
        if (!stage) {
            return;
        }
        this._applyViewport(resolveViewerZoomViewport(this.viewport, requestedScale, {
            x: stage.width() / 2,
            y: stage.height() / 2,
        }));
    }

    _applyViewport(viewport) {
        this.viewport = {
            scale: clampViewerScale(viewport.scale),
            x: Number(viewport.x) || 0,
            y: Number(viewport.y) || 0,
        };
        this.canvasAdapter?.setViewport(this.viewport);
        this._updateZoomControls();
    }

    _updateZoomControls() {
        const value = this.root?.querySelector('[data-role="viewer-zoom-value"]');
        if (value) {
            value.textContent = `${Math.round(this.viewport.scale * 100)}%`;
        }
        const zoomOut = this.root?.querySelector('[data-action="viewer-zoom-out"]');
        const zoomIn = this.root?.querySelector('[data-action="viewer-zoom-in"]');
        if (zoomOut) zoomOut.disabled = this.viewport.scale <= VIEWER_MIN_SCALE + Number.EPSILON;
        if (zoomIn) zoomIn.disabled = this.viewport.scale >= VIEWER_MAX_SCALE - Number.EPSILON;
    }

    async _export(format = 'png') {
        const normalizedFormat = String(format).toLowerCase();
        if (!['png', 'pdf', 'pdf-all'].includes(normalizedFormat) || !this.canvasAdapter) {
            return;
        }
        const page = this._getActivePage();
        const pixelRatio = 1;
        const controls = this.root.querySelectorAll('[data-viewer-control]');
        const exportTrigger = this.root.querySelector('[data-action="toggle-viewer-export"]');
        controls.forEach((control) => { control.disabled = true; });
        exportTrigger?.setAttribute('aria-busy', 'true');
        try {
            let blob;
            if (normalizedFormat === 'pdf-all') {
                const filledPages = selectFilledPages(this.record.document);
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
                    layout: this._createPdfPageLayout(page, exportResult.bounds),
                });
            } else {
                blob = await this.canvasAdapter.exportAsBlob({
                    pixelRatio,
                    waitForFonts: true,
                    includeBackground: false,
                });
            }
            const extension = normalizedFormat === 'pdf-all' ? 'pdf' : normalizedFormat;
            this._downloadBlob(blob, extension, normalizedFormat === 'pdf-all' ? null : page.name);
            this._notify(
                normalizedFormat === 'pdf-all'
                    ? 'Многостраничный PDF экспортирован.'
                    : `${normalizedFormat.toUpperCase()} экспортирован.`,
                'success',
            );
        } catch (error) {
            this._notify(error?.message || 'Не удалось экспортировать файл.', 'error');
        } finally {
            controls.forEach((control) => { control.disabled = false; });
            exportTrigger?.setAttribute('aria-busy', 'false');
            this._updateZoomControls();
        }
    }

    async _createMultipagePdf(pages, pixelRatio = 1) {
        const exportContainer = document.createElement('div');
        exportContainer.setAttribute('aria-hidden', 'true');
        const exportAdapter = new CanvasAdapter({
            Konva: this.runtime.Konva,
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

    _downloadBlob(blob, extension, pageName = null) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            const link = document.createElement('a');
            const safePart = (value, fallback, limit) => String(value || '')
                .normalize('NFKC')
                .replace(/[^a-zа-яё0-9_-]+/giu, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, limit) || fallback;
            link.href = objectUrl;
            const pageSuffix = pageName ? `-${safePart(pageName, 'page', 60)}` : '';
            link.download = `${safePart(this.record.title, 'moodboard', 80)}${pageSuffix}.${extension}`;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    _showError(message) {
        this.root.querySelector('[data-state="loading"]').hidden = true;
        this.canvasShell.hidden = true;
        const errorState = this.root.querySelector('[data-state="error"]');
        errorState.hidden = false;
        errorState.querySelector('[data-role="viewer-error-message"]').textContent = message;
        this.workspace?.setAttribute('aria-busy', 'false');
    }

    _notify(message, kind = 'success') {
        const notification = this.root.querySelector('[data-role="viewer-notification"]');
        notification.textContent = message;
        notification.dataset.kind = kind;
        notification.hidden = false;
        window.clearTimeout(this.notificationTimer);
        this.notificationTimer = window.setTimeout(() => {
            notification.hidden = true;
        }, 4200);
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.accessAbortController.abort();
        window.clearTimeout(this.notificationTimer);
        window.clearTimeout(this.exportCloseTimer);
        this.resizeObserver?.disconnect();
        if (!this.resizeObserver && this.handleResize) {
            window.removeEventListener('resize', this.handleResize);
        }
        window.removeEventListener('mouseup', this.handlePanEnd);
        window.removeEventListener('touchend', this.handlePanEnd);
        window.removeEventListener('blur', this.handlePanEnd);
        this.canvasAdapter?.getStage().off('.viewerZoom');
        this.canvasAdapter?.getStage().off('.viewerPan');
        this.canvasAdapter?.destroy();
        this.repository?.close?.();
    }
}

const runtime = typeof window === 'undefined' ? null : bootstrapPage('viewer');

if (runtime !== null) {
    const viewer = new PublicMoodboardViewer(runtime);
    void viewer.init();
}
