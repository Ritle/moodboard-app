import assert from 'node:assert/strict';

import {
    accumulateRotationDelta,
    CanvasAdapter,
    constrainPointToCircle,
    createGroupRotationUpdates,
    createRotationDragPatch,
    createRotationPatch,
    snapRotationToKeyAngle,
} from '../assets/js/editor/canvas-adapter.js';

const groupRotation = createGroupRotationUpdates([
    { id: 'left', x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    { id: 'right', x: 100, y: 0, width: 20, height: 20, rotation: 0 },
], 90, { x: 60, y: 10 });
assert.deepEqual(groupRotation, [
    { elementId: 'left', patch: { x: 70, y: -50, rotation: 90 } },
    { elementId: 'right', patch: { x: 70, y: 50, rotation: 90 } },
]);

function centerOf(element) {
    const radians = element.rotation * Math.PI / 180;
    return {
        x: element.x
            + Math.cos(radians) * element.width / 2
            - Math.sin(radians) * element.height / 2,
        y: element.y
            + Math.sin(radians) * element.width / 2
            + Math.cos(radians) * element.height / 2,
    };
}

function assertClose(actual, expected, tolerance = 0.0001) {
    assert(
        Math.abs(actual - expected) < tolerance,
        `Expected ${actual} to be close to ${expected}`,
    );
}

function assertSameCenter(before, after) {
    const previousCenter = centerOf(before);
    const nextCenter = centerOf({ ...before, ...after });
    assert(Math.abs(previousCenter.x - nextCenter.x) < 0.0001);
    assert(Math.abs(previousCenter.y - nextCenter.y) < 0.0001);
}

function pointAt(center, degrees, radius = 80) {
    const radians = degrees * Math.PI / 180;
    return {
        x: center.x + Math.cos(radians) * radius,
        y: center.y + Math.sin(radians) * radius,
    };
}

const element = {
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    rotation: 0,
};
const clockwise = createRotationPatch(element, 90);
assert.deepEqual(clockwise, { x: 90, y: 0, rotation: 90 });
assertSameCenter(element, clockwise);

const center = centerOf(element);
const arbitrary = createRotationDragPatch(
    element,
    pointAt(center, 90),
    pointAt(center, 137),
);
assert.equal(arbitrary.rotation, 47);
assertSameCenter(element, arbitrary);

const counterClockwise = createRotationDragPatch(
    element,
    pointAt(center, 90),
    pointAt(center, 24),
);
assert.equal(counterClockwise.rotation, 294);
assertSameCenter(element, counterClockwise);

const initiallyRotated = { ...element, rotation: 32 };
const rotatedCenter = centerOf(initiallyRotated);
const snapped = createRotationDragPatch(
    initiallyRotated,
    pointAt(rotatedCenter, 90),
    pointAt(rotatedCenter, 137),
    15,
);
assert.equal(snapped.rotation, 75);
assertSameCenter(initiallyRotated, snapped);

assert.equal(snapRotationToKeyAngle(2), 0);
assert.equal(snapRotationToKeyAngle(43), 45);
assert.equal(snapRotationToKeyAngle(50), 50);
assert.equal(snapRotationToKeyAngle(88), 90);
assert.equal(snapRotationToKeyAngle(137), 135);
assert.equal(snapRotationToKeyAngle(181), 180);
assert.equal(snapRotationToKeyAngle(223), 225);
assert.equal(snapRotationToKeyAngle(268), 270);
assert.equal(snapRotationToKeyAngle(313), 315);
assert.equal(createRotationPatch(element, snapRotationToKeyAngle(358)).rotation, 0);

let accumulatedDelta = 0;
accumulatedDelta = accumulateRotationDelta(accumulatedDelta, 90, 170);
accumulatedDelta = accumulateRotationDelta(accumulatedDelta, 170, -170);
accumulatedDelta = accumulateRotationDelta(accumulatedDelta, -170, -10);
assert.equal(accumulatedDelta, 260);

const orbitCenter = { x: 100, y: 100 };
const constrainedFarPoint = constrainPointToCircle(
    orbitCenter,
    { x: 900, y: 100 },
    80,
);
assert.deepEqual(constrainedFarPoint, { x: 180, y: 100 });
assertClose(
    Math.hypot(
        constrainedFarPoint.x - orbitCenter.x,
        constrainedFarPoint.y - orbitCenter.y,
    ),
    80,
);

const constrainedDiagonalPoint = constrainPointToCircle(
    orbitCenter,
    { x: 500, y: 500 },
    80,
);
assertClose(
    Math.hypot(
        constrainedDiagonalPoint.x - orbitCenter.x,
        constrainedDiagonalPoint.y - orbitCenter.y,
    ),
    80,
);

const rotationStateAdapter = Object.create(CanvasAdapter.prototype);
rotationStateAdapter.rotationInteractionActive = false;
const rotationStates = [];
rotationStateAdapter.onRotationStateChange = (active) => rotationStates.push(active);
rotationStateAdapter._setRotationInteractionActive(true);
rotationStateAdapter._setRotationInteractionActive(true);
rotationStateAdapter._setRotationInteractionActive(false);
assert.deepEqual(rotationStates, [true, false]);

let nodePosition = { x: 0, y: 0 };
let nodeRotation = 0;
const activeRotationNode = {
    getAttr: (name) => (name === 'elementId' ? 'rotated-object' : null),
    position(nextPosition) {
        if (nextPosition) {
            nodePosition = { ...nextPosition };
        }
        return nodePosition;
    },
    rotation(nextRotation) {
        if (nextRotation !== undefined) {
            nodeRotation = nextRotation;
        }
        return nodeRotation;
    },
};
let stopDragCalls = 0;
const finishingAdapter = Object.create(CanvasAdapter.prototype);
finishingAdapter.nodesById = new Map([['rotated-object', activeRotationNode]]);
finishingAdapter.rotationInteractionActive = true;
finishingAdapter.rotationQuickControls = {
    elementId: 'rotated-object',
    dragState: {
        element: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        lastPointerAngle: 90,
        accumulatedDelta: 0,
    },
    group: {
        x: () => -20,
        y: () => 50,
        stopDrag: () => { stopDragCalls += 1; },
    },
};
finishingAdapter.contentLayer = {
    findOne: (predicate) => (predicate(activeRotationNode) ? activeRotationNode : null),
    batchDraw: () => {},
};
finishingAdapter.uiLayer = { batchDraw: () => {} };
finishingAdapter.transformer = { forceUpdate: () => {} };
finishingAdapter._syncHyperlinkIndicator = () => {};
finishingAdapter._syncArrowControlHandles = () => {};
finishingAdapter._syncRotationQuickControlConnector = () => {};
finishingAdapter._syncRotationQuickControls = () => {};
finishingAdapter._notifySelectionBoundsChange = () => {};
finishingAdapter.onRotationStateChange = () => {};
let rotationCommit = null;
finishingAdapter.onCommit = (elementId, patch, label) => {
    rotationCommit = { elementId, patch, label };
};
assert.equal(finishingAdapter._finishActiveRotation(), true);
assert.equal(stopDragCalls, 1);
assert.equal(nodeRotation, 90);
assert.deepEqual(rotationCommit, {
    elementId: 'rotated-object',
    patch: { x: 100, y: 0, rotation: 90 },
    label: 'Поворот объекта',
});
assert.equal(finishingAdapter._finishActiveRotation(), false);

const resizeStateAdapter = Object.create(CanvasAdapter.prototype);
resizeStateAdapter.resizeInteractionActive = false;
resizeStateAdapter.uiLayer = { batchDraw() {} };
resizeStateAdapter.rotationQuickControls = {
    connector: {
        visible(value) {
            this.isVisible = value;
        },
    },
    group: {
        visible(value) {
            this.isVisible = value;
        },
    },
};
resizeStateAdapter._setResizeInteractionActive(true);
assert.equal(resizeStateAdapter.resizeInteractionActive, true);
assert.equal(resizeStateAdapter.rotationQuickControls.connector.isVisible, false);
assert.equal(resizeStateAdapter.rotationQuickControls.group.isVisible, false);
resizeStateAdapter._setResizeInteractionActive(false);
assert.equal(resizeStateAdapter.rotationQuickControls.connector.isVisible, false);
assert.equal(resizeStateAdapter.rotationQuickControls.group.isVisible, true);

console.log('rotation drag control: PASS');
