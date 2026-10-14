import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    createMoodboardDocument,
    MoodboardValidationError,
} from '../assets/js/models/moodboard-document.js';

const image = {
    id: 'image-processed',
    type: 'image',
    assetId: 'asset-processed',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    backgroundRemoved: true,
};
const document = createMoodboardDocument({ elements: [image] });
assert.equal(document.pages[0].elements[0].backgroundRemoved, true);

assert.throws(
    () => createMoodboardDocument({ elements: [{ ...image, backgroundRemoved: 'yes' }] }),
    MoodboardValidationError,
);
assert.throws(
    () => createMoodboardDocument({
        elements: [{
            ...image,
            type: 'shape',
            shapeType: 'rectangle',
            backgroundRemoved: true,
        }],
    }),
    MoodboardValidationError,
);

const editorAppSource = await readFile(new URL('../assets/js/editor/editor-app.js', import.meta.url), 'utf8');
const uiControllerSource = await readFile(new URL('../assets/js/editor/ui-controller.js', import.meta.url), 'utf8');
assert.match(editorAppSource, /element\.backgroundRemoved = true;/);
assert.match(uiControllerSource, /Фон у этого изображения уже удалён\./);
assert.match(uiControllerSource, /this\.backgroundRemovalElementId !== null[\s\S]*?Генерация удаления фона уже запущена\./);
assert.match(uiControllerSource, /const disabled = selectedElement\?\.locked === true;/);
assert.match(uiControllerSource, /\.toggleClass\('is-complete', removalComplete\)/);
assert.match(uiControllerSource, /\.attr\('aria-pressed', String\(removalComplete\)\)/);

console.log('background removal state: PASS');
