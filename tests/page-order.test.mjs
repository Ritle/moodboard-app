import assert from 'node:assert/strict';

import { CommandManager } from '../assets/js/editor/command-manager.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';
import { createMoodboardDocument, createMoodboardPage } from '../assets/js/models/moodboard-document.js';
import { reorderPages } from '../assets/js/editor/page-order-utils.js';

const pages = [{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'four' }];
const ids = (items) => items?.map(({ id }) => id);

assert.deepEqual(ids(reorderPages(pages, 'one', 'three', 'after')), ['two', 'three', 'one', 'four']);
assert.deepEqual(ids(reorderPages(pages, 'four', 'two', 'before')), ['one', 'four', 'two', 'three']);
assert.equal(reorderPages(pages, 'two', 'three', 'before'), null);
assert.equal(reorderPages(pages, 'missing', 'two', 'before'), null);
assert.equal(reorderPages(pages, 'one', 'one', 'after'), null);
assert.deepEqual(ids(pages), ['one', 'two', 'three', 'four']);

const store = new EditorStore();
store.loadMoodboard({
    id: 'board-1',
    title: 'Board',
    revision: 1,
    document: createMoodboardDocument({
        pages: pages.map(({ id }, index) => createMoodboardPage({
            id,
            name: `Page ${index + 1}`,
        })),
    }),
});
const commands = new CommandManager(store);
const reordered = reorderPages(store.getDocument().pages, 'one', 'three', 'after');
assert.equal(commands.executeDocument('Изменение порядка листов', (document) => {
    document.pages = reordered;
}, {
    pageIds: pages.map(({ id }) => id),
    undoPageId: 'one',
    redoPageId: 'one',
    restorePageOrder: true,
}), true);
assert.deepEqual(ids(store.getDocument().pages), ['two', 'three', 'one', 'four']);
assert.equal(commands.undo(), true);
assert.deepEqual(ids(store.getDocument().pages), ['one', 'two', 'three', 'four']);
assert.equal(commands.redo(), true);
assert.deepEqual(ids(store.getDocument().pages), ['two', 'three', 'one', 'four']);
commands.destroy();

console.log('page order: PASS');
