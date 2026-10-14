import assert from 'node:assert/strict';

import { ApiClient } from '../assets/js/api/api-client.js';
import { HttpMoodboardRepository } from '../assets/js/repositories/http-moodboard-repository.js';
import { IndexedDbMoodboardRepository } from '../assets/js/repositories/indexeddb-moodboard-repository.js';
import {
    RepositoryFactory,
    RepositoryFactoryError,
    createMoodboardRepository,
} from '../assets/js/repositories/repository-factory.js';

const config = {
    storage: {
        driver: 'indexeddb',
        databaseName: 'repository-factory-test',
        version: 3,
    },
    api: {
        baseUrl: '/api/v1',
        timeoutMs: 9000,
        retryCount: 2,
        csrfToken: 'csrf',
        requireCsrf: true,
    },
};

{
    const repository = createMoodboardRepository(config);
    assert.ok(repository instanceof IndexedDbMoodboardRepository);
    assert.equal(repository.databaseName, 'repository-factory-test');
    assert.equal(repository.version, 3);
}

function createRepositoryDouble() {
    return Object.fromEntries([
        'list',
        'create',
        'get',
        'updateMeta',
        'setArchived',
        'saveContent',
        'delete',
        'duplicate',
        'addAsset',
        'getAsset',
        'deleteAsset',
        'savePreview',
    ].map((method) => [method, async () => method]));
}

{
    const factory = new RepositoryFactory({
        config: { ...config, storage: { ...config.storage, driver: 'http' } },
        fetchImpl: async () => new Response(null, { status: 204 }),
    });
    const repository = factory.createMoodboardRepository();
    assert.ok(repository instanceof HttpMoodboardRepository);
    assert.ok(repository.api instanceof ApiClient);
    assert.equal(repository.api.baseUrl, '/api/v1');
    assert.equal(repository.api.requireCsrf, true);
}

{
    let adapterContext = null;
    const repository = createRepositoryDouble();
    const factory = new RepositoryFactory({
        config: { ...config, storage: { ...config.storage, driver: 'http' } },
        fetchImpl: async () => new Response(null, { status: 204 }),
        adapters: {
            http: (context) => {
                adapterContext = context;
                return repository;
            },
        },
    });
    assert.equal(factory.createMoodboardRepository(), repository);
    assert.ok(adapterContext.apiClient instanceof ApiClient);
    assert.equal(adapterContext.apiClient.baseUrl, '/api/v1');
    assert.equal(adapterContext.apiClient.csrfToken, 'csrf');
    assert.equal(adapterContext.apiClient.requireCsrf, true);
    assert.equal(adapterContext.storage.driver, 'http');
}

{
    const factory = new RepositoryFactory({ config });
    assert.throws(
        () => factory.createMoodboardRepository({ driver: 'missing' }),
        (error) => (
            error instanceof RepositoryFactoryError
            && error.code === 'REPOSITORY_DRIVER_NOT_REGISTERED'
        ),
    );
}

{
    const factory = new RepositoryFactory({
        config,
        adapters: { incomplete: () => ({ list() {} }) },
    });
    assert.throws(
        () => factory.createMoodboardRepository({ driver: 'incomplete' }),
        (error) => (
            error instanceof RepositoryFactoryError
            && error.code === 'INVALID_REPOSITORY_ADAPTER'
            && error.details.missingMethods.includes('saveContent')
        ),
    );
}

console.log('repository factory: PASS');
