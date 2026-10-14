import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
const editorStyles = await readFile(new URL('../assets/css/editor.css', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../assets/js/editor/ui-controller.js', import.meta.url), 'utf8');
const toolbarMatch = editorMarkup.match(
    /<div class="contextual-toolbar" data-role="contextual-toolbar"[\s\S]*?<form class="contextual-toolbar__link-editor"/,
);

assert.ok(toolbarMatch, 'Контекстный тулбар не найден.');
const toolbar = toolbarMatch[0];

const commonActions = [
    'data-editor-command="group"',
    'data-editor-command="ungroup"',
    'data-editor-command="duplicate"',
    'data-editor-command="send-to-back"',
    'data-editor-command="bring-to-front"',
    'data-editor-command="delete"',
    'data-object-action="toggle-contextual-more"',
];
let previousIndex = -1;
for (const marker of commonActions) {
    const index = toolbar.indexOf(marker);
    assert.ok(index > previousIndex, `${marker} отсутствует или расположен неверно.`);
    previousIndex = index;
}

assert.match(toolbar, /aria-label="ИИ удаление фона"/);
const imageToolbar = toolbar.match(
    /data-object-toolbar="image"[\s\S]*?(?=<div class="contextual-toolbar__type-controls" data-object-toolbar="shape")/,
)?.[0] || '';
assert.match(imageToolbar, /<button[\s\S]*?data-object-action="remove-background"/);
assert.ok(
    imageToolbar.indexOf('data-object-action="remove-background"')
        < imageToolbar.indexOf('data-object-action="toggle-image-eraser"')
        && imageToolbar.indexOf('data-object-action="toggle-image-eraser"')
            < imageToolbar.indexOf('data-object-action="flip-x"'),
    'Ручной ластик должен находиться сразу после ИИ-удаления фона.',
);
assert.match(editorStyles, /\.contextual-toolbar__select\s*\{[^}]*position:\s*relative/);
assert.match(editorStyles, /\.contextual-toolbar__select select\s*\{[\s\S]*?appearance:\s*none/);
assert.match(editorStyles, /\.contextual-toolbar__select::before\s*\{[\s\S]*?border-right:[\s\S]*?border-bottom:/);
assert.doesNotMatch(editorStyles, /\.contextual-toolbar__select--compact::before\s*\{/);
assert.match(
    toolbar,
    /class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--frame-grid"[\s\S]*?data-object-property="layoutGridColumns"/,
    'Селект сетки компоновки должен использовать тот же компактный стиль, что и прозрачность фона.',
);
assert.equal(
    (toolbar.match(/class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--font"/g) || []).length,
    2,
    'Оба селекта шрифта должны использовать компактный стиль.',
);
assert.match(
    toolbar,
    /class="contextual-toolbar__select contextual-toolbar__select--compact"[^>]*data-tooltip="Толщина рамки"[\s\S]*?data-object-property="strokeWidth"/,
    'Селект толщины рамки должен использовать компактный стиль.',
);
assert.match(
    toolbar,
    /data-object-action="replace-image"[\s\S]*?<rect x="3" y="3" width="6" height="6"/,
);
assert.match(
    toolbar,
    /<input type="checkbox" data-object-action="toggle-frame-clip"[\s\S]*?data-role="frame-clip-toggle"/,
);
assert.doesNotMatch(toolbar, /data-object-property="cornerRadius"/);
assert.match(toolbar, /data-more-types="text sticker"/);
assert.match(toolbar, /data-more-types="image shape sticker"/);
assert.match(toolbar, /data-editor-command="send-backward"[\s\S]*data-editor-command="bring-forward"/);
assert.equal((toolbar.match(/data-object-property="fontSize"/g) || []).length, 1);
assert.equal((toolbar.match(/data-role="rotation-control"/g) || []).length, 1);
assert.doesNotMatch(toolbar, /<span aria-hidden="true">пт<\/span>/);
for (const selector of [
    '.contextual-toolbar__more-menu',
    '.contextual-toolbar__more-item',
    '.contextual-toolbar__more-field',
    '.contextual-toolbar__font-size',
    '.contextual-toolbar__rotation',
]) {
    assert.ok(editorStyles.includes(selector), `Для ${selector} должны быть определены стили.`);
}

assert.match(editorStyles, /\.editor-shell--dark[\s\S]*?\.contextual-toolbar__more-menu/);
assert.match(toolbar, /data-role="frame-clip-toggle"[^>]*aria-label="Обрезать объекты за краем"/);
assert.match(editorStyles, /\.contextual-toolbar__more-field--checkbox\s*\{[\s\S]*?cursor:\s*pointer/);
assert.match(uiSource, /change\.moodboardsEditor.*data-role="frame-clip-toggle"/s);
assert.match(uiSource, /matches\('\[data-role="frame-clip-toggle"\]'\)/);
assert.match(
    editorStyles,
    /\.editor-shell--dark \.editor-topbar__logo::after\s*\{[\s\S]*?clip-path:\s*inset\(0 0 0 28px\)[\s\S]*?filter:\s*brightness\(0\) invert\(1\)/,
);

console.log('contextual toolbar layout: PASS');
