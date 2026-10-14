import {
    cloneValue,
    getMoodboardPage,
    validateMoodboardDocument,
} from '../models/moodboard-document.js';
import { HistoryManager } from './history-manager.js';
import { reconcileArrowBindings } from './arrow-binding-utils.js';

export class CommandManager {
    constructor(store, options = {}) {
        this.store = store;
        this.historyManager = options.historyManager || new HistoryManager(store, {
            limit: options.limit ?? 100,
        });
    }

    subscribe(listener) {
        return this.historyManager.subscribe(listener);
    }

    execute(label, mutator) {
        const activePageId = this.store.getActivePageId();
        return this.executeDocument(label, (document) => {
            const page = getMoodboardPage(document, activePageId);
            if (page) {
                mutator(page);
            }
        }, {
            pageIds: [activePageId],
            undoPageId: activePageId,
            redoPageId: activePageId,
        });
    }

    executeDocument(label, mutator, options = {}) {
        const before = this.store.getDocument();
        if (!before) {
            return false;
        }

        // `before` is already a validated clone returned by EditorStore. A plain
        // deep clone avoids an extra full-document validation before the mutator.
        const after = cloneValue(before);
        mutator(after);
        for (const page of after.pages) {
            reconcileArrowBindings(
                page.elements,
                getMoodboardPage(before, page.id)?.elements || page.elements,
            );
        }
        validateMoodboardDocument(after);

        if (JSON.stringify(before) === JSON.stringify(after)) {
            return false;
        }

        const pageIds = Array.isArray(options.pageIds)
            ? options.pageIds
            : [...new Set([
                ...before.pages.map(({ id }) => id),
                ...after.pages.map(({ id }) => id),
            ])].filter((pageId) => (
                JSON.stringify(getMoodboardPage(before, pageId))
                !== JSON.stringify(getMoodboardPage(after, pageId))
            ));

        this.store.replaceDocument(after, 'command');
        this.historyManager.record(label, before, after, {
            ...options,
            pageIds,
            assumeChanged: true,
        });
        return true;
    }

    undo() {
        return this.historyManager.undo();
    }

    redo() {
        return this.historyManager.redo();
    }

    discardLatest() {
        return this.historyManager.discardLatest();
    }

    clear() {
        this.historyManager.clear();
    }

    destroy() {
        this.historyManager.destroy?.();
    }

    getState() {
        return this.historyManager.getState();
    }

    get undoStack() {
        return this.historyManager.undoStack;
    }

    get redoStack() {
        return this.historyManager.redoStack;
    }
}
