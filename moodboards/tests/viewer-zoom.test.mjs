import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    clampViewerScale,
    resolveViewerPanViewport,
    resolveViewerZoomViewport,
} from '../assets/js/viewer/app.js';

assert.equal(clampViewerScale(0.01), 0.1);
assert.equal(clampViewerScale(8), 5);
assert.equal(clampViewerScale(1.5), 1.5);

assert.deepEqual(
    resolveViewerZoomViewport(
        { scale: 1, x: 0, y: 0 },
        2,
        { x: 100, y: 80 },
    ),
    { scale: 2, x: -100, y: -80 },
    'Точка под курсором должна оставаться на месте при масштабировании.',
);

assert.deepEqual(
    resolveViewerPanViewport(
        { scale: 1.5, x: -100, y: 40 },
        { x: 25, y: -15 },
    ),
    { scale: 1.5, x: -75, y: 25 },
    'Режим руки должен смещать весь viewport на перемещение указателя.',
);

const viewerMarkup = await readFile(new URL('../view.php', import.meta.url), 'utf8');
assert.match(viewerMarkup, /data-action="viewer-zoom-out"/);
assert.match(viewerMarkup, /data-role="viewer-zoom-value"/);
assert.match(viewerMarkup, /data-action="viewer-zoom-in"/);
assert.match(viewerMarkup, /data-action="viewer-zoom-fit"/);

console.log('viewer zoom: PASS');
