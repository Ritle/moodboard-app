import assert from 'node:assert/strict';

import { AsyncTaskQueue } from '../assets/js/editor/async-task-queue.js';
import { planElementReconciliation } from '../assets/js/editor/canvas-reconciliation-utils.js';

const initial = planElementReconciliation(new Map(), [
    { id: 'a', type: 'shape', x: 0 },
    { id: 'b', type: 'text', text: 'Текст' },
]);
assert.deepEqual(initial.added.map(({ id }) => id), ['a', 'b']);

const update = planElementReconciliation(initial.nextFingerprints, [
    { id: 'a', type: 'shape', x: 10 },
    { id: 'c', type: 'image', assetId: 'asset-c' },
]);
assert.deepEqual(update.changed.map(({ id }) => id), ['a']);
assert.deepEqual(update.added.map(({ id }) => id), ['c']);
assert.deepEqual(update.removedIds, ['b']);

const largeScene = Array.from({ length: 300 }, (_, index) => ({
    id: `element-${index}`,
    type: index % 3 === 0 ? 'image' : 'shape',
    x: index * 3,
    y: index * 2,
    width: 120,
    height: 80,
}));
const largeInitial = planElementReconciliation(new Map(), largeScene);
const largeUpdate = planElementReconciliation(
    largeInitial.nextFingerprints,
    largeScene.map((element, index) => (index === 149 ? { ...element, x: 999 } : element)),
);
assert.deepEqual(largeUpdate.changed.map(({ id }) => id), ['element-149']);
assert.equal(largeUpdate.retained.length, 299);

let active = 0;
let maximumActive = 0;
const queue = new AsyncTaskQueue(2);
const tasks = Array.from({ length: 6 }, (_, index) => queue.enqueue(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return index;
}));
assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
assert.equal(maximumActive, 2);
queue.destroy();

console.log('canvas performance utils: PASS');
