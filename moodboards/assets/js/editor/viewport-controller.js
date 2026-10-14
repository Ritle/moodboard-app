const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.15;

export function shouldShowReturnToContent(
    contentRects,
    viewport,
    stageSize,
    screenInset = 32,
) {
    const rects = Array.isArray(contentRects)
        ? contentRects.filter((rect) => (
            rect
            && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
            && rect.width >= 0
            && rect.height >= 0
        ))
        : [];
    const scale = Number(viewport?.scale);
    const viewportX = Number(viewport?.x);
    const viewportY = Number(viewport?.y);
    const stageWidth = Number(stageSize?.width);
    const stageHeight = Number(stageSize?.height);
    if (
        rects.length === 0
        || !Number.isFinite(scale)
        || scale <= 0
        || !Number.isFinite(viewportX)
        || !Number.isFinite(viewportY)
        || !Number.isFinite(stageWidth)
        || !Number.isFinite(stageHeight)
        || stageWidth <= 1
        || stageHeight <= 1
    ) {
        return false;
    }

    const inset = Math.max(0, Math.min(
        Number(screenInset) || 0,
        stageWidth / 3,
        stageHeight / 3,
    ));
    const visibleWorldRect = {
        x: (inset - viewportX) / scale,
        y: (inset - viewportY) / scale,
        width: Math.max(0, stageWidth - inset * 2) / scale,
        height: Math.max(0, stageHeight - inset * 2) / scale,
    };
    const visibleRight = visibleWorldRect.x + visibleWorldRect.width;
    const visibleBottom = visibleWorldRect.y + visibleWorldRect.height;
    const hasVisibleContent = rects.some((rect) => (
        rect.x + rect.width >= visibleWorldRect.x
        && rect.y + rect.height >= visibleWorldRect.y
        && rect.x <= visibleRight
        && rect.y <= visibleBottom
    ));
    return !hasVisibleContent;
}

function isEditableTarget(target) {
    return target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        || Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'))
    );
}

