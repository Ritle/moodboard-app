import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AutosaveManager } from '../assets/js/editor/autosave-manager.js';
import { protectBeforeUnload } from '../assets/js/editor/editor-app.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';
import {
    LocalStorageRecoveryDraftRepository,
    isRecoveryDraftApplicable,
} from '../assets/js/editor/recovery-draft-repository.js';
import { createMoodboardDocument } from '../assets/js/models/moodboard-document.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

const storage = new MemoryStorage();
const drafts = new LocalStorageRecoveryDraftRepository({ storage, namespace: 'recovery-test' });
const stableDocument = createMoodboardDocument();
const changedDocument = createMoodboardDocument({
    elements: [{
        id: 'text-1',
        type: 'text',
        x: 10,
        y: 20,
        width: 240,
        height: 80,
        rotation: 0,
        text: 'Несохранённый текст',
        fill: '#282828',
        fontSize: 32,
        fontFamily: 'Roboto',
        fontStyle: 'normal',
        align: 'left',
        opacity: 1,
    }],
});

drafts.save({
    moodboardId: 'board-1',
    document: changedDocument,
    baseRevision: 3,
    changeVersion: 1,
});
const loadedDraft = drafts.load('board-1');
assert.notEqual(loadedDraft.document, changedDocument);
assert.equal(isRecoveryDraftApplicable(loadedDraft, {
    id: 'board-1',
    revision: 3,
    document: stableDocument,
}), true);
assert.equal(isRecoveryDraftApplicable(loadedDraft, {
    id: 'board-1',
    revision: 4,
    document: stableDocument,
}), false, 'Черновик предыдущей ревизии не должен перекрывать уже сохранённую запись.');

drafts.remove('board-1');
assert.equal(drafts.load('board-1'), null);
storage.setItem('recovery-test:recovery-draft:v1:board-1', '{broken json');
assert.equal(drafts.load('board-1'), null);
assert.equal(storage.values.size, 0, 'Повреждённый черновик должен удаляться автоматически.');

const unavailableDrafts = new LocalStorageRecoveryDraftRepository({
    storage: null,
    namespace: 'unavailable-test',
});
assert.equal(unavailableDrafts.load('board-1'), null);
assert.throws(() => unavailableDrafts.save({
    moodboardId: 'board-1',
    document: changedDocument,
    baseRevision: 3,
}), /localStorage недоступен/);

const store = new EditorStore();
store.loadMoodboard({
    id: 'board-2',
    title: 'Recovery board',
    revision: 0,
    document: stableDocument,
});
store.replaceDocument(changedDocument, 'test');

let finishIndexedDbWrite;
const repository = {
    saveContent(id, document, revision) {
        return new Promise((resolve) => {
            finishIndexedDbWrite = () => resolve({ id, document, revision: revision + 1 });
        });
    },
};
const draftCalls = [];
const draftRepository = {
    save(draft) {
        draftCalls.push({ type: 'save', draft });
    },
    remove(moodboardId) {
        draftCalls.push({ type: 'remove', moodboardId });
    },
};
const autosave = new AutosaveManager({ store, repository, draftRepository });
autosave.markChanged();
assert.equal(draftCalls[0].type, 'save');
assert.equal(draftCalls[0].draft.baseRevision, 0);

const flushing = autosave.flush();
assert.equal(autosave.getState().saving, true);
const event = {
    prevented: false,
    returnValue: undefined,
    preventDefault() {
        this.prevented = true;
    },
};
assert.equal(protectBeforeUnload(event, autosave.getState()), true);
assert.equal(event.prevented, true);
assert.equal(event.returnValue, '');

finishIndexedDbWrite();
assert.equal(await flushing, true);
assert.equal(draftCalls.at(-1).type, 'remove');
assert.equal(autosave.getState().saving, false);
assert.equal(protectBeforeUnload({}, autosave.getState()), false);
await autosave.destroy({ flush: false });

const raceStore = new EditorStore();
raceStore.loadMoodboard({
    id: 'board-race',
    title: 'Recovery race',
    revision: 0,
    document: stableDocument,
});
raceStore.replaceDocument(changedDocument, 'test');
const raceResolvers = [];
const raceDrafts = [];
const raceAutosave = new AutosaveManager({
    store: raceStore,
    repository: {
        saveContent(id, document, revision) {
            return new Promise((resolve) => {
                raceResolvers.push(() => resolve({ id, document, revision: revision + 1 }));
            });
        },
    },
    draftRepository: {
        save(draft) {
            raceDrafts.push(draft);
        },
        remove() {},
    },
});
raceAutosave.markChanged();
const raceFlush = raceAutosave.flush();
const latestDocument = structuredClone(changedDocument);
latestDocument.pages[0].elements[0].text = 'Более новое изменение';
raceStore.replaceDocument(latestDocument, 'test');
raceAutosave.markChanged();
raceResolvers[0]();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(raceDrafts.at(-1).baseRevision, 1);
assert.equal(raceDrafts.at(-1).document.pages[0].elements[0].text, 'Более новое изменение');
raceResolvers[1]();
assert.equal(await raceFlush, true);
await raceAutosave.destroy({ flush: false });

const failedDraftCalls = [];
const failedAutosave = new AutosaveManager({
    store,
    repository: {
        async saveContent() {
            const error = new Error('IndexedDB write failed');
            error.code = 'REVISION_CONFLICT';
            throw error;
        },
    },
    draftRepository: {
        save(draft) {
            failedDraftCalls.push({ type: 'save', draft });
        },
        remove(moodboardId) {
            failedDraftCalls.push({ type: 'remove', moodboardId });
        },
    },
});
failedAutosave.markChanged();
assert.equal(await failedAutosave.flush(), false);
assert.deepEqual(failedDraftCalls.map(({ type }) => type), ['save']);
await failedAutosave.destroy({ flush: false });

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
assert.match(editorMarkup, /data-role="recovery-draft"/);
assert.match(editorMarkup, /role="alertdialog" aria-modal="true"/);
assert.match(editorMarkup, /data-action="restore-recovery-draft"/);
assert.match(editorMarkup, /data-action="discard-recovery-draft"/);

console.log('recovery draft: PASS');
