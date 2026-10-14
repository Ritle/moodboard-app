import { ApiClient } from '../api/api-client.js';
import { HttpPublicMoodboardRepository } from './http-public-moodboard-repository.js';
import { IndexedDbMoodboardRepository } from './indexeddb-moodboard-repository.js';
import { LocalPublicMoodboardRepository } from './local-public-moodboard-repository.js';
import {
    PublicMoodboardRepositoryError,
    assertPublicMoodboardRepository,
    assertPublicReference,
} from './public-moodboard-repository.js';

function createLocalRepository({ config, reference }) {
    const storage = config.storage || {};
    return new LocalPublicMoodboardRepository({
        reference,
        sourceRepository: new IndexedDbMoodboardRepository({
            databaseName: storage.databaseName,
            version: storage.version,
        }),
    });
}

function createHttpRepository({ apiClient, reference }) {
    return new HttpPublicMoodboardRepository({ apiClient, reference });
}

export function resolvePublicViewerReference(search, config = {}) {
    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(String(search || ''));
    const viewerConfig = config.publicViewer || {};
    const tokenParameter = viewerConfig.tokenParameter || 'token';
    const legacyParameter = viewerConfig.legacyIdParameter || 'id';
    const token = params.get(tokenParameter);
    if (token) {
        return { reference: token, source: 'token' };
    }
    const legacyReference = viewerConfig.allowLegacyId !== false
        ? params.get(legacyParameter)
        : null;
    return legacyReference
        ? { reference: legacyReference, source: 'legacy-id' }
        : { reference: null, source: null };
}

export class PublicRepositoryFactory {
    constructor({
        config,
        adapters = {},
        fetchImpl = globalThis.fetch,
        apiClientFactory = (options) => new ApiClient(options),
    } = {}) {
        if (!config || typeof config !== 'object') {
            throw new PublicMoodboardRepositoryError(
                'PublicRepositoryFactory требуется runtime-конфигурация.',
                'INVALID_PUBLIC_REPOSITORY_CONFIG',
            );
        }
        if (typeof apiClientFactory !== 'function') {
            throw new PublicMoodboardRepositoryError(
                'apiClientFactory должен быть функцией.',
                'INVALID_PUBLIC_REPOSITORY_CONFIG',
            );
        }
        this.config = config;
        this.fetchImpl = fetchImpl;
        this.apiClientFactory = apiClientFactory;
        this.adapters = new Map([
            ['local-indexeddb', createLocalRepository],
            ['http', createHttpRepository],
            ...Object.entries(adapters || {}),
        ]);
    }

    register(driver, adapterFactory) {
        const normalizedDriver = String(driver || '').trim().toLowerCase();
        if (!normalizedDriver || typeof adapterFactory !== 'function') {
            throw new PublicMoodboardRepositoryError(
                'Для регистрации public repository нужны имя driver и функция adapter.',
                'INVALID_PUBLIC_REPOSITORY_ADAPTER',
            );
        }
        this.adapters.set(normalizedDriver, adapterFactory);
        return this;
    }

    create({ reference, driver = null, adapterOptions = {} } = {}) {
        const normalizedReference = assertPublicReference(reference);
        const viewerConfig = this.config.publicViewer || {};
        const normalizedDriver = String(driver || viewerConfig.driver || 'local-indexeddb')
            .trim()
            .toLowerCase();
        const adapterFactory = this.adapters.get(normalizedDriver);
        if (typeof adapterFactory !== 'function') {
            throw new PublicMoodboardRepositoryError(
                `Public repository driver «${normalizedDriver}» не зарегистрирован.`,
                'PUBLIC_REPOSITORY_DRIVER_NOT_REGISTERED',
                { driver: normalizedDriver },
            );
        }
        const api = this.config.api || {};
        const apiClient = normalizedDriver === 'local-indexeddb'
            ? null
            : this.apiClientFactory({
                baseUrl: api.baseUrl || '/api',
                timeoutMs: api.timeoutMs,
                retryCount: api.retryCount,
                fetchImpl: this.fetchImpl,
                requireCsrf: false,
            });
        return assertPublicMoodboardRepository(adapterFactory({
            config: this.config,
            reference: normalizedReference,
            apiClient,
            ...adapterOptions,
        }), normalizedDriver);
    }
}

export function createPublicMoodboardRepository(config, options = {}) {
    const { factoryOptions = {}, ...repositoryOptions } = options;
    return new PublicRepositoryFactory({ config, ...factoryOptions }).create(repositoryOptions);
}
