import assert from 'node:assert/strict';

import { CanvasAdapter } from '../assets/js/editor/canvas-adapter.js';

function createAnchorHarness(overrides = {}) {
    return {
        arrowToolEnabled: false,
        brushSuspended: false,
        destroyed: false,
        shown: 0,
        hidden: 0,
        _showArrowBindingAnchors() { this.shown += 1; },
        _hideArrowBindingAnchors() { this.hidden += 1; },
        ...overrides,
    };
}

const activeHarness = createAnchorHarness({ arrowToolEnabled: true });
CanvasAdapter.prototype._syncArrowToolBindingAnchors.call(activeHarness);
assert.equal(activeHarness.shown, 1, 'Активный инструмент должен сразу показывать точки привязки.');
assert.equal(activeHarness.hidden, 0);

for (const state of [
    { arrowToolEnabled: false },
    { arrowToolEnabled: true, brushSuspended: true },
    { arrowToolEnabled: true, destroyed: true },
]) {
    const harness = createAnchorHarness(state);
    CanvasAdapter.prototype._syncArrowToolBindingAnchors.call(harness);
    assert.equal(harness.shown, 0);
    assert.equal(harness.hidden, 1, 'Неактивный инструмент не должен оставлять точки привязки.');
}

let synchronized = 0;
const activationHarness = {
    arrowToolEnabled: false,
    _cancelArrowDraft() { throw new Error('Активация не должна отменять черновик.'); },
    _syncArrowToolBindingAnchors() { synchronized += 1; },
};
CanvasAdapter.prototype.setArrowToolEnabled.call(activationHarness, true);
assert.equal(activationHarness.arrowToolEnabled, true);
assert.equal(synchronized, 1);

let refreshedSelection = null;
const arrowNode = { getAttr: (name) => (name === 'elementType' ? 'arrow' : null) };
const refreshHarness = {
    destroyed: false,
    selectedElementIds: ['new-arrow'],
    nodesById: new Map([['new-arrow', arrowNode]]),
    arrowControlHandles: [{}, {}, {}],
    setSelections(elementIds) { refreshedSelection = [...elementIds]; },
};
assert.equal(CanvasAdapter.prototype._refreshSelectedArrowControls.call(refreshHarness), true);
assert.deepEqual(refreshedSelection, ['new-arrow']);

console.log('arrow tool anchors: PASS');
