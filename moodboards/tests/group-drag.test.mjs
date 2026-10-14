import assert from 'node:assert/strict';

import {
    CanvasAdapter,
    createGroupDragUpdates,
} from '../assets/js/editor/canvas-adapter.js';
import { EditorApp } from '../assets/js/editor/editor-app.js';

function createNode(elementId, elementType, x, y, locked = false, initialRotation = 0) {
    let position = { x, y };
    let rotation = initialRotation;
    return {
        getAttr(name) {
            return { elementId, elementType, locked }[name];
        },
        x() {
            return position.x;
        },
        y() {
            return position.y;
        },
        position(nextPosition) {
            position = { ...nextPosition };
        },
        rotation(nextRotation) {
            if (nextRotation !== undefined) {
                rotation = nextRotation;
            }
            return rotation;
        },
        currentPosition() {
            return position;
        },
    };
}

const startPositions = new Map([
    ['source', { x: 10, y: 20 }],
    ['second', { x: 40, y: 60 }],
    ['third', { x: -5, y: 8 }],
    ['frame-child', { x: 4, y: 5 }],
]);
const expectedUpdates = [
    { elementId: 'source', patch: { x: 35, y: 5 } },
    { elementId: 'second', patch: { x: 65, y: 45 } },
    { elementId: 'third', patch: { x: 20, y: -7 } },
    { elementId: 'frame-child', patch: { x: 29, y: -10 } },
];

assert.deepEqual(
    createGroupDragUpdates(startPositions, { x: 10, y: 20 }, { x: 35, y: 5 }),
    expectedUpdates,
);
assert.deepEqual(createGroupDragUpdates(null, {}, {}), []);

const nodes = new Map([
    ['source', createNode('source', 'shape', 35, 5)],
    ['second', createNode('second', 'shape', 40, 60)],
    ['third', createNode('third', 'shape', -5, 8)],
    ['frame-child', createNode('frame-child', 'shape', 4, 5)],
]);
const adapter = Object.create(CanvasAdapter.prototype);
adapter.nodesById = nodes;
adapter.groupDragState = {
    sourceElementId: 'source',
    sourceStart: { x: 10, y: 20 },
    transformerElementIds: new Set(['source', 'second', 'third']),
    positions: startPositions,
};
adapter.groupDragNodes = new WeakSet([
    nodes.get('source'),
    nodes.get('second'),
    nodes.get('third'),
]);
adapter.groupDragSourceNode = nodes.get('source');

// Имитируем исходную ошибку: к dragend в текущем selection остался только
// непосредственно перетаскиваемый объект.
adapter.selectedElementIds = ['source'];
adapter.contentLayer = {
    findOne: (predicate) => [...nodes.values()].find(predicate),
    batchDraw: () => {},
};
adapter.uiLayer = { batchDraw: () => {} };
adapter.transformer = { forceUpdate: () => {} };
adapter._syncHyperlinkIndicator = () => {};
adapter._renderSelectionOutlines = () => {};
adapter._getSelectedNodes = () => [nodes.get('source')];

adapter._moveSelectedNodesWith(nodes.get('source'), 'source');
// Выделенные узлы перемещает встроенный proxy Konva.Transformer, поэтому наш
// обработчик не должен применять к ним ту же дельту второй раз.
assert.deepEqual(nodes.get('second').currentPosition(), { x: 40, y: 60 });
assert.deepEqual(nodes.get('third').currentPosition(), { x: -5, y: 8 });
assert.deepEqual(nodes.get('frame-child').currentPosition(), { x: 29, y: -10 });

let committed = null;
adapter.onCommitMany = (updates, label) => {
    committed = { updates, label };
};

// Proxy dragend другого узла не завершает и не перезаписывает общую операцию.
assert.equal(adapter._finishGroupDragForNode(nodes.get('second'), 'second'), true);
assert.notEqual(adapter.groupDragState, null);
assert.equal(committed, null);
assert.equal(adapter._isGroupDragProxyNode(nodes.get('second')), true);
assert.equal(adapter._isGroupDragProxyNode(nodes.get('source')), false);

