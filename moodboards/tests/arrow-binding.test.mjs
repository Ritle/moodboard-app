import assert from 'node:assert/strict';

import { denormalizeArrowPoints, normalizeArrowPoints } from '../assets/js/editor/arrow-utils.js';
import {
    createMoodboardDocument,
    validateMoodboardDocument,
} from '../assets/js/models/moodboard-document.js';
import {
    ARROW_BINDING_ANCHORS,
    detachArrowBindingsForIndependentMove,
    findNearestArrowBinding,
    reconcileArrowBindings,
    remapArrowBindings,
    resolveElementAnchor,
} from '../assets/js/editor/arrow-binding-utils.js';
import { CommandManager } from '../assets/js/editor/command-manager.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';

const target = {
    id: 'target', type: 'shape', shapeType: 'rectangle',
    x: 100, y: 100, width: 200, height: 100, rotation: 0,
};
assert.equal(ARROW_BINDING_ANCHORS.length, 8);
assert.equal(
    new Set(ARROW_BINDING_ANCHORS.map(({ x, y }) => `${x}:${y}`)).size,
    8,
    'Визуальные точки привязки стрелки не должны дублироваться в углах.',
);
assert.deepEqual(resolveElementAnchor(target, { x: 1, y: 0.5 }), { x: 300, y: 150 });
assert.deepEqual(
    resolveElementAnchor({ ...target, rotation: 90 }, { x: 1, y: 0.5 }),
    { x: 50.000000000000014, y: 300 },
);

const snap = findNearestArrowBinding([target], { x: 306, y: 151 }, 10);
assert.equal(snap.binding.targetElementId, 'target');
assert.deepEqual(snap.binding.anchor, { x: 1, y: 0.5 });
assert.equal(findNearestArrowBinding([target], { x: 330, y: 150 }, 10), null);
const cornerSnap = findNearestArrowBinding([target], { x: 104, y: 103 }, 10);
assert.deepEqual(cornerSnap.binding.anchor, { x: 0, y: 0 });
assert.deepEqual(
    remapArrowBindings(
        { start: { targetElementId: 'target', anchor: { x: 1, y: 0.5 } } },
        new Map([['target', 'target-copy']]),
    ),
    { start: { targetElementId: 'target-copy', anchor: { x: 1, y: 0.5 } } },
);
assert.deepEqual(
    remapArrowBindings(
        { start: { targetElementId: 'target', anchor: { x: 1, y: 0.5 } } },
        new Map(),
    ),
    {},
);

const geometry = normalizeArrowPoints([
    { x: 300, y: 150 },
    { x: 400, y: 120 },
    { x: 500, y: 150 },
]);
const arrow = {
    id: 'arrow', type: 'arrow', ...geometry, rotation: 0,
    stroke: '#282828', strokeWidth: 5, startCap: 'none', endCap: 'arrow1',
    bindings: {
        start: { targetElementId: 'target', anchor: { x: 1, y: 0.5 } },
    },
};
const validDocument = createMoodboardDocument({ elements: [target, arrow] });
assert.equal(validateMoodboardDocument(validDocument), true);
const invalidDocument = structuredClone(validDocument);
invalidDocument.pages[0].elements[1].bindings.start.targetElementId = 'missing';
assert.throws(
    () => validateMoodboardDocument(invalidDocument),
    /поддерживаемый объект того же листа/,
);
const previousElements = [structuredClone(target), structuredClone(arrow)];
const nextElements = [{ ...target, x: 120 }, structuredClone(arrow)];
assert.equal(reconcileArrowBindings(nextElements, previousElements), true);
const movedPoints = denormalizeArrowPoints(nextElements[1]);
assert.deepEqual(movedPoints[0], { x: 320, y: 150 });
assert.deepEqual(movedPoints[1], { x: 410, y: 120 });
assert.deepEqual(movedPoints[2], { x: 500, y: 150 });

const orphanedArrow = structuredClone(arrow);
assert.equal(reconcileArrowBindings([orphanedArrow], [target, arrow]), true);
assert.equal(orphanedArrow.bindings, undefined);
assert.deepEqual(denormalizeArrowPoints(orphanedArrow), denormalizeArrowPoints(arrow));

const store = new EditorStore();
store.loadMoodboard({ id: 'board', title: 'Board', revision: 0, document: validDocument });
const commands = new CommandManager(store);
assert.equal(commands.execute('Перемещение цели', (page) => {
    page.elements.find(({ id }) => id === 'target').x += 20;
}), true);
assert.deepEqual(
    denormalizeArrowPoints(store.getElement('arrow'))[0],
    { x: 320, y: 150 },
);
assert.equal(commands.undo(), true);
assert.equal(store.getElement('target').x, 100);
assert.deepEqual(
    denormalizeArrowPoints(store.getElement('arrow'))[0],
    { x: 300, y: 150 },
);
commands.destroy();

const independentlyMovedArrow = structuredClone(arrow);
independentlyMovedArrow.bindings.end = {
    targetElementId: 'other-target',
    anchor: { x: 0, y: 0.5 },
};
assert.equal(
    detachArrowBindingsForIndependentMove(independentlyMovedArrow, { x: 340 }, ['target']),
    true,
);
assert.deepEqual(Object.keys(independentlyMovedArrow.bindings), ['start']);
assert.equal(
    detachArrowBindingsForIndependentMove(independentlyMovedArrow, { points: [...arrow.points] }, []),
    false,
);

console.log('arrow bindings: PASS');
