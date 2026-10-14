import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CanvasAdapter, resolveResizeAnchors } from '../assets/js/editor/canvas-adapter.js';

const cornerAnchors = [
    'top-left',
    'top-right',
    'bottom-right',
    'bottom-left',
];
const fullAnchors = [
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
];

assert.deepEqual(resolveResizeAnchors('image'), cornerAnchors);
for (const type of ['shape', 'text', 'sticker', 'brush', 'highlighter', 'frame']) {
    assert.deepEqual(resolveResizeAnchors(type), fullAnchors, `Ожидались все маркеры для ${type}.`);
}
assert.deepEqual(resolveResizeAnchors('arrow'), []);
assert.deepEqual(resolveResizeAnchors('shape', false), []);

const canvasSource = await readFile(
    new URL('../assets/js/editor/canvas-adapter.js', import.meta.url),
    'utf8',
);
assert.match(canvasSource, /const groupResizable = groupDraggable/);
assert.match(canvasSource, /\? \[\.\.\.CORNER_RESIZE_ANCHORS\]/);
assert.match(canvasSource, /onCommitMany\(updates, 'Общая трансформация группы объектов'\)/);

function transformNode(id, x, y) {
    let width = 100;
    let height = 50;
    let scale = { x: 2, y: 2 };
    let offset = { x: 0, y: 0 };
    return {
        getAttr(name) {
            return ({ elementId: id, elementType: 'shape', flipX: false, flipY: false })[name];
        },
        x: () => x,
        y: () => y,
        width: () => width,
        height: () => height,
        scaleX: () => scale.x,
        scaleY: () => scale.y,
        rotation: () => 0,
        scale(next) { scale = { ...next }; },
        size(next) { width = next.width; height = next.height; },
        offset(next) { offset = { ...next }; },
        snapshot: () => ({ width, height, scale, offset }),
    };
}

const firstNode = transformNode('first', 20, 30);
const secondNode = transformNode('second', 240, 30);
const transformAdapter = Object.create(CanvasAdapter.prototype);
transformAdapter.destroyed = false;
transformAdapter.selectionTransformState = {
    elementIds: ['first', 'second'],
    scheduled: false,
};
transformAdapter.selectedElementIds = ['first', 'second'];
transformAdapter.nodesById = new Map([
    ['first', firstNode],
    ['second', secondNode],
]);
transformAdapter.document = { elements: [{ id: 'first' }, { id: 'second' }] };
transformAdapter._hideElementBindingGuides = () => {};
transformAdapter._renderSelectionOutlines = () => {};
transformAdapter._notifySelectionBoundsChange = () => {};
transformAdapter.contentLayer = { batchDraw() {} };
transformAdapter.uiLayer = { batchDraw() {} };
let committedTransform = null;
transformAdapter.onCommitMany = (updates, label) => {
    committedTransform = { updates, label };
};
assert.equal(
    transformAdapter._finishSelectionTransform(transformAdapter.selectionTransformState),
    true,
);
assert.deepEqual(committedTransform, {
    updates: [
        { elementId: 'first', patch: { x: 20, y: 30, width: 200, height: 100, rotation: 0 } },
        { elementId: 'second', patch: { x: 240, y: 30, width: 200, height: 100, rotation: 0 } },
    ],
    label: 'Общая трансформация группы объектов',
});
assert.deepEqual(firstNode.snapshot(), {
    width: 200,
    height: 100,
    scale: { x: 1, y: 1 },
    offset: { x: 0, y: 0 },
});

console.log('resize anchors: PASS');
