import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexMarkup = await readFile(new URL('../index.php', import.meta.url), 'utf8');
const viewerMarkup = await readFile(new URL('../view.php', import.meta.url), 'utf8');
const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');

assert.match(indexMarkup, /class="roomplan-logo" href="\/moodboards\/index\.php"/);
assert.match(viewerMarkup, /class="viewer-brand" href="\/moodboards\/index\.php"/);
assert.match(editorMarkup, /class="editor-topbar__logo" href="index\.php"/);
assert.match(
    editorMarkup,
    /<span class="roomplan-studio-badge editor-topbar__label">Мудборды<\/span>/,
    'Плашка «Мудборды» в редакторе должна быть статичной.',
);
assert.match(editorMarkup, /editor-topbar__back-tooltip/);

console.log('header navigation: PASS');
