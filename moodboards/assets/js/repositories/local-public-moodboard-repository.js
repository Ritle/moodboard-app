import {
    PublicMoodboardRepository,
    assertPublicReference,
    collectPublicAssetIds,
} from './public-moodboard-repository.js';

function cloneValue(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

export class LocalPublicMoodboardRepository extends PublicMoodboardRepository {
    #reference;
    #sourceRepository;
    #allowedAssetIds = new Set();
    #snapshotLoaded = false;

    constructor({ reference, sourceRepository }) {
        super();
        if (!sourceRepository || typeof sourceRepository.get !== 'function' || typeof sourceRepository.getAsset !== 'function') {
            throw new TypeError('Local public repository требует read-only источник досок и assets.');
        }
        this.#reference = assertPublicReference(reference);
        this.#sourceRepository = sourceRepository;
    }

    async getSnapshot() {
        const record = await this.#sourceRepository.get(this.#reference);
        if (!record) {
            this.#allowedAssetIds.clear();
            this.#snapshotLoaded = true;
            return null;
        }

        const document = cloneValue(record.document);
        this.#allowedAssetIds = collectPublicAssetIds(document);
        this.#snapshotLoaded = true;
        return {
            title: record.title,
            document,
            revision: Number(record.revision) || 0,
            assets: [...this.#allowedAssetIds].map((id) => ({ id })),
            createdAt: record.createdAt || null,
            expiresAt: null,
        };
    }

    async getAsset(assetId) {
        const normalizedAssetId = assertPublicReference(assetId);
        if (!this.#snapshotLoaded || !this.#allowedAssetIds.has(normalizedAssetId)) {
            return null;
        }
        const asset = await this.#sourceRepository.getAsset(normalizedAssetId);
        if (!asset) {
            return null;
        }
        return {
            id: normalizedAssetId,
            blob: asset.blob,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType || asset.blob?.type || '',
            createdAt: asset.createdAt || null,
        };
    }

    async close() {
        await this.#sourceRepository.close?.();
    }
}
