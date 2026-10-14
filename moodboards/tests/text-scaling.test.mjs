import assert from 'node:assert/strict';

import { calculateScaledTextFontSize } from '../assets/js/editor/canvas-adapter.js';

assert.equal(calculateScaledTextFontSize(24, 100, 150), 36);
assert.equal(calculateScaledTextFontSize(32, 80, 40), 16);
assert.equal(calculateScaledTextFontSize(17, 60, 90), 26);

assert.equal(
    calculateScaledTextFontSize(200, 100, 200),
    240,
    'Размер шрифта не должен превышать ограничение тулбара.',
);
assert.equal(
    calculateScaledTextFontSize(12, 100, 20),
    8,
    'Размер шрифта не должен становиться меньше ограничения тулбара.',
);
assert.equal(calculateScaledTextFontSize(24, 100, 100), 24);

console.log('text transform scaling: PASS');
