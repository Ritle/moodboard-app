import assert from 'node:assert/strict';

import { ApiClient } from '../assets/js/api/api-client.js';
import {
    HttpMoodboardRepository,
    HttpMoodboardRepositoryError,
} from '../assets/js/repositories/http-moodboard-repository.js';

const requests = [];
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
});
const apiClient = new ApiClient({
    baseUrl: '/api',
    csrfToken: 'csrf-token',
    requireCsrf: true,
    retryCount: 0,
    requestIdFactory: () => `request-${requests.length + 1}`,
    idempotencyKeyFactory: () => `idempotency-${requests.length + 1}`,
    fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (options.method === 'GET' && url === '/api/assets/asset-1') {
            return new Response(new Blob(['image'], { type: 'image/png' }), {
                status: 200,
                headers: {
                    'Content-Type': 'image/png',
                    'X-Moodboard-Id': 'board-1',
                    'X-Image-Width': '320',
                    'X-Image-Height': '200',
                    'X-Created-At': '2026-09-04T10:00:00.000Z',
                },
            });
        }
        if (url.includes('/missing')) {
            return jsonResponse({
                error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found' },
            }, 404);
        }
        if (options.method === 'DELETE') {
            return new Response(null, { status: 204 });
        }
        if (options.method === 'GET' && url === '/api/moodboards') {
            return jsonResponse({
                items: [{ id: 'board-1', previewUrl: '/api/moodboards/board-1/preview?v=4' }],
            });
        }
        if (url.endsWith('/content')) {
            return jsonResponse({ revision: 4, updatedAt: '2026-09-04T10:00:00.000Z' });
        }
        return jsonResponse({ id: 'result-1', revision: 1 }, options.method === 'POST' ? 201 : 200);
    },
});
const repository = new HttpMoodboardRepository({ apiClient });

assert.deepEqual(await repository.list(), [{
    id: 'board-1',
    previewUrl: '/api/moodboards/board-1/preview?v=4',
}]);
await repository.create({ title: 'Новый проект' });
assert.equal(await repository.get('missing'), null);
await repository.updateMeta('board 1', { title: 'Новое имя' });
await repository.setArchived('board-1', true);
assert.equal((await repository.saveContent('board-1', { schemaVersion: 2, pages: [] }, 3)).revision, 4);
assert.equal(await repository.delete('missing'), false);
await repository.duplicate('board-1');
await repository.addAsset('board-1', new Blob(['image'], { type: 'image/png' }));
const asset = await repository.getAsset('asset-1');
assert.equal(asset.moodboardId, 'board-1');
assert.equal(asset.width, 320);
assert.equal(asset.height, 200);
assert.equal(asset.blob.type, 'image/png');
assert.equal(await repository.deleteAsset('missing'), false);
await repository.savePreview('board-1', new Blob(['preview'], { type: 'image/png' }));
await repository.savePreview('board-1', null);

const byRequest = (method, suffix) => requests.find(({ url, options }) => (
    options.method === method && url.endsWith(suffix)
));
assert.ok(byRequest('PATCH', '/moodboards/board%201'));
assert.deepEqual(JSON.parse(byRequest('PUT', '/moodboards/board-1/content').options.body), {
    document: { schemaVersion: 2, pages: [] },
    revision: 3,
});
for (const request of [
    byRequest('POST', '/moodboards'),
    byRequest('POST', '/moodboards/board-1/duplicate'),
    byRequest('POST', '/moodboards/board-1/assets'),
]) {
    assert.ok(request.options.headers.get('Idempotency-Key'));
    assert.equal(request.options.headers.get('X-CSRF-Token'), 'csrf-token');
}
assert.ok(byRequest('POST', '/moodboards/board-1/assets').options.body instanceof FormData);
assert.equal(byRequest('GET', '/assets/asset-1').options.headers.get('Accept'), 'image/*,application/octet-stream');

await assert.rejects(
    () => repository.get(''),
    (error) => error instanceof HttpMoodboardRepositoryError && error.code === 'INVALID_ARGUMENT',
);

console.log('HTTP moodboard repository: PASS');
