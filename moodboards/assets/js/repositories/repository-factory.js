import { ApiClient } from '../api/api-client.js';
import { HttpMoodboardRepository } from './http-moodboard-repository.js';
import { IndexedDbMoodboardRepository } from './indexeddb-moodboard-repository.js';

const REQUIRED_METHODS = Object.freeze([
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
]);

function createIndexedDbRepository({ storage }) {
    return new IndexedDbMoodboardRepository({
        databaseName: storage.databaseName,
        version: storage.version,
    });
}

function createHttpRepository({ apiClient }) {
    return new HttpMoodboardRepository({ apiClient });
}

export class RepositoryFactoryError extends Error {
    constructor(message, code = 'REPOSITORY_FACTORY_ERROR', details = {}) {
        super(message);
        this.name = 'RepositoryFactoryError';
        this.code = code;
        this.details = { ...details };
    }
}

export function assertMoodboardRepository(repository, driver = 'unknown') {
    const missingMethods = REQUIRED_METHODS.filter((method) => (
        typeof repository?.[method] !== 'function'
    ));
    if (missingMethods.length > 0) {
        throw new RepositoryFactoryError(
            `Repository driver «${driver}» не реализует методы: ${missingMethods.join(', ')}.`,
            'INVALID_REPOSITORY_ADAPTER',
            { driver, missingMethods },
        );
    }
    return repository;
}

export class RepositoryFactory {
    constructor({
        config,
        adapters = {},
        fetchImpl = globalThis.fetch,
        apiClientFactory = (options) => new ApiClient(options),
    } = {}) {
        if (!config || typeof config !== 'object') {
            throw new RepositoryFactoryError(
                'RepositoryFactory требуется runtime-конфигурация.',
                'INVALID_REPOSITORY_CONFIG',
            );
        }
        if (typeof apiClientFactory !== 'function') {
            throw new RepositoryFactoryError(
                'apiClientFactory должен быть функцией.',
                'INVALID_REPOSITORY_CONFIG',
            );
        }
        this.config = config;
        this.fetchImpl = fetchImpl;
        this.apiClientFactory = apiClientFactory;
        this.adapters = new Map([
            ['indexeddb', createIndexedDbRepository],
            ['http', createHttpRepository],
            ...Object.entries(adapters || {}),
        ]);
    }

    register(driver, adapterFactory) {
        const normalizedDriver = String(driver || '').trim().toLowerCase();
        if (!normalizedDriver || typeof adapterFactory !== 'function') {
            throw new RepositoryFactoryError(
                'Для регистрации repository нужны имя driver и функция adapter.',
                'INVALID_REPOSITORY_ADAPTER',
            );
        }
        this.adapters.set(normalizedDriver, adapterFactory);
        return this;
    }

    createApiClient(overrides = {}) {
        const api = this.config.api || {};
        return this.apiClientFactory({
            baseUrl: api.baseUrl || '/api',
            timeoutMs: api.timeoutMs,
            retryCount: api.retryCount,
            csrfToken: api.csrfToken || '',
            requireCsrf: Boolean(api.requireCsrf),
            fetchImpl: this.fetchImpl,
            ...overrides,
        });
    }

    createMoodboardRepository({ driver = null, adapterOptions = {} } = {}) {
        const storage = this.config.storage || {};
        const normalizedDriver = String(driver || storage.driver || 'indexeddb').trim().toLowerCase();
        const adapterFactory = this.adapters.get(normalizedDriver);
        if (typeof adapterFactory !== 'function') {
            throw new RepositoryFactoryError(
                `Repository driver «${normalizedDriver}» не зарегистрирован.`,
                'REPOSITORY_DRIVER_NOT_REGISTERED',
                { driver: normalizedDriver },
            );
        }
        const repository = adapterFactory({
            config: this.config,
            storage,
            apiClient: normalizedDriver === 'indexeddb' ? null : this.createApiClient(),
            ...adapterOptions,
        });
        return assertMoodboardRepository(repository, normalizedDriver);
    }
}

export function createMoodboardRepository(config, options = {}) {
    const { factoryOptions = {}, ...repositoryOptions } = options;
    return new RepositoryFactory({ config, ...factoryOptions })
        .createMoodboardRepository(repositoryOptions);
}
