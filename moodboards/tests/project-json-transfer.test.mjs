import assert from 'node:assert/strict';

import { createMoodboardDocument } from '../assets/js/models/moodboard-document.js';
import {
    collectDocumentAssetIds,
    createProjectJsonPackage,
    dataUrlToBlob,
    parseProjectJson,
    replaceDocumentAssetIds,
} from '../assets/js/editor/project-json-transfer.js';

const document = createMoodboardDocument({
    elements: [{
        id: 'image-1', type: 'image', assetId: 'asset-old', x: 0, y: 0,
        width: 100, height: 100, rotation: 0, opacity: 1,
    }],
});
assert.deepEqual(collectDocumentAssetIds(document), ['asset-old']);

const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
const packaged = createProjectJsonPackage({
    title: 'Проект',
    document,
    assets: [{ sourceId: 'asset-old', mimeType: 'image/png', dataUrl }],
    exportedAt: '2026-08-25T00:00:00.000Z',
});
const parsed = parseProjectJson(JSON.stringify(packaged));
assert.equal(parsed.title, 'Проект');
assert.equal(parsed.assets.length, 1);
assert.equal(dataUrlToBlob(dataUrl).type, 'image/png');

const replaced = replaceDocumentAssetIds(parsed.document, new Map([['asset-old', 'asset-new']]));
assert.equal(replaced.pages[0].elements[0].assetId, 'asset-new');
assert.throws(() => parseProjectJson('{broken'), /корректным JSON/);

console.log('project JSON transfer: PASS');
