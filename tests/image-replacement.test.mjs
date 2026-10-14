import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { replaceImageAssetInPage } from '../assets/js/editor/image-replacement-utils.js';

const page = {
    id: 'page-1',
    elements: [
        { id: 'behind', type: 'shape', x: 0, y: 0 },
        {
            id: 'image-1',
            type: 'image',
            assetId: 'asset-old',
            x: 147,
            y: 263,
            width: 418,
            height: 279,
            rotation: 37,
            hyperlink: 'https://example.com/product',
            opacity: 0.75,
            flipX: true,
            flipY: false,
            locked: false,
            frameId: 'frame-1',
            groupId: 'group-1',
            backgroundRemoved: true,
            eraseMask: {
                version: 1,
                strokes: [{ size: 0.1, points: [0.4, 0.4] }],
            },
            aspectRatio: 1.5,
        },
        { id: 'front', type: 'text', x: 50, y: 50, text: 'Спереди' },
    ],
};
const originalImage = structuredClone(page.elements[1]);

assert.equal(replaceImageAssetInPage(page, 'image-1', {
    id: 'asset-new',
    width: 900,
    height: 1200,
}), true);

assert.deepEqual(page.elements.map(({ id }) => id), ['behind', 'image-1', 'front']);
assert.equal(page.elements[1].assetId, 'asset-new');
assert.equal(page.elements[1].aspectRatio, 0.75);
assert.equal('backgroundRemoved' in page.elements[1], false);
assert.equal('eraseMask' in page.elements[1], false);
for (const property of [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'hyperlink',
    'opacity',
    'flipX',
    'flipY',
    'locked',
    'frameId',
    'groupId',
]) {
    assert.deepEqual(page.elements[1][property], originalImage[property], `Изменилось свойство ${property}`);
}

assert.equal(replaceImageAssetInPage(page, 'missing', {
    id: 'asset-other',
    width: 100,
    height: 100,
}), false);
assert.equal(replaceImageAssetInPage(page, 'front', {
    id: 'asset-other',
    width: 100,
    height: 100,
}), false);
assert.throws(() => replaceImageAssetInPage(page, 'image-1', {
    id: 'asset-broken',
    width: 0,
    height: 100,
}), /размеры нового изображения/i);

const editorSource = await readFile(
    new URL('../assets/js/editor/editor-app.js', import.meta.url),
    'utf8',
);
const uiSource = await readFile(
    new URL('../assets/js/editor/ui-controller.js', import.meta.url),
    'utf8',
);
const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');

assert.match(editorSource, /executeDocument\(\s*['"]Замена изображения['"]/);
assert.match(editorSource, /pageIds: \[targetPageId\]/);
assert.match(editorSource, /replaceImageAssetInPage\(page, elementId, stagedAsset\)/);
assert.match(uiSource, /data-role="replace-image-input"/);
assert.match(editorMarkup, /data-object-action="replace-image"/);
assert.match(editorMarkup, /accept="image\/jpeg,image\/png,image\/webp" aria-label="Выбрать новое изображение"/);

console.log('image replacement: PASS');
