import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    normalizeObjectHyperlink,
    openObjectHyperlink,
} from '../assets/js/editor/canvas-adapter.js';

assert.equal(normalizeObjectHyperlink(' https://example.com/catalog?q=1 '), 'https://example.com/catalog?q=1');
assert.equal(normalizeObjectHyperlink('http://example.com'), 'http://example.com/');
assert.equal(normalizeObjectHyperlink('javascript:alert(1)'), null);
assert.equal(normalizeObjectHyperlink('data:text/html,test'), null);
assert.equal(normalizeObjectHyperlink('not-a-link'), null);

const calls = [];
const openedWindow = { opener: {} };
assert.equal(openObjectHyperlink('https://example.com/item', (...args) => {
    calls.push(args);
    return openedWindow;
}), true);
assert.deepEqual(calls, [[
    'https://example.com/item',
    '_blank',
    'noopener,noreferrer',
]]);
assert.equal(openedWindow.opener, null);

assert.equal(openObjectHyperlink('javascript:alert(1)', () => {
    throw new Error('Опасная ссылка не должна открываться.');
}), false);

const adapterSource = await readFile(
    new URL('../assets/js/editor/canvas-adapter.js', import.meta.url),
    'utf8',
);
assert.match(adapterSource, /indicator\.on\('click\.hyperlink tap\.hyperlink'/);
assert.match(adapterSource, /indicator\.on\('mouseenter\.hyperlink'/);
assert.match(adapterSource, /tooltip\.visible\(true\)/);
assert.match(adapterSource, /text: hyperlink/);
assert.match(adapterSource, /this\._syncHyperlinkIndicatorVisibility\(\)/);
assert.match(adapterSource, /const visible = selectedIds\.has\(elementId\)/);
assert.match(adapterSource, /event\.cancelBubble = true/);

console.log('object hyperlink: PASS');
