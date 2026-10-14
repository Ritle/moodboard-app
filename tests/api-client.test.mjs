import assert from 'node:assert/strict';

import { ApiClient, ApiClientError } from '../assets/js/api/api-client.js';

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
        ...init,
    });
}

{
    let captured = null;
    const client = new ApiClient({
        baseUrl: '/api/',
        csrfToken: 'csrf-token',
        requireCsrf: true,
        requestIdFactory: () => 'request-1',
        idempotencyKeyFactory: () => 'idempotency-1',
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return jsonResponse({ id: 'board-1' }, { status: 201 });
        },
    });

    const result = await client.post('/moodboards', {
        json: { title: 'Проект' },
        idempotencyKey: true,
    });
    assert.deepEqual(result, { id: 'board-1' });
    assert.equal(captured.url, '/api/moodboards');
    assert.equal(captured.options.credentials, 'same-origin');
    assert.equal(captured.options.headers.get('Accept'), 'application/json');
    assert.equal(captured.options.headers.get('Content-Type'), 'application/json');
    assert.equal(captured.options.headers.get('X-CSRF-Token'), 'csrf-token');
    assert.equal(captured.options.headers.get('X-Request-Id'), 'request-1');
    assert.equal(captured.options.headers.get('Idempotency-Key'), 'idempotency-1');
    assert.equal(captured.options.body, JSON.stringify({ title: 'Проект' }));
}

{
    const client = new ApiClient({
        baseUrl: '/api',
        fetchImpl: async () => jsonResponse({
            error: {
                code: 'REVISION_CONFLICT',
                message: 'Документ уже изменён',
                details: { expectedRevision: 2, actualRevision: 3 },
                requestId: 'server-request-2',
            },
        }, {
            status: 409,
            headers: { 'Retry-After': '2' },
        }),
    });
    await assert.rejects(
        () => client.put('/moodboards/board-1/content', { json: {} }),
        (error) => {
            assert.ok(error instanceof ApiClientError);
            assert.equal(error.code, 'REVISION_CONFLICT');
            assert.equal(error.status, 409);
            assert.equal(error.requestId, 'server-request-2');
            assert.equal(error.retryAfterMs, 2000);
            assert.deepEqual(error.details, { expectedRevision: 2, actualRevision: 3 });
            return true;
        },
    );
}

{
    let attempts = 0;
    const client = new ApiClient({
        retryCount: 1,
        fetchImpl: async () => {
            attempts += 1;
            if (attempts === 1) {
                return jsonResponse({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Повторите запрос' } }, {
                    status: 503,
                    headers: { 'Retry-After': '0' },
                });
            }
            return jsonResponse({ items: [] });
        },
    });
    assert.deepEqual(await client.get('/moodboards'), { items: [] });
    assert.equal(attempts, 2);
}

{
    const client = new ApiClient({
        timeoutMs: 10,
        fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        }),
    });
    await assert.rejects(
        () => client.get('/slow'),
        (error) => error instanceof ApiClientError && error.code === 'REQUEST_TIMEOUT',
    );
}

{
    const client = new ApiClient({
        fetchImpl: async () => new Response('<html>error</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
        }),
    });
    await assert.rejects(
        () => client.get('/invalid-json'),
        (error) => error instanceof ApiClientError && error.code === 'INVALID_JSON_RESPONSE',
    );
}

{
    const client = new ApiClient({
        requireCsrf: true,
        fetchImpl: async () => jsonResponse({}),
    });
    await assert.rejects(
        () => client.delete('/moodboards/board-1'),
        (error) => error instanceof ApiClientError && error.code === 'CSRF_TOKEN_REQUIRED',
    );
}

{
    const controller = new AbortController();
    controller.abort();
    const client = new ApiClient({
        requestIdFactory: () => 'request-aborted',
        fetchImpl: async (_url, { signal }) => {
            assert.equal(signal.aborted, true);
            throw new DOMException('Aborted', 'AbortError');
        },
    });
    await assert.rejects(
        () => client.get('/aborted', { signal: controller.signal }),
        (error) => (
            error instanceof ApiClientError
            && error.code === 'REQUEST_ABORTED'
            && error.requestId === 'request-aborted'
        ),
    );
}

{
    let attempts = 0;
    const client = new ApiClient({
        timeoutMs: 0,
        retryCount: 2,
        fetchImpl: async () => {
            attempts += 1;
            throw new TypeError('offline');
        },
    });
    assert.equal(client.timeoutMs, 0);
    await assert.rejects(
        () => client.post('/non-idempotent', { json: {} }),
        (error) => error instanceof ApiClientError && error.code === 'NETWORK_ERROR',
    );
    assert.equal(attempts, 1);
}

console.log('api client: PASS');
