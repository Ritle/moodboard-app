import {
    cloneMoodboardDocument,
    cloneMoodboardPage,
    cloneValue,
    getMoodboardPage,
    validateMoodboardDocument,
} from '../models/moodboard-document.js';

const DEFAULT_UI_STATE = Object.freeze({
    selectedElementId: null,
    selectedElementIds: Object.freeze([]),
    activePageId: null,
    saveStatus: 'loading',
    viewport: Object.freeze({ scale: 1, x: 0, y: 0 }),
});

export class EditorStore {
    constructor() {
        this.moodboardId = null;
        this.title = 'Новый проект 1';
        this.revision = 0;
        this.document = null;
        this.uiState = cloneValue(DEFAULT_UI_STATE);
        this.listeners = new Set();
    }

    subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Подписчик EditorStore должен быть функцией.');
        }
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    loadMoodboard(record) {
        if (!record || typeof record !== 'object') {
            throw new TypeError('Запись MoodBoard должна быть объектом.');
        }
        validateMoodboardDocument(record.document);

        this.moodboardId = record.id;
        this.title = record.title;
        this.revision = record.revision;
        this.document = cloneMoodboardDocument(record.document);
        this.uiState = cloneValue(DEFAULT_UI_STATE);
        this.uiState.activePageId = this.document.pages[0].id;
        this._emit({ kind: 'moodboard-loaded' });
    }

    getDocument() {
        return this.document ? cloneMoodboardDocument(this.document) : null;
    }

    getCanvas() {
        return this.getActivePage()?.canvas || null;
    }

    getActivePage() {
        const page = getMoodboardPage(this.document, this.uiState.activePageId);
        return page ? cloneMoodboardPage(page) : null;
    }

    getActivePageId() {
        return this.uiState.activePageId;
    }

    getPages() {
        return this.document
            ? this.document.pages.map(({ id, name }) => Object.freeze({ id, name }))
            : [];
    }

    getElement(elementId) {
        const page = getMoodboardPage(this.document, this.uiState.activePageId);
        const element = page?.elements.find(({ id }) => id === elementId);
        return element ? cloneValue(element) : null;
    }

    replaceDocument(document, source = 'external') {
        validateMoodboardDocument(document);
        const previousPageId = this.uiState.activePageId;
        this.document = cloneMoodboardDocument(document);
        if (!getMoodboardPage(this.document, previousPageId)) {
            this.uiState.activePageId = this.document.pages[0].id;
        }
        const activePage = getMoodboardPage(this.document, this.uiState.activePageId);

        if (
            this.uiState.selectedElementId
            && !activePage.elements.some(({ id }) => id === this.uiState.selectedElementId)
        ) {
            this.uiState.selectedElementId = null;
        }
        this.uiState.selectedElementIds = (this.uiState.selectedElementIds || []).filter(
            (elementId) => activePage.elements.some(({ id }) => id === elementId),
        );
        this.uiState.selectedElementId = this.uiState.selectedElementIds.length === 1
            ? this.uiState.selectedElementIds[0]
            : null;

        this._emit({ kind: 'document-changed', source });
        if (previousPageId !== this.uiState.activePageId) {
            this._emit({ kind: 'page-changed', pageId: this.uiState.activePageId });
        }
    }

    setRevision(revision) {
        if (!Number.isInteger(revision) || revision < 0) {
            throw new TypeError('Ревизия должна быть неотрицательным целым числом.');
        }
        this.revision = revision;
        this._emit({ kind: 'revision-changed' });
    }

    setTitle(title) {
        if (typeof title !== 'string' || title.trim() === '' || title.trim().length > 160) {
            throw new TypeError('Название должно содержать от 1 до 160 символов.');
        }
        const normalizedTitle = title.trim();
        if (this.title === normalizedTitle) {
            return;
        }
        this.title = normalizedTitle;
        this._emit({ kind: 'title-changed', title: normalizedTitle });
    }

    setSelection(elementId) {
        return this.setSelections(elementId === null ? [] : [elementId]);
    }

    setSelections(elementIds = []) {
        const activePage = getMoodboardPage(this.document, this.uiState.activePageId);
        const availableIds = new Set(activePage?.elements.map(({ id }) => id) || []);
        const requestedIds = Array.isArray(elementIds) ? elementIds : [];
        const nextIds = [...new Set(requestedIds.map(String))].filter((id) => availableIds.has(id));
        if (
            nextIds.length === this.uiState.selectedElementIds.length
            && nextIds.every((id, index) => id === this.uiState.selectedElementIds[index])
        ) {
            return false;
        }
        this.uiState.selectedElementIds = nextIds;
        this.uiState.selectedElementId = nextIds.length === 1 ? nextIds[0] : null;
        this._emit({
            kind: 'selection-changed',
            elementId: this.uiState.selectedElementId,
            elementIds: cloneValue(nextIds),
        });
        return true;
    }

    getSelectedElementId() {
        return this.uiState.selectedElementId;
    }

    getSelectedElementIds() {
        return cloneValue(this.uiState.selectedElementIds);
    }

    setActivePage(pageId) {
        const nextPageId = String(pageId || '');
        if (!getMoodboardPage(this.document, nextPageId) || this.uiState.activePageId === nextPageId) {
            return false;
        }
        this.uiState.activePageId = nextPageId;
        this.uiState.selectedElementId = null;
        this.uiState.selectedElementIds = [];
        this._emit({ kind: 'page-changed', pageId: nextPageId });
        return true;
    }

    setViewport(viewport) {
        const nextViewport = {
            scale: Number(viewport.scale),
            x: Number(viewport.x),
            y: Number(viewport.y),
        };
        if (!Object.values(nextViewport).every(Number.isFinite) || nextViewport.scale <= 0) {
            throw new TypeError('Некорректное состояние viewport.');
        }
        this.uiState.viewport = nextViewport;
        this._emit({ kind: 'viewport-changed', viewport: cloneValue(nextViewport) });
    }

    getViewport() {
        return cloneValue(this.uiState.viewport);
    }

    setSaveStatus(saveStatus, message = '') {
        this.uiState.saveStatus = saveStatus;
        this._emit({ kind: 'save-status-changed', saveStatus, message });
    }

    getSnapshot() {
        return Object.freeze({
            moodboardId: this.moodboardId,
            title: this.title,
            revision: this.revision,
            document: this.getDocument(),
            uiState: cloneValue(this.uiState),
        });
    }

    getUiSnapshot() {
        return Object.freeze({
            moodboardId: this.moodboardId,
            title: this.title,
            revision: this.revision,
            uiState: cloneValue(this.uiState),
        });
    }

    _emit(event) {
        const payload = Object.freeze({ ...event, store: this });
        for (const listener of this.listeners) {
            listener(payload);
        }
    }
}
