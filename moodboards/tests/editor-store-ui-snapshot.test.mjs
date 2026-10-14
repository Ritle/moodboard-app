import assert from 'node:assert/strict';

import { EditorStore } from '../assets/js/editor/editor-store.js';
import { createMoodboardDocument } from '../assets/js/models/moodboard-document.js';

const store = new EditorStore();
store.loadMoodboard({
    id: 'board-1',
    title: 'Performance board',
    revision: 7,
    document: createMoodboardDocument(),
});

const snapshot = store.getUiSnapshot();
assert.equal(snapshot.title, 'Performance board');
assert.equal(snapshot.revision, 7);
assert.equal(Object.hasOwn(snapshot, 'document'), false);
assert.notEqual(snapshot.uiState, store.uiState);

snapshot.uiState.viewport.x = 200;
assert.equal(store.getViewport().x, 0);

console.log('editor store UI snapshot: PASS');
