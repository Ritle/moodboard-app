import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    appendImageEraseStroke,
    createImageEraseMask,
    hasImageEraseMask,
    validateImageEraseMask,
} from '../assets/js/models/image-erase-mask.js';
import {
    createMoodboardDocument,
    MoodboardValidationError,
} from '../assets/js/models/moodboard-document.js';
import {
    DEFAULT_IMAGE_ERASER_SIZE,
    LocalStorageMoodboardSettingsRepository,
    normalizeMoodboardUserSettings,
} from '../assets/js/settings/moodboard-user-settings-repository.js';

const stroke = { size: 0.08, points: [0.2, 0.3, 0.25, 0.35] };
const mask = createImageEraseMask([stroke]);
assert.equal(hasImageEraseMask(mask), true);
assert.deepEqual(appendImageEraseStroke(mask, {
    size: 0.04,
    points: [0.5, 0.5],
}).strokes, [stroke, { size: 0.04, points: [0.5, 0.5] }]);
assert.throws(
    () => validateImageEraseMask({ version: 1, strokes: [{ size: 0.1, points: [1.2, 0.5] }] }),
    /координаты/i,
);
assert.throws(
    () => validateImageEraseMask({ version: 2, strokes: [] }),
    /version/i,
);

const image = {
    id: 'image-1',
    type: 'image',
    assetId: 'asset-1',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    eraseMask: mask,
};
const document = createMoodboardDocument({ elements: [image] });
assert.deepEqual(document.pages[0].elements[0].eraseMask, mask);
assert.throws(
    () => createMoodboardDocument({
        elements: [{ ...image, type: 'shape', shapeType: 'rectangle' }],
    }),
    MoodboardValidationError,
);

assert.equal(normalizeMoodboardUserSettings({}).imageEraserSize, DEFAULT_IMAGE_ERASER_SIZE);
assert.equal(normalizeMoodboardUserSettings({ imageEraserSize: 2 }).imageEraserSize, 8);
assert.equal(normalizeMoodboardUserSettings({ imageEraserSize: 999 }).imageEraserSize, 256);
assert.equal(normalizeMoodboardUserSettings({ imageEraserSize: 95.6 }).imageEraserSize, 96);

const settingsValues = new Map();
const storage = {
    getItem(key) { return settingsValues.has(key) ? settingsValues.get(key) : null; },
    setItem(key, value) { settingsValues.set(key, value); },
};
const settingsRepository = new LocalStorageMoodboardSettingsRepository({ storage, userId: 12 });
await settingsRepository.save({ imageEraserSize: 128 });
const reloadedSettingsRepository = new LocalStorageMoodboardSettingsRepository({ storage, userId: 12 });
assert.equal((await reloadedSettingsRepository.load()).imageEraserSize, 128);

const canvasSource = await readFile(new URL('../assets/js/editor/canvas-adapter.js', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../assets/js/editor/editor-app.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../assets/js/editor/ui-controller.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
const editorStyles = await readFile(new URL('../assets/css/editor.css', import.meta.url), 'utf8');

assert.match(canvasSource, /globalCompositeOperation = 'destination-out'/);
assert.match(canvasSource, /getAbsoluteTransform\(\)\.copy\(\)\.invert\(\)/);
assert.match(canvasSource, /onImageEraseStroke\(active\.elementId, stroke\)/);
assert.match(editorSource, /appendImageEraseStroke\(element\.eraseMask, stroke\)/);
assert.match(uiSource, /activeTool === 'image-eraser'/);
assert.match(uiSource, /imageEraserSettingsOpen = false/);
assert.match(uiSource, /this\._setActiveTool\('select'\)/);
assert.match(uiSource, /imageEraserSettingsOpen = true/);
assert.match(uiSource, /const settingsOpen = eraserActive/);
assert.match(uiSource, /handActive \|\| \(drawingActive && !imageEraserActive\)/);
assert.match(uiSource, /_positionImageEraserPopover\(\{ toolbar, workspace, selectionRect \}\)/);
assert.match(markup, /data-object-action="toggle-image-eraser"/);
assert.match(markup, /data-role="image-eraser-size"[^>]+min="8"[^>]+max="256"/);
assert.match(editorStyles, /\.image-eraser-popover\s*\{[^}]*position:\s*fixed;/s);
assert.match(editorStyles, /\.editor-shell--dark \.editor-notification--success\s*\{\s*background:\s*var\(--correct-fill\)/);

console.log('image eraser: PASS');
