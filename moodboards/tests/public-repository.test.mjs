import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ApiClient } from '../assets/js/api/api-client.js';
import { HttpPublicMoodboardRepository } from '../assets/js/repositories/http-public-moodboard-repository.js';
import { LocalPublicMoodboardRepository } from '../assets/js/repositories/local-public-moodboard-repository.js';
import {
    PublicRepositoryFactory,
    resolvePublicViewerReference,
} from '../assets/js/repositories/public-repository-factory.js';

const document = {
    schemaVersion: 2,
    pages: [{
        id: 'page-1',
        name: 'Лист 1',
        canvas: { width: 1600, height: 1000, background: '#fff' },
        elements: [
            { id: 'image-1', type: 'image', assetId: 'asset-1' },
            { id: 'group-1', type: 'group', children: [{ assetId: 'asset-2' }] },
        ],
    }],
};

{
    let closed = false;
    const sourceRepository = {
        async get(id) {
            assert.equal(id, 'board-1');
            return {
                id: 'private-board-id',
                ownerId: 'private-user-id',
                title: 'Public board',
                revision: 7,
                document,
                createdAt: '2026-09-04T10:00:00.000Z',
            };
        },
        async getAsset(id) {
            return { id, moodboardId: 'private-board-id', blob: new Blob([id], { type: 'image/png' }) };
        },
        async close() {
            closed = true;
        },
    };
    const repository = new LocalPublicMoodboardRepository({
        reference: 'board-1',
        sourceRepository,
    });

    assert.equal(await repository.getAsset('asset-1'), null);
    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.title, 'Public board');
    assert.equal(snapshot.revision, 7);
    assert.deepEqual(snapshot.assets.map(({ id }) => id), ['asset-1', 'asset-2']);
    assert.equal('id' in snapshot, false);
    assert.equal('ownerId' in snapshot, false);
    assert.equal((await repository.getAsset('asset-1')).id, 'asset-1');
    assert.equal(await repository.getAsset('private-unreferenced-asset'), null);
    await repository.close();
    assert.equal(closed, true);
}

{
    const requests = [];
    const apiClient = new ApiClient({
        baseUrl: '/api',
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith('/assets/asset-1')) {
                return new Response(new Blob(['image'], { type: 'image/png' }), {
                    status: 200,
                    headers: { 'Content-Type': 'image/png' },
                });
            }
            return new Response(JSON.stringify({
                title: 'HTTP snapshot',
                document,
                revision: 3,
                assets: [{
                    id: 'asset-1',
                    url: '/ignored-private-safe-url',
                    width: 320,
                    height: 200,
                    mimeType: 'image/png',
                }],
                createdAt: '2026-09-04T10:00:00.000Z',
                expiresAt: '2026-10-04T10:00:00.000Z',
                ownerId: 'must-not-leak-to-viewer',
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    const repository = new HttpPublicMoodboardRepository({
        reference: 'share_token-123',
        apiClient,
    });

    const snapshot = await repository.getSnapshot();
    assert.equal(snapshot.title, 'HTTP snapshot');
    assert.equal('ownerId' in snapshot, false);
    const asset = await repository.getAsset('asset-1');
    assert.equal(asset.blob.type, 'image/png');
    assert.equal(requests[0].url, '/api/public/moodboards/share_token-123');
    assert.equal(requests[0].options.credentials, 'omit');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(requests[1].url, '/api/public/moodboards/share_token-123/assets/asset-1');
    assert.equal(requests[1].options.credentials, 'omit');
    assert.equal(await repository.getAsset('not-in-snapshot'), null);
}

{
    const config = {
        storage: { databaseName: 'public-repository-test', version: 1 },
        publicViewer: { driver: 'custom' },
        api: { baseUrl: '/api', timeoutMs: 1000, retryCount: 0 },
    };
    let context = null;
    const repository = { async getSnapshot() {}, async getAsset() {} };
    const factory = new PublicRepositoryFactory({
        config,
        adapters: {
            custom: (adapterContext) => {
                context = adapterContext;
                return repository;
            },
        },
    });
    assert.equal(factory.create({ reference: 'public-token' }), repository);
    assert.equal(context.reference, 'public-token');
    assert.ok(context.apiClient instanceof ApiClient);
}

assert.deepEqual(
    resolvePublicViewerReference('?token=new-token&id=legacy-id'),
    { reference: 'new-token', source: 'token' },
);
assert.deepEqual(
    resolvePublicViewerReference('?id=legacy-id'),
    { reference: 'legacy-id', source: 'legacy-id' },
);
assert.deepEqual(
    resolvePublicViewerReference('?id=legacy-id', { publicViewer: { allowLegacyId: false } }),
    { reference: null, source: null },
);

const viewerSource = await readFile(new URL('../assets/js/viewer/app.js', import.meta.url), 'utf8');
assert.doesNotMatch(viewerSource, /createMoodboardRepository/);
assert.doesNotMatch(viewerSource, /IndexedDbMoodboardRepository/);
assert.match(viewerSource, /createPublicMoodboardRepository/);

const editorSource = await readFile(new URL('../assets/js/editor/editor-app.js', import.meta.url), 'utf8');
assert.match(editorSource, /searchParams\.set\('token', moodboardId\)/);

const listSource = await readFile(new URL('../assets/js/moodboards/moodboards-list-controller.js', import.meta.url), 'utf8');
assert.match(listSource, /searchParams\.set\('token', moodboardId\)/);

console.log('public repository separation: PASS');
