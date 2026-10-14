const DEFAULT_PREVIEW_PIXEL_RATIO = 0.3;
const DEFAULT_PREVIEW_ASPECT_RATIO = 16 / 10;

export function pageHasPreviewContent(page) {
    if (!Array.isArray(page?.elements)) {
        return false;
    }
    return page.elements.some((element) => (
        element
        && (element.type !== 'text' || String(element.text || '').trim() !== '')
    ));
}

export function selectFilledPages(document) {
    const pages = Array.isArray(document?.pages) ? document.pages : [];
    return pages.filter(pageHasPreviewContent);
}

export function selectPreviewPage(document, preferredPageId = null) {
    const pages = Array.isArray(document?.pages) ? document.pages : [];
    const preferredPage = pages.find(({ id }) => id === preferredPageId);
    if (pageHasPreviewContent(preferredPage)) {
        return preferredPage;
    }
    return pages.find(pageHasPreviewContent) || null;
}

export class PreviewManager {
    constructor({
        store,
        repository,
        canvasAdapter,
        pixelRatio = DEFAULT_PREVIEW_PIXEL_RATIO,
        aspectRatio = DEFAULT_PREVIEW_ASPECT_RATIO,
        maxWidth = 480,
        maxHeight = 300,
        onError = () => {},
    }) {
        this.store = store;
        this.repository = repository;
        this.canvasAdapter = canvasAdapter;
        this.pixelRatio = pixelRatio;
        this.aspectRatio = Number.isFinite(Number(aspectRatio)) && Number(aspectRatio) > 0
            ? Number(aspectRatio)
            : DEFAULT_PREVIEW_ASPECT_RATIO;
        this.maxWidth = Number.isFinite(Number(maxWidth)) && Number(maxWidth) > 0 ? Number(maxWidth) : 480;
        this.maxHeight = Number.isFinite(Number(maxHeight)) && Number(maxHeight) > 0 ? Number(maxHeight) : 300;
        this.onError = onError;
        this.pending = false;
        this.pendingRequest = null;
        this.inFlightPromise = null;
        this.destroyed = false;
    }

    generate({ document = null, revision = null } = {}) {
        if (this.destroyed || !this.store.moodboardId) {
            return Promise.resolve(false);
        }
        this.pending = true;
        this.pendingRequest = { document, revision };
        if (!this.inFlightPromise) {
            this.inFlightPromise = this._drain();
        }
        return this.inFlightPromise;
    }

    async destroy() {
        this.pending = false;
        this.pendingRequest = null;
        await this.inFlightPromise;
        this.destroyed = true;
    }

    async _drain() {
        let completed = false;
        try {
            while (this.pending && !this.destroyed) {
                this.pending = false;
                const request = this.pendingRequest;
                this.pendingRequest = null;
                const moodboardId = this.store.moodboardId;
                try {
                    const documentSnapshot = request?.document || this.store.getDocument();
                    const previewPage = selectPreviewPage(
                        documentSnapshot,
                        this.store.getActivePageId?.() || null,
                    );
                    let blob = null;
                    if (previewPage) {
                        this.canvasAdapter.renderDocument(previewPage);
                        blob = await this.canvasAdapter.exportAsBlob({
                            pixelRatio: this.pixelRatio,
                            waitForFonts: true,
                            includeBackground: true,
                            targetAspectRatio: this.aspectRatio,
                            maxWidth: this.maxWidth,
                            maxHeight: this.maxHeight,
                        });
                    }
                    const documentStillMatches = !request?.document
                        || JSON.stringify(this.store.getDocument()) === JSON.stringify(request.document);
                    const revisionStillMatches = request?.revision === null
                        || this.store.revision === request.revision;
                    if (
                        !this.destroyed
                        && moodboardId === this.store.moodboardId
                        && documentStillMatches
                        && revisionStillMatches
                    ) {
                        await this.repository.savePreview(moodboardId, blob);
                        completed = true;
                    }
                } catch (error) {
                    try {
                        this.onError(error);
                    } catch (_) {
                        // Ошибка обработчика не должна останавливать будущую генерацию preview.
                    }
                }
            }
            return completed;
        } finally {
            this.inFlightPromise = null;
        }
    }
}