assert.equal(adapter._finishGroupDragForNode(nodes.get('source'), 'source'), true);
assert.equal(adapter.groupDragState, null);
assert.deepEqual(committed, {
    updates: expectedUpdates,
    label: 'Перемещение группы объектов',
});

const page = {
    elements: [...startPositions].map(([id, position]) => ({
        id,
        type: 'shape',
        width: 20,
        height: 20,
        ...position,
    })),
};
const editor = Object.create(EditorApp.prototype);
editor.commandManager = {
    execute(label, mutator) {
        assert.equal(label, 'Перемещение группы объектов');
        mutator(page);
        return true;
    },
};
assert.equal(editor._commitElements(committed.updates, committed.label), true);
assert.deepEqual(
    page.elements.map(({ id, x, y }) => ({ id, x, y })),
    expectedUpdates.map(({ elementId: id, patch: { x, y } }) => ({ id, x, y })),
);

const frame = createNode('frame', 'frame', 0, 0);
const frameChild = nodes.get('frame-child');
adapter._getFrameChildNodes = () => [frameChild];
assert.deepEqual(
    adapter._getGroupMovementNodes([frame]).map((node) => node.getAttr('elementId')),
    ['frame', 'frame-child'],
);

// Proxy dragstart Transformer должен принадлежать уже созданной сессии.
const activeState = { ...adapter.groupDragState, marker: 'active' };
adapter.groupDragState = activeState;
adapter.groupDragNodes = new WeakSet([nodes.get('second')]);
adapter.groupDragSourceNode = nodes.get('source');
assert.equal(
    adapter._startGroupDrag(nodes.get('second'), 'second', [...nodes.values()].slice(0, 3)),
    true,
);
assert.equal(adapter.groupDragState, activeState);

// Полная последовательность Konva: dragstart источника создаёт состояние,
// затем proxy dragstart соседнего узла не имеет права его заменить.
const lifecycleSource = createNode('lifecycle-source', 'shape', 12, 18);
const lifecycleSibling = createNode('lifecycle-sibling', 'shape', 80, 90);
const lifecycleAdapter = Object.create(CanvasAdapter.prototype);
lifecycleAdapter.selectedElementIds = ['lifecycle-source', 'lifecycle-sibling'];
lifecycleAdapter.groupDragState = null;
lifecycleAdapter.groupDragNodes = new WeakSet();
lifecycleAdapter.groupDragSourceNode = null;
lifecycleAdapter.groupDragInitiator = null;
lifecycleAdapter.frameDragState = { marker: 'old-frame-drag' };
assert.equal(lifecycleAdapter._startGroupDrag(
    lifecycleSource,
    'lifecycle-source',
    [lifecycleSource, lifecycleSibling],
), true);
const lifecycleState = lifecycleAdapter.groupDragState;
assert.equal(lifecycleState.sourceElementId, 'lifecycle-source');
assert.equal(lifecycleAdapter.groupDragSourceNode, lifecycleSource);
assert.equal(lifecycleAdapter.frameDragState, null);
assert.equal(lifecycleAdapter._startGroupDrag(
    lifecycleSibling,
    'lifecycle-sibling',
    [lifecycleSource, lifecycleSibling],
), true);
assert.equal(lifecycleAdapter.groupDragState, lifecycleState);
assert.equal(lifecycleAdapter.groupDragState.sourceElementId, 'lifecycle-source');

// Общая область Transformer может получить dragstart после одного из узлов.
// Активная сессия должна переключиться в режим selection, чтобы dragmove
// пересчитывал направляющие для bounding box всей группы.
assert.equal(lifecycleAdapter._startGroupDrag(
    lifecycleSource,
    'lifecycle-source',
    [lifecycleSource, lifecycleSibling],
    { initiator: 'selection' },
), true);
assert.equal(lifecycleAdapter.groupDragState, lifecycleState);
assert.equal(lifecycleAdapter.groupDragState.initiator, 'selection');
assert.equal(lifecycleAdapter.groupDragInitiator, 'selection');

