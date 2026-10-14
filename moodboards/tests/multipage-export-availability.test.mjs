import assert from 'node:assert/strict';
import fs from 'node:fs';

import { selectFilledPages } from '../assets/js/editor/preview-manager.js';

const document = {
    pages: [
        { id: 'filled', elements: [{ id: 'shape-1', type: 'shape' }] },
        { id: 'initially-empty', elements: [] },
    ],
};

assert.equal(selectFilledPages(document).length > 1, false);
document.pages[1].elements.push({ id: 'image-1', type: 'image' });
assert.equal(selectFilledPages(document).length > 1, true);

const uiControllerSource = fs.readFileSync(
    new URL('../assets/js/editor/ui-controller.js', import.meta.url),
    'utf8',
);
assert.match(
    uiControllerSource,
    /if \(this\.exportOpen\) \{\s*this\._renderMultipagePdfAvailability\(\);/,
    'Export menu must re-check filled pages immediately before opening.',
);

console.log('multipage export availability: PASS');
