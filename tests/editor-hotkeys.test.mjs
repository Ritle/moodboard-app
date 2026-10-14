import assert from 'node:assert/strict';

import { resolveEditorHotkey } from '../assets/js/editor/ui-controller.js';

assert.equal(resolveEditorHotkey({ code: 'ArrowUp' }), 'bring-to-front');
assert.equal(resolveEditorHotkey({ code: 'ArrowDown' }), 'send-to-back');
assert.equal(resolveEditorHotkey({ code: 'ArrowUp', shiftKey: true }), 'bring-forward');
assert.equal(resolveEditorHotkey({ code: 'ArrowDown', shiftKey: true }), 'send-backward');

assert.equal(resolveEditorHotkey({ code: 'BracketRight' }), null);
assert.equal(resolveEditorHotkey({ code: 'BracketLeft' }), null);
assert.equal(resolveEditorHotkey({ code: 'BracketRight', altKey: true }), null);
assert.equal(resolveEditorHotkey({ code: 'BracketLeft', altKey: true }), null);
assert.equal(resolveEditorHotkey({ code: 'ArrowUp', ctrlKey: true }), null);

console.log('Editor hotkey checks passed.');
