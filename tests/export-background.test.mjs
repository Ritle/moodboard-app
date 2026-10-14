import assert from 'node:assert/strict';

import {
    constrainExportPixelRatio,
    fitExportBoundsToAspectRatio,
    shouldRenderExportBackground,
} from '../assets/js/editor/canvas-adapter.js';

assert.equal(shouldRenderExportBackground('image/png'), false);
assert.equal(shouldRenderExportBackground('image/png', false), false);
assert.equal(shouldRenderExportBackground('image/png', true), true);
assert.equal(shouldRenderExportBackground('image/jpeg'), true);
assert.equal(shouldRenderExportBackground('image/jpeg', false), true);

assert.deepEqual(
    fitExportBoundsToAspectRatio({ x: 10, y: 20, width: 800, height: 800 }, 16 / 10),
    { x: -230, y: 20, width: 1280, height: 800 },
);
assert.deepEqual(
    fitExportBoundsToAspectRatio({ x: 10, y: 20, width: 1600, height: 500 }, 16 / 10),
    { x: 10, y: -230, width: 1600, height: 1000 },
);
assert.equal(constrainExportPixelRatio(0.3, { width: 1600, height: 1000 }, 480, 300), 0.3);
assert.equal(constrainExportPixelRatio(0.3, { width: 6400, height: 4000 }, 480, 300), 0.075);

console.log('export background: PASS');
