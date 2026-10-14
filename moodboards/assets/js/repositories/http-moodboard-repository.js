import { ApiClient, ApiClientError } from '../api/api-client.js';
import { MoodboardRepository } from './repository-interface.js';

export class HttpMoodboardRepositoryError extends ApiClientError {
    constructor(message, code = 'REPOSITORY_ERROR', details = {}, status = 0) {
        super(message, { code, details, status });
        this.name = 'HttpMoodboardRepositoryError';
    }
}

/**
 * Runtime HTTP-адаптер приватного MoodboardRepository.
 * Реального backend в демо нет; активация выполняется через storage.driver = "http".
 */
export class HttpMoodboardRepository extends MoodboardRepository {
    constructor({
        apiClient = null,
        baseUrl = '/api',
        fetchImpl = globalThis.fetch,
        csrfToken = '',
        requireCsrf = true,
        timeoutMs = 15_000,
        retryCount = 1,
    } = {}) {
        super();
        this.api = apiClient || new ApiClient({
            baseUrl,
            fetchImpl,
            csrfToken,
            requireCsrf,
            timeoutMs,
            retryCount,
        });
    }

    async list() {
        const payload = await this.api.get('/moodboards');
        return payload.items ?? payload;
    }

    create(data) {
        return this.api.post('/moodboards', {
            json: data,
            idempotencyKey: true,
        });
    }

    async get(id) {
        try {
            return await this.api.get(`/moodboards/${this._id(id)}`);
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    updateMeta(id, data) {
        return this.api.patch(`/moodboards/${this._id(id)}`, { json: data });
    }

    setArchived(id, archived) {
        return this.api.put(`/moodboards/${this._id(id)}/archive`, {
            json: { archived: Boolean(archived) },
        });
    }

    saveContent(id, document, revision) {
        return this.api.put(`/moodboards/${this._id(id)}/content`, {
            json: { document, revision },
        });
    }

    async delete(id) {
        try {
            await this.api.delete(`/moodboards/${this._id(id)}`, { responseType: 'none' });
            return true;
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                return false;
            }
            throw error;
        }
    }

    duplicate(id) {
        return this.api.post(`/moodboards/${this._id(id)}/duplicate`, {
            idempotencyKey: true,
        });
    }

    addAsset(moodboardId, file) {
        const formData = new FormData();
        formData.append('file', file, file.name || 'image');
        return this.api.post(`/moodboards/${this._id(moodboardId)}/assets`, {
            body: formData,
            idempotencyKey: true,
        });
    }

    async getAsset(assetId) {
        const normalizedAssetId = this._id(assetId);
        try {
            const response = await this.api.get(`/assets/${normalizedAssetId}`, {
                headers: { Accept: 'image/*,application/octet-stream' },
                responseType: 'response',
            });
            const blob = await response.blob();
            return {
                id: assetId,
                moodboardId: response.headers.get('X-Moodboard-Id'),
                blob,
                width: Number(response.headers.get('X-Image-Width')),
                height: Number(response.headers.get('X-Image-Height')),
                mimeType: blob.type,
                createdAt: response.headers.get('X-Created-At'),
            };
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async deleteAsset(assetId) {
        try {
            await this.api.delete(`/assets/${this._id(assetId)}`, { responseType: 'none' });
            return true;
        } catch (error) {
            if (error instanceof ApiClientError && error.status === 404) {
                return false;
            }
            throw error;
        }
    }

    savePreview(moodboardId, blob) {
        const path = `/moodboards/${this._id(moodboardId)}/preview`;
        if (blob === null) {
            return this.api.delete(path);
        }
        return this.api.put(path, {
            headers: { 'Content-Type': blob.type || 'image/png' },
            body: blob,
        });
    }

    close() {
        // У HTTP-адаптера нет постоянного соединения; метод оставлен для общего lifecycle.
    }

    _id(value) {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new HttpMoodboardRepositoryError(
                'ID должен быть непустой строкой.',
                'INVALID_ARGUMENT',
            );
        }
        return encodeURIComponent(value);
    }
}
