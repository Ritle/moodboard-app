export class PublicMoodboardRepositoryError extends Error {
    constructor(message, code = 'PUBLIC_REPOSITORY_ERROR', details = {}) {
        super(message);
        this.name = 'PublicMoodboardRepositoryError';
        this.code = code;
        this.details = { ...details };
    }
}

export class PublicMoodboardRepository {
    async getSnapshot() {
        throw new PublicMoodboardRepositoryError(
            'Метод getSnapshot() не реализован.',
            'NOT_IMPLEMENTED',
        );
    }

    async getAsset(assetId) {
        void assetId;
        throw new PublicMoodboardRepositoryError(
            'Метод getAsset() не реализован.',
            'NOT_IMPLEMENTED',
        );
    }

    async close() {}
}

export function assertPublicMoodboardRepository(repository, driver = 'unknown') {
    const missingMethods = ['getSnapshot', 'getAsset'].filter((method) => (
        typeof repository?.[method] !== 'function'
    ));
    if (missingMethods.length > 0) {
        throw new PublicMoodboardRepositoryError(
            `Public repository «${driver}» не реализует методы: ${missingMethods.join(', ')}.`,
            'INVALID_PUBLIC_REPOSITORY_ADAPTER',
            { driver, missingMethods },
        );
    }
    return repository;
}

export function assertPublicReference(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new PublicMoodboardRepositoryError(
            'В публичной ссылке отсутствует token.',
            'INVALID_PUBLIC_REFERENCE',
        );
    }
    return value.trim();
}

export function collectPublicAssetIds(document) {
    const assetIds = new Set();
    const visit = (value) => {
        if (!value || typeof value !== 'object') {
            return;
        }
        if (typeof value.assetId === 'string' && value.assetId.trim() !== '') {
            assetIds.add(value.assetId);
        }
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        Object.values(value).forEach(visit);
    };
    visit(document);
    return assetIds;
}
