import assert from 'node:assert/strict';

import {
    BINDING_GUIDE_ANCHORS,
    BINDING_GUIDE_TARGET_TYPES,
    calculatePerpendicularBindingGuides,
    resolveBindingGuideAnchor,
} from '../assets/js/editor/binding-guide-utils.js';
import {
    calculateBindingGuideSearchRadius,
    calculateBindingGuideTolerance,
} from '../assets/js/editor/canvas-adapter.js';

assert.equal(BINDING_GUIDE_ANCHORS.length, 12);
for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.deepEqual(
        BINDING_GUIDE_ANCHORS.filter((anchor) => anchor.side === side).map((anchor) => anchor.slot),
        ['start', 'center', 'end'],
        `На стороне ${side} должны быть крайняя, центральная и крайняя точки.`,
    );
}

const source = {
    id: 'source', type: 'shape', x: 0, y: 0, width: 100, height: 100, rotation: 0,
};
const target = {
    id: 'target', type: 'image', x: 205, y: 3, width: 100, height: 100, rotation: 0,
};

const basic = calculatePerpendicularBindingGuides(source, [target], {
    maxDistance: 360,
    snapTolerance: 8,
});
assert.deepEqual(basic.delta, { x: 0, y: 3 });
assert.equal(basic.guides.length, 1);
assert.deepEqual(basic.guides[0].from, { x: 100, y: 53 });
assert.deepEqual(basic.guides[0].to, { x: 205, y: 53 });
assert.equal(basic.guides[0].sourceSide, 'right');
assert.equal(basic.guides[0].targetSide, 'left');
assert.equal(basic.guides[0].kind, 'facing');

assert.equal(calculateBindingGuideTolerance(true, 1), 8);
assert.equal(calculateBindingGuideTolerance(false, 1), 0.5);
assert.equal(calculateBindingGuideTolerance(false, 0.5), 1);
assert.equal(calculateBindingGuideSearchRadius(1), 720);
assert.equal(calculateBindingGuideSearchRadius(0.5), 1440);

const unalignedWithoutSnap = calculatePerpendicularBindingGuides(source, [target], {
    maxDistance: 360,
    snapTolerance: calculateBindingGuideTolerance(false, 1),
});
assert.equal(unalignedWithoutSnap.guides.length, 0, 'Линия без snap не должна отрываться от точки объекта.');
assert.deepEqual(source, {
    id: 'source', type: 'shape', x: 0, y: 0, width: 100, height: 100, rotation: 0,
}, 'Режим показа линий не должен менять исходный объект.');

