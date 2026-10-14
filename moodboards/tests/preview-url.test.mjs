import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    normalizeMoodboardPreviewUrl,
    resolveMoodboardPreviewSource,
} from '../assets/js/moodboards/moodboards-list-controller.js';

assert.equal(
    normalizeMoodboardPreviewUrl('/api/previews/board-1.png?v=7', 'https://roomplan.ru/moodboards/'),
    'https://roomplan.ru/api/previews/board-1.png?v=7',
);
assert.equal(
    normalizeMoodboardPreviewUrl('https://cdn.roomplan.ru/previews/board-1.webp'),
    'https://cdn.roomplan.ru/previews/board-1.webp',
);
assert.equal(normalizeMoodboardPreviewUrl('javascript:alert(1)'), null);
assert.equal(normalizeMoodboardPreviewUrl('data:image/svg+xml,<svg/>'), null);
assert.equal(normalizeMoodboardPreviewUrl(''), null);
assert.equal(normalizeMoodboardPreviewUrl(null), null);

const previewBlob = new Blob(['preview'], { type: 'image/png' });
assert.deepEqual(resolveMoodboardPreviewSource({
    previewBlob,
    previewUrl: 'https://cdn.roomplan.ru/stale-preview.png',
}, {
    createObjectUrl: (blob) => {
        assert.equal(blob, previewBlob);
        return 'blob:local-preview';
    },
}), { src: 'blob:local-preview', objectUrl: true });
assert.deepEqual(resolveMoodboardPreviewSource({
    previewBlob: null,
    previewUrl: '/api/previews/board-1.png',
}, {
    baseUrl: 'https://roomplan.ru/moodboards/',
}), { src: 'https://roomplan.ru/api/previews/board-1.png', objectUrl: false });

const source = await readFile(
    new URL('../assets/js/moodboards/moodboards-list-controller.js', import.meta.url),
    'utf8',
);
assert.match(source, /resolveMoodboardPreviewSource\(record\)/);
assert.match(source, /\.one\('error'/);
assert.match(source, /referrerpolicy: 'no-referrer'/);

console.log('preview URL: PASS');
