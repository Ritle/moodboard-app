import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    createMoodboardTemplate,
    getMoodboardTemplates,
} from '../assets/js/moodboards/moodboard-templates.js';
import { persistMoodboardTemplate } from '../assets/js/moodboards/moodboards-list-controller.js';

const templates = getMoodboardTemplates();
assert.equal(templates.length, 8);
assert.equal(new Set(templates.map(({ id }) => id)).size, templates.length);
assert.equal(templates.filter(({ id }) => id.endsWith('-variant-2')).length, 4);

const fetchTemplate = async (url) => ({
    ok: true,
    text: () => readFile(new URL(`..${url.replace('/moodboards', '')}`, import.meta.url), 'utf8'),
});

for (const metadata of templates) {
    assert.match(metadata.previewUrl, /^\/moodboards\/assets\/templates\/.+\.preview\.jpg$/);
    assert.match(metadata.projectUrl, /^\/moodboards\/assets\/templates\/.+\.project\.json$/);
    const loaded = await createMoodboardTemplate(metadata.id, { fetchImpl: fetchTemplate });
    assert.equal(loaded.id, metadata.id);
    assert.equal(loaded.document.pages.length > 0, true);
    assert.equal(loaded.assets.length > 0, true);
}

const template = await createMoodboardTemplate('bright-luxury', { fetchImpl: fetchTemplate });
let savedDocument = null;
let deletedId = null;
const repository = {
    async create({ title, document }) {
        assert.equal(title, 'Bright luxury');
        assert.equal(document.pages.length, 1);
        return { id: 'board-from-template', revision: 0, title, document };
    },
    async addAsset(moodboardId, blob) {
        assert.equal(moodboardId, 'board-from-template');
        assert.equal(blob instanceof Blob, true);
        assert.equal(blob.type, 'image/png');
        return { id: 'stored-template-asset' };
    },
    async saveContent(id, document, revision) {
        assert.equal(id, 'board-from-template');
        assert.equal(revision, 0);
        savedDocument = document;
        return { id, revision: 1, title: template.title, document };
    },
    async delete(id) {
        deletedId = id;
        return true;
    },
};

const record = await persistMoodboardTemplate(repository, template);
assert.equal(record.revision, 1);
assert.equal(savedDocument.pages[0].elements.find(({ type }) => type === 'image').assetId, 'stored-template-asset');
assert.equal(deletedId, null);

await assert.rejects(
    persistMoodboardTemplate(repository, { ...template, assets: [] }),
    /отсутствует изображение/,
);
assert.equal(deletedId, 'board-from-template');

await assert.rejects(
    () => createMoodboardTemplate('missing-template', { fetchImpl: fetchTemplate }),
    /неизвестный шаблон/,
);

console.log('moodboard templates: PASS');
