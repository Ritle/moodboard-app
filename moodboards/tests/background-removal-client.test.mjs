import assert from 'node:assert/strict';
import {
    BackgroundRemovalClient,
    resolveDemoBackgroundRemovalPreset,
} from '../assets/js/editor/background-removal-client.js';

assert.equal(resolveDemoBackgroundRemovalPreset(''), null);
assert.equal(resolveDemoBackgroundRemovalPreset('?mode=view'), 'preset_0');
assert.equal(
    resolveDemoBackgroundRemovalPreset('?mode=view&mock_preset=preset_02'),
    'preset_02',
);
assert.equal(
    resolveDemoBackgroundRemovalPreset('?mode=view&mock_preset=preset_1'),
    'preset_1',
);
assert.equal(
    resolveDemoBackgroundRemovalPreset('?mode=view&mock_preset=unknown'),
    'preset_0',
);

const sourceBlob = new Blob(['source-image'], { type: 'image/png' });
let capturedRequest = null;
const client = new BackgroundRemovalClient({
    endpoint: '/moodboards/api/remove-background.php',
    presetId: 'preset_02',
    fetchImpl: async (endpoint, options) => {
        capturedRequest = { endpoint, options };
        return new Response(new Blob(['processed-image'], { type: 'image/png' }), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
        });
    },
});

const result = await client.remove(sourceBlob);
assert.equal(result instanceof Blob, true);
assert.equal(result.type, 'image/png');
assert.equal(capturedRequest.endpoint, '/moodboards/api/remove-background.php');
assert.equal(capturedRequest.options.method, 'POST');
assert.equal(capturedRequest.options.credentials, 'same-origin');
assert.equal(capturedRequest.options.body instanceof FormData, true);
assert.equal(capturedRequest.options.body.get('file') instanceof Blob, true);
assert.equal(capturedRequest.options.body.get('preset_id'), 'preset_02');
assert.deepEqual(
    [...capturedRequest.options.body.keys()],
    ['file', 'preset_id'],
);

const failingClient = new BackgroundRemovalClient({
    endpoint: '/moodboards/api/remove-background.php',
    fetchImpl: async () => new Response(JSON.stringify({
        status: 'error',
        error: { message: 'Тестовая ошибка сервиса.' },
    }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
    }),
});

await assert.rejects(
    () => failingClient.remove(sourceBlob),
    /Тестовая ошибка сервиса/,
);
await assert.rejects(
    () => client.remove(new Blob(['text'], { type: 'text/plain' })),
    /требуется изображение/,
);

const originalFetch = globalThis.fetch;
let defaultFetchContext = null;
globalThis.fetch = function fetchWithRequiredContext() {
    defaultFetchContext = this;
    if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
    }
    return Promise.resolve(new Response(new Blob(['processed-image'], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
    }));
};
try {
    const defaultFetchClient = new BackgroundRemovalClient({
        endpoint: '/moodboards/api/remove-background.php',
    });
    await defaultFetchClient.remove(sourceBlob);
    assert.equal(defaultFetchContext, globalThis);
} finally {
    globalThis.fetch = originalFetch;
}

console.log('background-removal-client: ok');