export class ViewportController {
    constructor({ store, canvasAdapter, workspace }) {
        this.store = store;
        this.canvasAdapter = canvasAdapter;
        this.workspace = workspace;
        this.stage = canvasAdapter.getStage();
        this.canvasSize = { width: 1600, height: 1000 };
        this.spacePressed = false;
        this.handToolActive = false;
        this.drawingToolActive = false;
        this.isPanning = false;
        this.lastPointer = null;
        this.initialized = false;

        this.handleKeyDown = this._handleKeyDown.bind(this);
        this.handleKeyUp = this._handleKeyUp.bind(this);
        this.handleWindowBlur = this._handleWindowBlur.bind(this);
        this.handleWindowPointerUp = this._finishPan.bind(this);

        this.stage.on('wheel.viewport', (event) => this._handleWheel(event));
        this.stage.on('mousedown.viewport touchstart.viewport', (event) => this._startPan(event));
        this.stage.on('mousemove.viewport touchmove.viewport', (event) => this._movePan(event));
        this.stage.on('mouseup.viewport touchend.viewport', () => this._finishPan());
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('blur', this.handleWindowBlur);
        window.addEventListener('mouseup', this.handleWindowPointerUp);

        this.resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => this._handleResize())
            : null;
        this.resizeObserver?.observe(workspace);
        this.handleFallbackResize = () => this._handleResize();
        if (!this.resizeObserver) {
            window.addEventListener('resize', this.handleFallbackResize);
        }
    }

    initialize(canvas) {
        this.canvasSize = { width: canvas.width, height: canvas.height };
        this._handleResize();
        this.fit();
        this.initialized = true;
    }

    fit() {
        const stageWidth = this.stage.width();
        const stageHeight = this.stage.height();
        if (stageWidth <= 1 || stageHeight <= 1) {
            return;
        }

        const scene = this.canvasAdapter.getSceneBounds?.() || {
            x: 0,
            y: 0,
            width: this.canvasSize.width,
            height: this.canvasSize.height,
        };
        const padding = Math.min(72, Math.max(28, Math.min(stageWidth, stageHeight) * 0.08));
        const scale = Math.max(MIN_SCALE, Math.min(
            1,
            (stageWidth - padding * 2) / scene.width,
            (stageHeight - padding * 2) / scene.height,
        ));
        this._applyViewport({
            scale,
            x: stageWidth / 2 - (scene.x + scene.width / 2) * scale,
            y: stageHeight / 2 - (scene.y + scene.height / 2) * scale,
        });
    }

    zoomIn() {
        this._zoomAtStageCenter(this.store.getViewport().scale * ZOOM_STEP);
    }

    zoomOut() {
        this._zoomAtStageCenter(this.store.getViewport().scale / ZOOM_STEP);
    }

    setHandToolActive(active) {
        this.handToolActive = Boolean(active);
        if (!this.handToolActive) {
            this._finishPan();
        }
        this._syncInteractionAndCursor();
    }

    setDrawingToolActive(active) {
        this.drawingToolActive = Boolean(active);
        this._syncInteractionAndCursor();
    }

    setScale(scale) {
        const normalizedScale = Number(scale);
        if (Number.isFinite(normalizedScale)) {
            this._zoomAtStageCenter(normalizedScale);
        }
    }

    centerAtWorldPoint(x, y) {
        const worldX = Number(x);
        const worldY = Number(y);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            return false;
        }
        const viewport = this.store.getViewport();
        this._applyViewport({
            ...viewport,
            x: this.stage.width() / 2 - worldX * viewport.scale,
            y: this.stage.height() / 2 - worldY * viewport.scale,
        });
        return true;
    }

    focusContent() {
        const bounds = this.canvasAdapter.getContentBounds();
        return this._focusBounds(bounds, 1);
    }

    focusSelection() {
        return this._focusBounds(this.canvasAdapter.getSelectionBounds(), MAX_SCALE);
    }

    refresh() {
        this._handleResize();
    }

    _focusBounds(bounds, maximumScale) {
        if (!bounds) {
            return false;
        }
        const stageWidth = this.stage.width();
        const stageHeight = this.stage.height();
        if (stageWidth <= 1 || stageHeight <= 1) {
            return false;
        }
        const padding = Math.min(96, Math.max(36, Math.min(stageWidth, stageHeight) * 0.1));
        const scale = this._clampScale(Math.min(
            maximumScale,
            (stageWidth - padding * 2) / Math.max(bounds.width, 1),
            (stageHeight - padding * 2) / Math.max(bounds.height, 1),
        ));
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        this._applyViewport({
            scale,
            x: stageWidth / 2 - centerX * scale,
            y: stageHeight / 2 - centerY * scale,
        });
        return true;
    }

    shouldShowReturnToContent() {
        return shouldShowReturnToContent(
            this.canvasAdapter.getContentRects(),
            this.store.getViewport(),
            { width: this.stage.width(), height: this.stage.height() },
        );
    }

    getNavigatorState() {
        const scene = this.canvasAdapter.getSceneBounds?.() || {
            x: 0,
            y: 0,
            width: this.canvasSize.width,
            height: this.canvasSize.height,
        };
        return Object.freeze({
            canvas: { ...this.canvasSize },
            scene,
            stage: { width: this.stage.width(), height: this.stage.height() },
            viewport: this.store.getViewport(),
        });
    }

    destroy() {
        this.resizeObserver?.disconnect();
        if (!this.resizeObserver) {
            window.removeEventListener('resize', this.handleFallbackResize);
        }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('blur', this.handleWindowBlur);
        window.removeEventListener('mouseup', this.handleWindowPointerUp);
        this.stage.off('.viewport');
    }

    _handleResize() {
        const previousWidth = this.stage.width();
        const previousHeight = this.stage.height();
        const width = Math.max(this.workspace.clientWidth, 1);
        const height = Math.max(this.workspace.clientHeight, 1);
        const viewport = this.store.getViewport();

        this.canvasAdapter.resize(width, height);
        if (!this.initialized || previousWidth <= 1 || previousHeight <= 1) {
            return;
        }

        const worldCenter = {
            x: (previousWidth / 2 - viewport.x) / viewport.scale,
            y: (previousHeight / 2 - viewport.y) / viewport.scale,
        };
        this._applyViewport({
            scale: viewport.scale,
            x: width / 2 - worldCenter.x * viewport.scale,
            y: height / 2 - worldCenter.y * viewport.scale,
        });
    }

    _handleWheel(event) {
        event.evt.preventDefault();
        const pointer = this.stage.getPointerPosition();
        if (!pointer) {
            return;
        }
        const viewport = this.store.getViewport();
        const direction = event.evt.deltaY > 0 ? -1 : 1;
        const scale = this._clampScale(viewport.scale * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
        const worldPoint = {
            x: (pointer.x - viewport.x) / viewport.scale,
            y: (pointer.y - viewport.y) / viewport.scale,
        };
        this._applyViewport({
            scale,
            x: pointer.x - worldPoint.x * scale,
            y: pointer.y - worldPoint.y * scale,
        });
    }

    _zoomAtStageCenter(requestedScale) {
        const viewport = this.store.getViewport();
        const center = { x: this.stage.width() / 2, y: this.stage.height() / 2 };
        const worldPoint = {
            x: (center.x - viewport.x) / viewport.scale,
            y: (center.y - viewport.y) / viewport.scale,
        };
        const scale = this._clampScale(requestedScale);
        this._applyViewport({
            scale,
            x: center.x - worldPoint.x * scale,
            y: center.y - worldPoint.y * scale,
        });
    }

    _startPan(event) {
        const nativeEvent = event.evt;
        const isTouch = nativeEvent.type?.startsWith('touch');
        const isMiddleMouse = nativeEvent.button === 1;
        const isPrimaryHand = this.handToolActive && (isTouch || nativeEvent.button === 0);
        const isSpacePan = this.spacePressed && (isTouch || nativeEvent.button === 0);
        if (!isMiddleMouse && !isPrimaryHand && !isSpacePan) {
            return;
        }
        const pointer = this.stage.getPointerPosition();
        if (!pointer) {
            return;
        }
        nativeEvent.preventDefault();
        event.cancelBubble = true;
        this.isPanning = true;
        this.lastPointer = pointer;
        this._syncInteractionAndCursor();
    }

    _movePan(event) {
        if (!this.isPanning) {
            return;
        }
        event.evt.preventDefault();
        const pointer = this.stage.getPointerPosition();
        if (!pointer) {
            return;
        }
        const viewport = this.store.getViewport();
        this._applyViewport({
            ...viewport,
            x: viewport.x + pointer.x - this.lastPointer.x,
            y: viewport.y + pointer.y - this.lastPointer.y,
        });
        this.lastPointer = pointer;
    }

    _finishPan() {
        this.isPanning = false;
        this.lastPointer = null;
        this._syncInteractionAndCursor();
    }

    _handleKeyDown(event) {
        if (event.code !== 'Space' || isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault();
        if (this.spacePressed) {
            return;
        }
        this.spacePressed = true;
        this._syncInteractionAndCursor();
    }

    _handleKeyUp(event) {
        if (event.code !== 'Space') {
            return;
        }
        this.spacePressed = false;
        this._finishPan();
    }

    _handleWindowBlur() {
        if (!this.spacePressed) {
            return;
        }
        this.spacePressed = false;
        this._finishPan();
    }

    _applyViewport(viewport) {
        this.canvasAdapter.setViewport(viewport);
        this.store.setViewport(viewport);
    }

    _clampScale(scale) {
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    }

    _syncInteractionAndCursor() {
        const navigationActive = this.spacePressed || this.handToolActive || this.isPanning;
        this.canvasAdapter.setInteractionEnabled(!navigationActive && !this.drawingToolActive);
        this.canvasAdapter.setBrushSuspended(navigationActive);
        this.stage.container().style.cursor = this.isPanning
            ? 'grabbing'
            : (this.spacePressed || this.handToolActive
                ? 'grab'
                : (this.drawingToolActive ? 'crosshair' : 'default'));
    }
}
