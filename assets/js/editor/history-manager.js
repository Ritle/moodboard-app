import {
    cloneMoodboardDocument,
    cloneValue,
    getMoodboardPage,
    validateMoodboardDocument,
} from '../models/moodboard-document.js';

const DEFAULT_HISTORY_LIMIT = 100;

function pageState(document, pageId) {
    const index = document.pages.findIndex(({ id }) => id === pageId);
    return Object.freeze({
        index,
        page: index === -1 ? null : cloneValue(document.pages[index]),
    });
}

export class HistoryManager {
    constructor(store, options = {}) {
        this.store = store;
        this.limit = Number.isInteger(options.limit) && options.limit > 0
            ? options.limit
            : DEFAULT_HISTORY_LIMIT;
        this.histories = new Map();
        this.listeners = new Set();
        this.operationSequence = 0;
        this.unsubscribeStore = this.store.subscribe((event) => {
            if (event.kind === 'moodboard-loaded') {
                this.histories.clear();
            }
            if (['moodboard-loaded', 'page-changed'].includes(event.kind)) {
                this._emit();
            }
        });
    }

    subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('Подписчик HistoryManager должен быть функцией.');
        }
        this.listeners.add(listener);
        listener(this.getState());
        return () => this.listeners.delete(listener);
    }

    record(label, beforeDocument, afterDocument, options = {}) {
        validateMoodboardDocument(beforeDocument);
        validateMoodboardDocument(afterDocument);
        // The manager only reads these documents and stores cloned page states,
        // so cloning both complete scenes here would only multiply command cost.
        const normalizedBefore = beforeDocument;
        const normalizedAfter = afterDocument;
        if (
            options.assumeChanged !== true
            && JSON.stringify(normalizedBefore) === JSON.stringify(normalizedAfter)
        ) {
            return false;
        }

        const pageIds = Array.isArray(options.pageIds)
            ? options.pageIds
            : [...new Set([
                ...normalizedBefore.pages.map(({ id }) => id),
                ...normalizedAfter.pages.map(({ id }) => id),
            ])].filter((pageId) => (
                JSON.stringify(getMoodboardPage(normalizedBefore, pageId))
                !== JSON.stringify(getMoodboardPage(normalizedAfter, pageId))
            ));
        const changedPageIds = this._normalizePageIds(pageIds);
        if (changedPageIds.length === 0) {
            return false;
        }
        const undoPageId = String(options.undoPageId || this.store.getActivePageId() || changedPageIds[0]);
        const redoPageId = String(options.redoPageId || undoPageId);
        const undoStackPageIds = this._normalizePageIds([
            ...changedPageIds.filter((pageId) => getMoodboardPage(normalizedAfter, pageId)),
            redoPageId,
        ]);
        const redoStackPageIds = this._normalizePageIds([
            ...changedPageIds.filter((pageId) => getMoodboardPage(normalizedBefore, pageId)),
            undoPageId,
        ]);
        const operation = Object.freeze({
            id: ++this.operationSequence,
            label: String(label || 'Изменение документа'),
            changedPageIds: Object.freeze(changedPageIds),
            undoStackPageIds: Object.freeze(undoStackPageIds),
            redoStackPageIds: Object.freeze(redoStackPageIds),
            undoPageId,
            redoPageId,
            restorePageOrder: options.restorePageOrder === true,
            before: Object.freeze(Object.fromEntries(
                changedPageIds.map((pageId) => [pageId, pageState(normalizedBefore, pageId)]),
            )),
            after: Object.freeze(Object.fromEntries(
                changedPageIds.map((pageId) => [pageId, pageState(normalizedAfter, pageId)]),
            )),
        });

        this._discardRedoEntries(undoStackPageIds);
        for (const pageId of undoStackPageIds) {
            this._getHistory(pageId).undo.push(operation);
        }
        this._enforceLimit(undoStackPageIds);
        this._emit();
        return true;
    }

    undo() {
        const history = this._getActiveHistory();
        const operation = history?.undo.at(-1);
        if (!operation || !this._isOperationTop(operation, 'undo')) {
            return false;
        }
        this._removeOperation(operation, 'undo');
        if (!this._apply(operation, 'before', operation.undoPageId)) {
            for (const pageId of operation.undoStackPageIds) {
                this._getHistory(pageId).undo.push(operation);
            }
            this._emit();
            return false;
        }
        for (const pageId of operation.redoStackPageIds) {
            this._getHistory(pageId).redo.push(operation);
        }
        this._emit();
        return true;
    }

    redo() {
        const history = this._getActiveHistory();
        const operation = history?.redo.at(-1);
        if (!operation || !this._isOperationTop(operation, 'redo')) {
            return false;
        }
        this._removeOperation(operation, 'redo');
        if (!this._apply(operation, 'after', operation.redoPageId)) {
            for (const pageId of operation.redoStackPageIds) {
                this._getHistory(pageId).redo.push(operation);
            }
            this._emit();
            return false;
        }
        for (const pageId of operation.undoStackPageIds) {
            this._getHistory(pageId).undo.push(operation);
        }
        this._emit();
        return true;
    }

    discardLatest() {
        const history = this._getActiveHistory();
        const operation = history?.undo.at(-1);
        if (!operation || !this._isOperationTop(operation, 'undo')) {
            return false;
        }
        this._removeOperation(operation, 'undo');
        if (!this._apply(operation, 'before', operation.undoPageId)) {
            for (const pageId of operation.undoStackPageIds) {
                this._getHistory(pageId).undo.push(operation);
            }
            this._emit();
            return false;
        }
        this._emit();
        return true;
    }

    clear() {
        if (this.histories.size === 0) {
            return;
        }
        this.histories.clear();
        this._emit();
    }

    getState() {
        const history = this._getActiveHistory();
        const undoOperation = history?.undo.at(-1) || null;
        const redoOperation = history?.redo.at(-1) || null;
        const canUndo = Boolean(undoOperation && this._isOperationTop(undoOperation, 'undo'));
        const canRedo = Boolean(redoOperation && this._isOperationTop(redoOperation, 'redo'));
        return Object.freeze({
            canUndo,
            canRedo,
            undoBlocked: Boolean(undoOperation && !canUndo),
            redoBlocked: Boolean(redoOperation && !canRedo),
            undoLabel: canUndo ? undoOperation.label : '',
            redoLabel: canRedo ? redoOperation.label : '',
            undoCount: history?.undo.length || 0,
            redoCount: history?.redo.length || 0,
            limit: this.limit,
            pageId: this.store.getActivePageId(),
        });
    }

    get undoStack() {
        return this._getActiveHistory()?.undo || [];
    }

    get redoStack() {
        return this._getActiveHistory()?.redo || [];
    }

    destroy() {
        this.unsubscribeStore?.();
        this.listeners.clear();
        this.histories.clear();
    }

    _getHistory(pageId, create = true) {
        const key = String(pageId || '');
        if (!key) {
            return null;
        }
        if (!this.histories.has(key) && create) {
            this.histories.set(key, { undo: [], redo: [] });
        }
        return this.histories.get(key) || null;
    }

    _getActiveHistory() {
        return this._getHistory(this.store.getActivePageId(), false);
    }

    _normalizePageIds(pageIds) {
        return [...new Set((Array.isArray(pageIds) ? pageIds : [])
            .map((pageId) => String(pageId || ''))
            .filter(Boolean))];
    }

    _isOperationTop(operation, stackName) {
        const pageIds = stackName === 'undo'
            ? operation.undoStackPageIds
            : operation.redoStackPageIds;
        return pageIds.every((pageId) => (
            this._getHistory(pageId, false)?.[stackName].at(-1) === operation
        ));
    }

    _removeOperation(operation, stackName) {
        const pageIds = stackName === 'undo'
            ? operation.undoStackPageIds
            : operation.redoStackPageIds;
        for (const pageId of pageIds) {
            const stack = this._getHistory(pageId, false)?.[stackName];
            if (!stack) {
                continue;
            }
            const index = stack.lastIndexOf(operation);
            if (index !== -1) {
                stack.splice(index, 1);
            }
        }
    }

    _discardRedoEntries(pageIds) {
        const discarded = new Set();
        for (const pageId of pageIds) {
            for (const operation of this._getHistory(pageId, false)?.redo || []) {
                discarded.add(operation);
            }
        }
        for (const operation of discarded) {
            this._removeOperation(operation, 'redo');
        }
    }

    _enforceLimit(pageIds) {
        const discarded = new Set();
        for (const pageId of pageIds) {
            const undo = this._getHistory(pageId).undo;
            while (undo.length > this.limit) {
                discarded.add(undo.shift());
            }
        }
        for (const operation of discarded) {
            this._removeOperation(operation, 'undo');
        }
    }

    _apply(operation, stateName, preferredPageId) {
        const current = this.store.getDocument();
        if (!current) {
            return false;
        }
        const next = cloneMoodboardDocument(current);
        const currentIndexes = new Map(operation.changedPageIds.map((pageId) => [
            pageId,
            next.pages.findIndex(({ id }) => id === pageId),
        ]));
        for (const pageId of operation.changedPageIds) {
            const index = next.pages.findIndex(({ id }) => id === pageId);
            if (index !== -1) {
                next.pages.splice(index, 1);
            }
        }
        const insertions = operation.changedPageIds
            .map((pageId) => {
                const state = operation[stateName][pageId];
                const currentIndex = currentIndexes.get(pageId);
                return !operation.restorePageOrder && currentIndex >= 0 && state.page
                    ? { ...state, index: currentIndex }
                    : state;
            })
            .filter(({ page }) => page)
            .sort((left, right) => left.index - right.index);
        for (const state of insertions) {
            next.pages.splice(Math.min(Math.max(state.index, 0), next.pages.length), 0, cloneValue(state.page));
        }
        try {
            validateMoodboardDocument(next);
            this.store.replaceDocument(next, stateName === 'before' ? 'undo' : 'redo');
            if (getMoodboardPage(next, preferredPageId)) {
                this.store.setActivePage(preferredPageId);
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    _emit() {
        const state = this.getState();
        for (const listener of this.listeners) {
            listener(state);
        }
    }
}
