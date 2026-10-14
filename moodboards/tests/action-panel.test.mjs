import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveActionPanelActiveTool } from '../assets/js/editor/ui-controller.js';

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
const panelMatch = editorMarkup.match(/<nav class="action-panel"[\s\S]*?<\/nav>/);
assert.ok(panelMatch, 'Нижняя панель инструментов не найдена.');

const panel = panelMatch[0];
const expectedTools = [
    'data-action="select-images"',
    'data-action-popover="shapes"',
    'data-action="add-text"',
    'data-tool="brush"',
    'data-tool="arrow"',
    'data-tool="frame"',
    'data-action-popover="more"',
    'data-tool="select"',
    'data-tool="hand"',
];

let previousIndex = -1;
for (const marker of expectedTools) {
    const index = panel.indexOf(marker);
    assert.ok(index > previousIndex, `Инструмент ${marker} отсутствует или расположен неверно.`);
    previousIndex = index;
}

assert.match(panel, /data-action="add-text"[^>]*aria-label="Добавить текст"/);
assert.match(panel, /data-action="add-text"[^>]*data-tooltip="Текст"/);

for (const indicator of ['image', 'shape', 'text', 'brush', 'arrow', 'frame', 'more', 'select', 'hand']) {
    assert.match(panel, new RegExp(`data-tool-indicator="${indicator}"`));
}

assert.equal(resolveActionPanelActiveTool({ activeTool: 'select' }), 'select');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'brush' }), 'brush');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'placement', placementKind: 'shape' }), 'shape');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'placement', placementKind: 'text' }), 'text');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'placement', placementKind: 'sticker' }), 'more');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'highlighter' }), 'more');
assert.equal(resolveActionPanelActiveTool({ activeTool: 'arrow', uploadActive: true }), 'image');

console.log('action panel tools: PASS');
