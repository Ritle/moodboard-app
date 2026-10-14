import assert from 'node:assert/strict';

import {
    createMoodboardDocument,
    MoodboardValidationError,
    validateMoodboardDocument,
} from '../assets/js/models/moodboard-document.js';
import {
    getFrameClipPolygon,
    isElementInsideFrame,
    isFrameClippingEnabled,
    moveFrameBehindContents,
    syncElementFrameMembership,
} from '../assets/js/editor/frame-utils.js';

function frame(id, x, y, overrides = {}) {
    return {
        id,
        type: 'frame',
        name: `Фрейм ${id}`,
        x,
        y,
        width: 200,
        height: 120,
        rotation: 0,
        opacity: 1,
        stroke: '#3183ff',
        backgroundColor: '#ffffff',
        backgroundOpacity: 0,
        clipContent: true,
        layoutGridColumns: 4,
        layoutGridGap: 16,
        layoutGridPadding: 16,
        locked: false,
        ...overrides,
    };
}

function shape(id, x, y, overrides = {}) {
    return {
        id,
        type: 'shape',
        shapeType: 'rectangle',
        x,
        y,
        width: 40,
        height: 40,
        rotation: 0,
        opacity: 1,
        fill: '#8094b1',
        stroke: '#707070',
        strokeWidth: 1,
        locked: false,
        ...overrides,
    };
}

{
    const rotatedFrame = frame('rotated', 100, 100, { rotation: 90 });
    const polygon = getFrameClipPolygon(rotatedFrame);
    assert.deepEqual(
        polygon.map(({ x, y }) => [Math.round(x), Math.round(y)]),
        [[100, 100], [100, 300], [-20, 300], [-20, 100]],
    );
    assert.equal(isElementInsideFrame(shape('inside', 30, 140), rotatedFrame), true);
    assert.equal(isElementInsideFrame(shape('outside', 140, 140), rotatedFrame), false);
    assert.equal(isFrameClippingEnabled(rotatedFrame), true);
    assert.equal(isFrameClippingEnabled({ ...rotatedFrame, clipContent: false }), false);
}

{
    const firstFrame = frame('a', 0, 0);
    const secondFrame = frame('b', 300, 0);
    const moving = shape('moving', 30, 30, { frameId: firstFrame.id });
    const elements = [firstFrame, moving, secondFrame];
    moving.x = 340;
    moving.y = 30;
    const targetFrameId = syncElementFrameMembership(elements, moving.id);
    assert.equal(targetFrameId, secondFrame.id);
    assert.equal(moving.frameId, secondFrame.id);
    moveFrameBehindContents(elements, targetFrameId);
    assert.ok(
        elements.findIndex(({ id }) => id === secondFrame.id)
            < elements.findIndex(({ id }) => id === moving.id),
        'Новый фрейм должен оставаться под перенесённым объектом.',
    );

    moving.x = 620;
    assert.equal(syncElementFrameMembership(elements, moving.id), null);
    assert.equal(Object.hasOwn(moving, 'frameId'), false);
}

{
    const document = createMoodboardDocument({
        elements: [frame('validated', 0, 0), shape('child', 40, 40, { frameId: 'validated' })],
    });
    assert.equal(validateMoodboardDocument(document), true);

    document.pages[0].elements[0].layoutGridColumns = 13;
    assert.throws(
        () => validateMoodboardDocument(document),
        (error) => error instanceof MoodboardValidationError,
    );

    document.pages[0].elements[0].layoutGridColumns = 4;
    document.pages[0].elements[0].backgroundOpacity = 1.5;
    assert.throws(
        () => validateMoodboardDocument(document),
        (error) => error instanceof MoodboardValidationError,
    );
}

console.log('frame clipping and layout grid: PASS');
