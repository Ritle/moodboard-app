import assert from 'node:assert/strict';
import {
    CanvasAdapter,
    drawRoundedImage,
    normalizeImageCornerRadius,
} from '../assets/js/editor/canvas-adapter.js';

let placeholderDestroyed = false;
let immediateDraws = 0;
let hydratedNode = null;
let scheduledDraw = null;

const placeholder = {
    getStage: () => ({}),
    getAttrs: () => ({ elementId: 'image-1', width: 320, height: 180 }),
    destroy: () => { placeholderDestroyed = true; },
};

class FakeImageNode {
    constructor(attributes) {
        this.attributes = attributes;
        this.layerIndex = null;
    }

    zIndex(index) {
        this.layerIndex = index;
    }
}

const adapter = Object.create(CanvasAdapter.prototype);
adapter.destroyed = false;
adapter.selectedElementIds = [];
adapter.nodesById = new Map([['image-1', placeholder]]);
adapter.document = { elements: [{ id: 'image-1' }] };
adapter.contentRectsCache = Object.freeze([]);
adapter.contentDrawFrame = null;
adapter.Konva = { Image: FakeImageNode };
adapter._loadCachedImage = async () => ({
    image: { naturalWidth: 640, naturalHeight: 360 },
    width: 640,
    height: 360,
});
adapter._bindNode = () => {};
adapter.contentLayer = {
    add(node) {
        hydratedNode = node;
    },
    draw() {
        immediateDraws += 1;
    },
};
adapter.onAssetError = () => {};

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (callback) => {
    scheduledDraw = callback;
    return 17;
};
try {
    await adapter._hydrateImageNode(
        placeholder,
        {
            id: 'image-1',
            type: 'image',
            assetId: 'processed-asset',
            width: 320,
            height: 180,
            aspectRatio: 16 / 9,
            cornerRadius: 24,
        },
    );
} finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
}

assert.equal(placeholderDestroyed, true);
assert.equal(hydratedNode instanceof FakeImageNode, true);
assert.equal(hydratedNode.attributes.cornerRadius, 24);
assert.equal(hydratedNode.attributes.sceneFunc, drawRoundedImage);
assert.equal(hydratedNode.layerIndex, 0);
assert.equal(immediateDraws, 0);
assert.equal(typeof scheduledDraw, 'function');
scheduledDraw();
assert.equal(adapter.contentRectsCache, null);
assert.equal(immediateDraws, 1, 'Слой должен перерисоваться сразу после гидратации изображения.');

class FakeRectNode {
    constructor(attributes) {
        this.attributes = attributes;
    }
}

const placeholderAdapter = Object.create(CanvasAdapter.prototype);
placeholderAdapter.interactionEnabled = true;
placeholderAdapter.imageCache = new Map();
placeholderAdapter.Konva = { Rect: FakeRectNode };
const transparentPlaceholder = placeholderAdapter._createNode({
    id: 'image-placeholder',
    type: 'image',
    assetId: 'not-hydrated-yet',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
});
assert.equal(transparentPlaceholder.attributes.fill, 'rgba(0, 0, 0, 0)');
assert.equal(transparentPlaceholder.attributes.stroke, undefined);
assert.equal(transparentPlaceholder.attributes.cornerRadius, 0);

assert.equal(normalizeImageCornerRadius(64, 60, 40), 20);
assert.equal(normalizeImageCornerRadius(-12, 60, 40), 0);

const drawingCalls = [];
const drawingContext = new Proxy({}, {
    get(_target, property) {
        return (...args) => drawingCalls.push([property, ...args]);
    },
});
drawRoundedImage(drawingContext, {
    image: () => ({ width: 100, height: 80 }),
    width: () => 60,
    height: () => 40,
    getAttr: (property) => (property === 'cornerRadius' ? 64 : undefined),
});
assert.ok(drawingCalls.some(([method]) => method === 'clip'));
assert.deepEqual(
    drawingCalls.find(([method]) => method === 'drawImage')?.slice(2),
    [0, 0, 60, 40],
);
assert.ok(
    drawingCalls.some((call) => call[0] === 'moveTo' && call[1] === 20),
    'Радиус при отрисовке должен ограничиваться половиной меньшей стороны изображения.',
);

console.log('image hydration redraw: PASS');