// Drag за общую область Transformer подавляет node-события всех участников и
// фиксирует их координаты одной групповой командой.
const selectionSource = createNode('selection-source', 'shape', 20, 30, false, 37);
const selectionSibling = createNode('selection-sibling', 'shape', 90, 110, false, 318);
const selectionNodes = [selectionSource, selectionSibling];
const selectionAdapter = Object.create(CanvasAdapter.prototype);
selectionAdapter.nodesById = new Map(selectionNodes.map((node) => [node.getAttr('elementId'), node]));
selectionAdapter.selectedElementIds = selectionNodes.map((node) => node.getAttr('elementId'));
selectionAdapter.groupDragState = null;
selectionAdapter.groupDragNodes = new WeakSet();
selectionAdapter.groupDragSourceNode = null;
selectionAdapter.groupDragInitiator = null;
selectionAdapter.frameDragState = null;
selectionAdapter._getSelectedNodes = () => selectionNodes;
selectionAdapter._snap = (value) => value;
selectionAdapter.contentLayer = {
    findOne: (predicate) => selectionNodes.find(predicate),
    batchDraw: () => {},
};
selectionAdapter.uiLayer = { batchDraw: () => {} };
selectionAdapter.transformer = { forceUpdate: () => {} };
selectionAdapter._syncHyperlinkIndicator = () => {};
selectionAdapter._renderSelectionOutlines = () => {};
let selectionCommit = null;
selectionAdapter.onCommitMany = (updates, label) => {
    selectionCommit = { updates, label };
};
assert.equal(selectionAdapter._startTransformerSelectionDrag(), true);
assert.equal(selectionAdapter.groupDragInitiator, 'selection');
assert.equal(selectionAdapter._shouldIgnoreGroupNodeDragEvent(selectionSource), true);
assert.equal(selectionAdapter._shouldIgnoreGroupNodeDragEvent(selectionSibling), true);
selectionSource.position({ x: 55, y: 70 });
selectionSibling.position({ x: 125, y: 150 });
// Имитируем побочный эффект Transformer: во время общего drag он временно
// сбросил углы отдельных объектов.
selectionSource.rotation(0);
selectionSibling.rotation(0);
assert.equal(selectionAdapter._finishTransformerSelectionDrag(), true);
assert.equal(selectionSource.rotation(), 37);
assert.equal(selectionSibling.rotation(), 318);
assert.deepEqual(selectionCommit, {
    label: 'Перемещение группы объектов',
    updates: [
        { elementId: 'selection-source', patch: { x: 55, y: 70, rotation: 37 } },
        { elementId: 'selection-sibling', patch: { x: 125, y: 150, rotation: 318 } },
    ],
});
assert.equal(selectionAdapter.groupDragState, null);
assert.equal(selectionAdapter._shouldIgnoreGroupNodeDragEvent(selectionSource), true);

const selectionConfigAdapter = Object.create(CanvasAdapter.prototype);
selectionConfigAdapter.nodesById = new Map(selectionNodes.map((node) => [node.getAttr('elementId'), node]));
selectionConfigAdapter.interactionEnabled = true;
selectionConfigAdapter.contentLayer = {
    findOne: (predicate) => selectionNodes.find(predicate),
};
selectionConfigAdapter.uiLayer = { batchDraw: () => {} };
selectionConfigAdapter._syncNodeDraggability = () => {};
selectionConfigAdapter._renderSelectionOutlines = () => {};
selectionConfigAdapter._renderArrowControlHandles = () => {};
selectionConfigAdapter._notifySelectionBoundsChange = () => {};
const transformerConfig = {
    overdraw: null,
    listening: null,
    rotateEnabled: null,
    nodes: [],
};
selectionConfigAdapter.transformer = {
    keepRatio: () => {},
    shouldOverdrawWholeArea: (value) => { transformerConfig.overdraw = value; },
    rotateEnabled: (value) => { transformerConfig.rotateEnabled = value; },
    enabledAnchors: () => {},
    nodes: (value) => { transformerConfig.nodes = value; },
    listening: (value) => { transformerConfig.listening = value; },
};
selectionConfigAdapter.setSelections(['selection-source', 'selection-sibling']);
assert.equal(transformerConfig.overdraw, true);
assert.equal(transformerConfig.listening, true);
assert.equal(transformerConfig.rotateEnabled, false);
assert.deepEqual(transformerConfig.nodes, selectionNodes);

console.log('group drag regression: PASS');
