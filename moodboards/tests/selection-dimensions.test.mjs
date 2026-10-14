import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CanvasAdapter } from '../assets/js/editor/canvas-adapter.js';
import {
    formatSelectionDimensions,
    resolveSelectionDimensionsPosition,
} from '../assets/js/editor/selection-dimensions.js';
import {
    DEFAULT_MOODBOARD_USER_SETTINGS,
    normalizeMoodboardUserSettings,
} from '../assets/js/settings/moodboard-user-settings-repository.js';

assert.equal(DEFAULT_MOODBOARD_USER_SETTINGS.showElementDimensions, false);
assert.equal(normalizeMoodboardUserSettings({}).showElementDimensions, false);
assert.equal(normalizeMoodboardUserSettings({ showElementDimensions: true }).showElementDimensions, true);
assert.equal(DEFAULT_MOODBOARD_USER_SETTINGS.showBindingGuides, false);
assert.equal(DEFAULT_MOODBOARD_USER_SETTINGS.darkMode, false);
assert.equal(DEFAULT_MOODBOARD_USER_SETTINGS.focusMode, false);
assert.equal(normalizeMoodboardUserSettings({}).showBindingGuides, false);
assert.equal(formatSelectionDimensions({ count: 1, width: 319.6, height: 180.2 }), '320 × 180 px');
assert.equal(
    formatSelectionDimensions({ count: 3, width: 640.4, height: 479.6 }),
    '3 объекта · 640 × 480 px',
);

const singleDimensions = CanvasAdapter.prototype.getSelectionDimensions.call({
    _getSelectedNodes: () => [{
        width: () => 240,
        height: () => 160,
        scaleX: () => -1.5,
        scaleY: () => 2,
    }],
});
assert.deepEqual(singleDimensions, { count: 1, width: 360, height: 320 });

const multipleDimensions = CanvasAdapter.prototype.getSelectionDimensions.call({
    _getSelectedNodes: () => [{}, {}, {}],
    getSelectionBounds: () => ({ x: 0, y: 0, width: 700, height: 410 }),
});
assert.deepEqual(multipleDimensions, { count: 3, width: 700, height: 410 });

assert.deepEqual(resolveSelectionDimensionsPosition({
    selectionRect: { x: 100, y: 100, width: 500, height: 200 },
    badgeWidth: 110,
    badgeHeight: 26,
    workspaceWidth: 1200,
    workspaceHeight: 800,
}), { left: 490, top: 310, placement: 'below' });

assert.equal(resolveSelectionDimensionsPosition({
    selectionRect: { x: 100, y: 100, width: 60, height: 60 },
    badgeWidth: 110,
    badgeHeight: 26,
    workspaceWidth: 1200,
    workspaceHeight: 800,
}).placement, 'right', 'Узкое выделение не должно перекрывать маркер вращения.');

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
assert.match(editorMarkup, /data-setting="showElementDimensions"/);
assert.match(editorMarkup, /data-role="selection-dimensions"/);
assert.match(editorMarkup, />Настройки сцены</);
assert.match(editorMarkup, />Расширенные настройки</);

console.log('selection dimensions: PASS');