const topAligned = calculatePerpendicularBindingGuides(
    source,
    [{ ...target, id: 'top-target', y: 0, height: 150 }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(topAligned.delta, { x: 0, y: 0 });
assert.equal(topAligned.guides.length, 1);
assert.equal(topAligned.guides[0].kind, 'edge-alignment');
assert.equal(topAligned.guides[0].sourceSide, 'top');
assert.equal(topAligned.guides[0].targetSide, 'top');
assert.deepEqual(topAligned.guides[0].from, { x: 100, y: 0 });
assert.deepEqual(topAligned.guides[0].to, { x: 205, y: 0 });

const bottomAligned = calculatePerpendicularBindingGuides(
    source,
    [{ ...target, id: 'bottom-target', y: -50, height: 150 }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(bottomAligned.delta, { x: 0, y: 0 });
assert.equal(bottomAligned.guides.length, 1);
assert.equal(bottomAligned.guides[0].kind, 'edge-alignment');
assert.equal(bottomAligned.guides[0].sourceSide, 'bottom');
assert.equal(bottomAligned.guides[0].targetSide, 'bottom');
assert.deepEqual(bottomAligned.guides[0].from, { x: 100, y: 100 });
assert.deepEqual(bottomAligned.guides[0].to, { x: 205, y: 100 });

const bottomSnap = calculatePerpendicularBindingGuides(
    source,
    [{ ...target, id: 'bottom-snap-target', y: -44, height: 150 }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(bottomSnap.delta, { x: 0, y: 6 });
assert.equal(bottomSnap.guides[0].sourceSide, 'bottom');
assert.deepEqual(bottomSnap.guides[0].from, { x: 100, y: 106 });
assert.deepEqual(bottomSnap.guides[0].to, { x: 205, y: 106 });

const leftAligned = calculatePerpendicularBindingGuides(
    source,
    [{ ...target, id: 'left-target', x: 0, y: 205, width: 150 }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(leftAligned.delta, { x: 0, y: 0 });
assert.equal(leftAligned.guides[0].kind, 'edge-alignment');
assert.equal(leftAligned.guides[0].sourceSide, 'left');
assert.equal(leftAligned.guides[0].targetSide, 'left');
assert.deepEqual(leftAligned.guides[0].from, { x: 0, y: 100 });
assert.deepEqual(leftAligned.guides[0].to, { x: 0, y: 205 });

const rightAligned = calculatePerpendicularBindingGuides(
    source,
    [{ ...target, id: 'right-target', x: -50, y: 205, width: 150 }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(rightAligned.delta, { x: 0, y: 0 });
assert.equal(rightAligned.guides[0].kind, 'edge-alignment');
assert.equal(rightAligned.guides[0].sourceSide, 'right');
assert.equal(rightAligned.guides[0].targetSide, 'right');
assert.deepEqual(rightAligned.guides[0].from, { x: 100, y: 100 });
assert.deepEqual(rightAligned.guides[0].to, { x: 100, y: 205 });

const rotatedTarget = {
    id: 'rotated-target', type: 'shape', x: 305, y: 100, width: 100, height: 100, rotation: 180,
};
const rotated = calculatePerpendicularBindingGuides(source, [rotatedTarget], {
    maxDistance: 360,
    snapTolerance: 1,
});
assert.equal(rotated.guides.length, 1);
assert.equal(rotated.guides[0].sourceSide, 'right');
assert.equal(rotated.guides[0].targetSide, 'right');
assert.ok(Math.abs(rotated.guides[0].to.x - 205) < 0.0001);
assert.ok(Math.abs(rotated.guides[0].to.y - 50) < 0.0001);

const quarterTurn = calculatePerpendicularBindingGuides(
    { ...source, rotation: 90 },
    [{ ...target, id: 'quarter-turn-target', x: -100, y: 205, rotation: 0 }],
    { maxDistance: 360, snapTolerance: 1 },
);
assert.equal(quarterTurn.guides.length, 1);
assert.equal(quarterTurn.guides[0].sourceSide, 'right');
assert.equal(quarterTurn.guides[0].targetSide, 'top');

const flipped = calculatePerpendicularBindingGuides(
    { ...source, flipX: true, flipY: true },
    [{ ...target, flipX: true, flipY: true }],
    { maxDistance: 360, snapTolerance: 8 },
);
assert.deepEqual(flipped, basic, 'Отражение содержимого не должно менять геометрию внешних сторон.');

const horizontalTarget = {
    id: 'horizontal-target', type: 'text', x: 205, y: 3, width: 100, height: 100, rotation: 0,
};
const verticalTarget = {
    id: 'vertical-target', type: 'sticker', x: 4, y: 205, width: 100, height: 100, rotation: 0,
};
const twoAxes = calculatePerpendicularBindingGuides(source, [horizontalTarget, verticalTarget], {
    maxDistance: 360,
    snapTolerance: 8,
});
assert.deepEqual(twoAxes.delta, { x: 4, y: 3 });
assert.equal(twoAxes.guides.length, 2);
for (const guide of twoAxes.guides) {
    const horizontal = Math.abs(guide.from.y - guide.to.y) < 0.0001;
    const vertical = Math.abs(guide.from.x - guide.to.x) < 0.0001;
    assert.equal(horizontal || vertical, true, 'После коррекции линия должна быть строго перпендикулярной.');
}

assert.equal(
    calculatePerpendicularBindingGuides(source, [target], {
        maxDistance: 100,
        snapTolerance: 8,
    }).guides.length,
    0,
    'Ограничение расстояния должно применяться вдоль нормали.',
);
assert.equal(
    calculatePerpendicularBindingGuides(source, [{ ...target, y: 9 }], {
        maxDistance: 360,
        snapTolerance: 8,
    }).guides.length,
    0,
    'Допуск должен быть фиксированным расстоянием, а не зависеть от длины линии.',
);

for (const type of BINDING_GUIDE_TARGET_TYPES) {
    const result = calculatePerpendicularBindingGuides(
        source,
        [{ ...target, id: `target-${type}`, type }],
        { maxDistance: 360, snapTolerance: 8 },
    );
    assert.equal(result.guides.length, 1, `Тип ${type} должен участвовать в направляющих.`);
}

const rotatedAnchor = resolveBindingGuideAnchor(
    { ...source, rotation: 90 },
    { side: 'right', axis: 'local-y', x: 1, y: 0.5, normalX: 1, normalY: 0 },
);
assert.ok(Math.abs(rotatedAnchor.point.x + 50) < 0.0001);
assert.ok(Math.abs(rotatedAnchor.point.y - 100) < 0.0001);
assert.ok(Math.abs(rotatedAnchor.normal.x) < 0.0001);
assert.ok(Math.abs(rotatedAnchor.normal.y - 1) < 0.0001);

console.log('perpendicular binding guides: PASS');
