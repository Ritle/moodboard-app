import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const headerSource = await readFile(new URL('../includes/header.php', import.meta.url), 'utf8');
const footerSource = await readFile(new URL('../includes/footer.php', import.meta.url), 'utf8');

assert.match(headerSource, /new RecursiveIteratorIterator\(/);
assert.match(headerSource, /\$moduleImports\[\$publicPath\] = \$versionedAssetUrl\(\$publicPath\);/);
assert.match(headerSource, /<script type="importmap">/);
assert.match(footerSource, /\$versionedAssetUrl\(\$pageModule\)/);
assert.match(footerSource, /htmlspecialchars\(\$versionedPageModule,/);

console.log('asset versioning: PASS');
