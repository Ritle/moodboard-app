import assert from 'node:assert/strict';

import {
    PreviewManager,
    pageHasPreviewContent,
    selectFilledPages,
    selectPreviewPage,
} from '../assets/js/editor/preview-manager.js';

const emptyPage = {
    id: 'empty',
    canvas: { width: 1600, height: 1000, background: '#ffffff' },
    elements: [],
};
const blankTextPage = {
    id: 'blank-text',
    canvas: { width: 1600, height: 1000, background: '#ffffff' },
    elements: [{ id: 'text-empty', type: 'text', text: '   ' }],
};
const filledPage = {
    id: 'filled',
    canvas: { width: 1600, height: 1000, background: '#ffffff' },
    elements: [{ id: 'shape-1', type: 'shape', shapeType: 'rectangle' }],
};

assert.equal(pageHasPreviewContent(emptyPage), false);
assert.equal(pageHasPreviewContent(blankTextPage), false);
assert.equal(pageHasPreviewContent(filledPage), true);
assert.deepEqual(
    selectFilledPages({ pages: [emptyPage, blankTextPage, filledPage, { ...filledPage, id: 'filled-2' }] })
        .map(({ id }) => id),
    ['filled', 'filled-2'],
);
assert.equal(selectPreviewPage({ pages: [emptyPage, filledPage] }, 'empty')?.id, 'filled');
assert.equal(selectPreviewPage({ pages: [filledPage, emptyPage] }, 'filled')?.id, 'filled');
assert.equal(selectPreviewPage({ pages: [emptyPage, blankTextPage] }, 'empty'), null);

function createHarness(document, activePageId = 'empty') {
    const renderedPages = [];
    const exportOptions = [];
    const savedPreviews = [];
    const previewBlob = new Blob(['preview'], { type: 'image/png' });
    const store = {
        moodboardId: 'board-1',
        revision: 4,
        getDocument: () => structuredClone(document),
        getActivePageId: () => activePageId,
    };
    const repository = {
        savePreview: async (moodboardId, blob) => savedPreviews.push({ moodboardId, blob }),
    };
    const canvasAdapter = {
        renderDocument: (page) => renderedPages.push(page.id),
        exportAsBlob: async (options) => {
            exportOptions.push(options);
            return previewBlob;
        },
    };
    return {
        manager: new PreviewManager({ store, repository, canvasAdapter }),
        renderedPages,
        exportOptions,
        savedPreviews,
        previewBlob,
    };
}

const filledDocument = { pages: [emptyPage, filledPage] };
const filledHarness = createHarness(filledDocument);
assert.equal(await filledHarness.manager.generate({ document: filledDocument, revision: 4 }), true);
assert.deepEqual(filledHarness.renderedPages, ['filled']);
assert.equal(filledHarness.exportOptions[0].targetAspectRatio, 16 / 10);
assert.equal(filledHarness.exportOptions[0].includeBackground, true);
assert.equal(filledHarness.exportOptions[0].maxWidth, 480);
assert.equal(filledHarness.exportOptions[0].maxHeight, 300);
assert.equal(filledHarness.savedPreviews[0].blob, filledHarness.previewBlob);

const emptyDocument = { pages: [emptyPage, blankTextPage] };
const emptyHarness = createHarness(emptyDocument);
assert.equal(await emptyHarness.manager.generate({ document: emptyDocument, revision: 4 }), true);
assert.deepEqual(emptyHarness.renderedPages, []);
assert.equal(emptyHarness.savedPreviews[0].blob, null);

console.log('preview page selection: PASS');
