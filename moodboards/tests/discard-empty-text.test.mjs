import assert from 'node:assert/strict';

import { CommandManager } from '../assets/js/editor/command-manager.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';
import { createMoodboardDocument } from '../assets/js/models/moodboard-document.js';

const store = new EditorStore();
store.loadMoodboard({
    id: 'board-1',
    title: 'Test board',
    revision: 1,
    document: createMoodboardDocument({ pageId: 'page-1', pageName: 'Page 1' }),
});
const commands = new CommandManager(store);

assert.equal(commands.execute('Добавление текста', (page) => {
    page.elements.push({
        id: 'text-1',
        type: 'text',
        x: 10,
        y: 20,
        width: 180,
        height: 40,
        rotation: 0,
        text: '',
        fill: '#282828',
        fontSize: 24,
        fontFamily: 'Roboto',
        fontStyle: 'normal',
        align: 'left',
        opacity: 1,
    });
}), true);
assert.equal(store.getActivePage().elements.length, 1);
assert.equal(commands.getState().undoCount, 1);

assert.equal(commands.discardLatest(), true);
assert.equal(store.getActivePage().elements.length, 0);
assert.equal(commands.getState().undoCount, 0);
assert.equal(commands.getState().redoCount, 0);

assert.equal(commands.execute('Добавление текста', (page) => {
    page.elements.push({
        id: 'text-2',
        type: 'text',
        x: 10,
        y: 20,
        width: 180,
        height: 40,
        rotation: 0,
        text: '',
        fill: '#282828',
        fontSize: 24,
        fontFamily: 'Roboto',
        fontStyle: 'normal',
        align: 'left',
        opacity: 1,
    });
}), true);
const draft = store.getElement('text-2');
assert.equal(commands.discardLatest(), true);
assert.equal(commands.execute('Добавление текста', (page) => {
    page.elements.push({ ...draft, text: 'Готовый текст' });
}), true);
assert.equal(commands.getState().undoCount, 1);
assert.equal(store.getElement('text-2').text, 'Готовый текст');
assert.equal(commands.undo(), true);
assert.equal(store.getElement('text-2'), null);

commands.destroy();
console.log('empty text history discard: PASS');
