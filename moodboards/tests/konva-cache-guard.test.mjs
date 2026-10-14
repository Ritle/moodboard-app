import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    CanvasAdapter,
    resolveCanvasPixelRatio,
    resolveComplexNodeCachePixelRatio,
} from '../assets/js/editor/canvas-adapter.js';

assert.equal(resolveCanvasPixelRatio(2), 2);
assert.equal(resolveCanvasPixelRatio(0), 1);
assert.equal(resolveCanvasPixelRatio(Number.NaN), 1);
assert.equal(resolveComplexNodeCachePixelRatio(1, 1), 1);
assert.equal(resolveComplexNodeCachePixelRatio(2, 0.6), 1.5);
assert.equal(resolveComplexNodeCachePixelRatio(2, 1), 2);
assert.equal(resolveComplexNodeCachePixelRatio(2, 1.15), null);

const adapter = Object.create(CanvasAdapter.prototype);
const freehand = {
    type: 'brush',
    points: Array.from({ length: 40 }, (_, index) => index / 40),
};
let cacheOptions = null;
const cachedNode = {
    width: () => 120,
    height: () => 80,
    strokeWidth: () => 5,
    cache: (options) => { cacheOptions = options; },
    clearCache() {},
    getAttr(name) {
        return this[name];
    },
    setAttr(name, value) {
        this[name] = value;
    },
};
adapter._cacheComplexNode(cachedNode, freehand);
assert.deepEqual(cacheOptions, {
    x: -5,
    y: -5,
    width: 130,
    height: 90,
    pixelRatio: 1,
});
assert.equal(cachedNode.performanceCached, true);
assert.equal(cachedNode.performanceCachePixelRatio, 1);

adapter.renderPixelRatio = 2;
adapter.viewportScale = 1.15;
let highZoomCacheCalls = 0;
let highZoomClearCalls = 0;
const highZoomNode = {
    width: () => 120,
    height: () => 80,
    strokeWidth: () => 5,
    cache() {
        highZoomCacheCalls += 1;
    },
    clearCache() {
        highZoomClearCalls += 1;
    },
    getAttr(name) {
        return this[name];
    },
    setAttr(name, value) {
        this[name] = value;
    },
    performanceCached: true,
};
adapter._cacheComplexNode(highZoomNode, freehand);
assert.equal(highZoomCacheCalls, 0);
assert.equal(highZoomClearCalls, 1);
assert.equal(highZoomNode.performanceCached, false);

adapter.renderPixelRatio = 1;
adapter.viewportScale = 1;

let zeroCacheCalls = 0;
adapter._cacheComplexNode({
    width: () => 0,
    height: () => 80,
    cache: () => { zeroCacheCalls += 1; },
}, freehand);
assert.equal(zeroCacheCalls, 0);

let cacheCleared = false;
const failingNode = {
    width: () => 120,
    height: () => 80,
    strokeWidth: () => 5,
    cache() {
        throw new DOMException('Canvas has zero size', 'InvalidStateError');
    },
    clearCache() {
        cacheCleared = true;
    },
    setAttr(name, value) {
        this[name] = value;
    },
};
assert.doesNotThrow(() => adapter._cacheComplexNode(failingNode, freehand));
assert.equal(cacheCleared, true);
assert.equal(failingNode.performanceCached, false);

const sceneCanvasRatios = [];
const createLayer = () => ({
    getCanvas: () => ({
        getPixelRatio: () => 1,
        setPixelRatio: (value) => sceneCanvasRatios.push(value),
    }),
    getHitCanvas: () => ({
        getPixelRatio: () => 1,
        setPixelRatio: () => assert.fail('Hit canvases must keep Konva pixelRatio 1.'),
    }),
});
const ratioAdapter = Object.create(CanvasAdapter.prototype);
ratioAdapter.Konva = { pixelRatio: 1 };
ratioAdapter.renderPixelRatio = 1;
ratioAdapter.backgroundLayer = createLayer();
ratioAdapter.contentLayer = createLayer();
ratioAdapter.uiLayer = createLayer();
ratioAdapter.document = null;
let drawCalls = 0;
let stageBufferRatio = 1;
ratioAdapter.stage = {
    bufferCanvas: {
        getPixelRatio: () => stageBufferRatio,
        setPixelRatio: (value) => { stageBufferRatio = value; },
    },
    batchDraw: () => { drawCalls += 1; },
};
assert.equal(ratioAdapter.syncRenderPixelRatio(2), true);
assert.deepEqual(sceneCanvasRatios, [2, 2, 2]);
assert.equal(stageBufferRatio, 2);
assert.equal(ratioAdapter.Konva.pixelRatio, 2);
assert.equal(drawCalls, 1);
assert.equal(ratioAdapter.syncRenderPixelRatio(2), false);

const adapterSource = await readFile(
    new URL('../assets/js/editor/canvas-adapter.js', import.meta.url),
    'utf8',
);
assert.match(
    adapterSource,
    /this\.contentLayer\.add\(node\);\s*this\._cacheComplexNode\(node, element\);/,
);

console.log('Konva cache guard: PASS');
