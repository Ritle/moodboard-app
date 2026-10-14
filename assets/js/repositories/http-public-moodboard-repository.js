import { ApiClientError } from '../api/api-client.js';
import {
    PublicMoodboardRepository,
    PublicMoodboardRepositoryError,
    assertPublicReference,
} from './public-moodboard-repository.js';

export class HttpPublicMoodboardRepository extends PublicMoodboardRepository {
    #encodedReference;
    #api;
    #assets = new Map();
    #snapshotLoaded = false;

    constructor({ reference, apiClient }) {
        super();
        if (!apiClient || typeof apiClient.get !== 'function') {
            throw new TypeError('HTTP public repository требует ApiClient.');
        }
        this.#encodedReference = encodeURIComponent(assertPublicReference(reference));
        this.#api = apiClient;
    }

    async getSnapshot() {
        try {
            const snapshot = await this.#api.get(`/public/moodboards/${this.#encodedReference}`, {
                credentials: 'omit',
                cache: 'no-store',
            });
            return this._acceptSnapshot(snapshot);
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                this.#assets.clear();
                this.#snapshotLoaded = true;
                return null;
            }
            throw error;
        }
    }

    async getAsset(assetId) {
        const normalizedAssetId = assertPublicReference(assetId);
        const metadata = this.#assets.get(normalizedAssetId);
        if (!this.#snapshotLoaded || !metadata) {
            return null;
        }
        try {
            const blob = await this.#api.get(
                `/public/moodboards/${this.#encodedReference}/assets/${encodeURIComponent(normalizedAssetId)}`,
                {
                    headers: { Accept: 'image/*,application/octet-stream' },
                    responseType: 'blob',
                    credentials: 'omit',
                },
            );
            return {
                id: normalizedAssetId,
                blob,
                width: metadata.width,
                height: metadata.height,
                mimeType: metadata.mimeType || blob.type,
            };
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    _acceptSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object'
            || typeof snapshot.title !== 'string'
            || !Array.isArray(snapshot.document?.pages)
            || !Array.isArray(snapshot.assets)) {
            throw new PublicMoodboardRepositoryError(
                'Public API вернул некорректный snapshot.',
                'INVALID_PUBLIC_SNAPSHOT',
            );
        }
        const assets = new Map();
        for (const asset of snapshot.assets) {
            if (typeof asset?.id === 'string' && asset.id.trim() !== '') {
                assets.set(asset.id, { ...asset });
            }
        }
        this.#assets = assets;
        this.#snapshotLoaded = true;
        return {
            title: snapshot.title,
            document: snapshot.document,
            revision: Number(snapshot.revision) || 0,
            assets: [...assets.values()],
            createdAt: snapshot.createdAt || null,
            expiresAt: snapshot.expiresAt || null,
        };
    }
}
