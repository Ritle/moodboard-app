import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
const controllerSource = await readFile(
    new URL('../assets/js/editor/ui-controller.js', import.meta.url),
    'utf8',
);

const shapeToolbarMatch = editorMarkup.match(
    /<div class="contextual-toolbar__type-controls" data-object-toolbar="shape"[\s\S]*?<\/div>/,
);

assert.ok(shapeToolbarMatch, 'Тулбар выделенной фигуры не найден.');
assert.match(
    shapeToolbarMatch[0],
    /data-object-action="toggle-lock"[^>]*aria-label="Заблокировать фигуру"/,
    'В тулбаре фигуры должна быть доступна кнопка блокировки.',
);
assert.match(
    controllerSource,
    /type === 'shape' \? 'фигуру'/,
    'Состояние блокировки фигуры должно получать доступную подпись.',
);
assert.match(
    controllerSource,
    /const type = element\.type === 'rectangle' \? 'shape' : element\.type;/,
    'Прямоугольники должны использовать тулбар фигур.',
);

console.log('shape lock toolbar: PASS');
