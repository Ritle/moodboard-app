import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isMoodboardsDemoMode } from '../assets/js/access/moodboards-access-guard.js';

assert.equal(isMoodboardsDemoMode('?mode=view'), true);
assert.equal(isMoodboardsDemoMode('?id=board-1&mode=view&mock_tariff=basic'), true);
assert.equal(isMoodboardsDemoMode(''), false);
assert.equal(isMoodboardsDemoMode('?mode=edit'), false);
assert.equal(isMoodboardsDemoMode('?mode=VIEW'), false);

const header = await readFile(new URL('../includes/header.php', import.meta.url), 'utf8');
assert.match(header, /\$demoModeEnabled\s*=\s*isset\(\$_GET\['mode'\]\)\s*&&\s*\$_GET\['mode'\]\s*===\s*'view'/);
assert.match(header, /\(\$showDemoTariffSwitcher\s*\?\?\s*true\)\s*&&\s*\$demoModeEnabled/);
assert.match(header, /moodboards-demo-mode/);
assert.match(header, /data-role="demo-preset-select"/);
assert.match(header, /data-role="demo-preset-description"/);
assert.match(header, /background-removal-presets\.php/);

const accessGuard = await readFile(
    new URL('../assets/js/access/moodboards-access-guard.js', import.meta.url),
    'utf8',
);
assert.match(accessGuard, /mock_preset/);
assert.match(accessGuard, /DEFAULT_DEMO_PRESET\s*=\s*'preset_0'/);
assert.match(accessGuard, /BACKGROUND_REMOVAL_PRESET_DEFINITIONS\[preset\]\.name/);

const styles = await readFile(new URL('../assets/css/base.css', import.meta.url), 'utf8');
assert.match(styles, /\.demo-tariff-switcher\s*\{[\s\S]*?display:\s*none;/);
assert.match(styles, /\.moodboards-demo-mode \.demo-tariff-switcher\s*\{\s*display:\s*flex;/);
assert.match(
    styles,
    /\.moodboards-demo-mode :is\(\.notifications, \.editor-notification, \.viewer-notification\)\s*\{\s*z-index:\s*1210;/,
);

const editorStyles = await readFile(new URL('../assets/css/editor.css', import.meta.url), 'utf8');
assert.match(
    editorStyles,
    /\.moodboards-demo-mode \.layer-map\s*\{[\s\S]*?right:\s*120px;[\s\S]*?bottom:\s*222px;/,
);

console.log('demo mode visibility: PASS');
