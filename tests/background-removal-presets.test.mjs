import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    BACKGROUND_REMOVAL_PRESET_DEFINITIONS,
    BACKGROUND_REMOVAL_PRESET_IDS,
} from '../assets/js/background-removal-presets.js';

assert.deepEqual(
    BACKGROUND_REMOVAL_PRESET_IDS,
    ['preset_0', 'preset_1', 'preset_01', 'preset_02', 'preset_03'],
);
assert.deepEqual(BACKGROUND_REMOVAL_PRESET_DEFINITIONS.preset_1, {
    name: 'Удаление маски',
    description: 'Удаляет ранее созданную маску изображения.',
});
for (const preset of Object.values(BACKGROUND_REMOVAL_PRESET_DEFINITIONS)) {
    assert.ok(preset.name.length > 0);
    assert.ok(preset.description.length > 0);
    assert.deepEqual(Object.keys(preset).sort(), ['description', 'name']);
}

const phpDefinitions = await readFile(
    new URL('../includes/background-removal-presets.php', import.meta.url),
    'utf8',
);
for (const presetId of BACKGROUND_REMOVAL_PRESET_IDS) {
    assert.match(phpDefinitions, new RegExp(`'${presetId}'\\s*=>`));
}
for (const processingKey of ['model', 'a', 'af', 'ab', 'ae', 'om', 'ppm']) {
    assert.doesNotMatch(phpDefinitions, new RegExp(`'${processingKey}'\\s*=>`));
}

console.log('background removal presets: PASS');
