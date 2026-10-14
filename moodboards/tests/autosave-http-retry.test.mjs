import assert from 'node:assert/strict';

import { ApiClientError } from '../assets/js/api/api-client.js';
import {
    AutosaveManager,
    isAutosaveRetryableError,
    resolveAutosaveRetryDelay,
} from '../assets/js/editor/autosave-manager.js';

function apiError(status, code = 'API_REQUEST_FAILED', retryAfterMs = null) {
    return new ApiClientError(`HTTP ${status}`, { status, code, retryAfterMs });
}

assert.equal(isAutosaveRetryableError(apiError(429, 'RATE_LIMITED')), true);
assert.equal(isAutosaveRetryableError(apiError(500)), true);
assert.equal(isAutosaveRetryableError(apiError(503, 'SERVICE_UNAVAILABLE')), true);
assert.equal(isAutosaveRetryableError(apiError(400, 'INVALID_ARGUMENT')), false);
assert.equal(isAutosaveRetryableError(apiError(401, 'UNAUTHORIZED')), false);
assert.equal(isAutosaveRetryableError(apiError(403, 'FORBIDDEN')), false);
assert.equal(isAutosaveRetryableError(apiError(409, 'REVISION_CONFLICT')), false);
assert.equal(isAutosaveRetryableError(apiError(422, 'VALIDATION_FAILED')), false);
assert.equal(isAutosaveRetryableError(new ApiClientError('cancelled', {
    code: 'REQUEST_ABORTED',
})), false);
assert.equal(isAutosaveRetryableError(new ApiClientError('offline', {
    code: 'NETWORK_ERROR',
})), true);

assert.equal(resolveAutosaveRetryDelay(apiError(503), 2500), 2500);
assert.equal(resolveAutosaveRetryDelay(apiError(429, 'RATE_LIMITED', 12_000), 2500), 12_000);
assert.equal(resolveAutosaveRetryDelay(apiError(429, 'RATE_LIMITED', 120_000), 2500), 30_000);

function createStore() {
    return {
        moodboardId: 'board-1',
        revision: 0,
        statuses: [],
        getDocument: () => ({ schemaVersion: 2, pages: [] }),
        setRevision(revision) {
            this.revision = revision;
        },
        setSaveStatus(status, message = '') {
            this.statuses.push({ status, message });
        },
    };
}

{
    const store = createStore();
    let attempts = 0;
    const autosave = new AutosaveManager({
        store,
        retryDelaysMs: [0],
        repository: {
            async saveContent() {
                attempts += 1;
                if (attempts === 1) {
                    throw apiError(503, 'SERVICE_UNAVAILABLE', 0);
                }
                return { revision: 1 };
            },
        },
    });

    autosave.markChanged();
    assert.equal(await autosave.flush(), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(attempts, 2);
    assert.equal(store.revision, 1);
    assert.equal(store.statuses.at(-1).status, 'saved');
    await autosave.destroy({ flush: false });
}

{
    const store = createStore();
    let attempts = 0;
    const autosave = new AutosaveManager({
        store,
        retryDelaysMs: [0],
        repository: {
            async saveContent() {
                attempts += 1;
                throw apiError(422, 'VALIDATION_FAILED');
            },
        },
    });

    autosave.markChanged();
    assert.equal(await autosave.flush(), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(attempts, 1);
    assert.equal(autosave.getState().retryAttempt, 0);
    assert.equal(store.statuses.at(-1).status, 'error');
    await autosave.destroy({ flush: false });
}

console.log('autosave HTTP retry: PASS');
