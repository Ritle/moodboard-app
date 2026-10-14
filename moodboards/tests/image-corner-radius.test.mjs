import assert from 'node:assert/strict';
import {
    createMoodboardDocument,
    MoodboardValidationError,
} from '../assets/js/models/moodboard-document.js';

const image = {
    id: 'rounded-image',
    type: 'image',
    assetId: 'asset-rounded-image',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    cornerRadius: 24,
};

const document = createMoodboardDocument({ elements: [image] });
assert.equal(document.pages[0].elements[0].cornerRadius, 24);

for (const cornerRadius of [-1, 1001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
        () => createMoodboardDocument({ elements: [{ ...image, cornerRadius }] }),
        MoodboardValidationError,
    );
}

console.log('image corner radius: PASS');
