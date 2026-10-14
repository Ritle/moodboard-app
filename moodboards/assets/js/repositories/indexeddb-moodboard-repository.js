import {
    MoodboardValidationError,
    cloneMoodboardDocument,
    cloneValue,
    createMoodboardDocument,
} from '../models/moodboard-document.js';
import { MoodboardRepository } from './repository-interface.js';

const MOODBOARDS_STORE = 'moodboards';
const ASSETS_STORE = 'assets';
const ASSET_MOODBOARD_INDEX = 'moodboardId';

export class MoodboardRepositoryError extends Error {
    constructor(message, code = 'REPOSITORY_ERROR', details = {}) {
        super(message);
        this.name = 'MoodboardRepositoryError';
        this.code = code;
        this.details = { ...details };
    }
}

export class IndexedDbUnavailableError extends MoodboardRepositoryError {
    constructor(message = 'IndexedDB недоступна в этом браузере.', details = {}) {
        super(message, 'INDEXEDDB_UNAVAILABLE', details);
        this.name = 'IndexedDbUnavailableError';
    }
}

export class MoodboardNotFoundError extends MoodboardRepositoryError {
    constructor(id) {
        super(`MoodBoard «${id}» не найден.`, 'MOODBOARD_NOT_FOUND', { id });
        this.name = 'MoodboardNotFoundError';
    }
}

export class RevisionConflictError extends MoodboardRepositoryError {
    constructor(id, expectedRevision, actualRevision) {
        super(
            `MoodBoard «${id}» уже изменён. Ожидалась ревизия ${expectedRevision}, текущая — ${actualRevision}.`,
            'REVISION_CONFLICT',
            { id, expectedRevision, actualRevision },
        );
        this.name = 'RevisionConflictError';
    }
}

function assertNonEmptyId(id, fieldName = 'id') {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new MoodboardRepositoryError(`${fieldName} должен быть непустой строкой.`, 'INVALID_ARGUMENT');
    }
}

function normalizeTitle(title, fallback = 'Новый проект 1') {
    if (title === undefined) {
        return fallback;
    }

    if (typeof title !== 'string' || title.trim() === '') {
        throw new MoodboardRepositoryError('Название MoodBoard должно быть непустой строкой.', 'INVALID_ARGUMENT');
    }

    const normalized = title.trim();
    if (normalized.length > 160) {
        throw new MoodboardRepositoryError('Название MoodBoard не должно превышать 160 символов.', 'INVALID_ARGUMENT');
    }

    return normalized;
}

function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => {
            reject(request.error || new Error('IndexedDB request завершился с ошибкой.'));
        }, { once: true });
    });
}

function transactionAsPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), { once: true });
        transaction.addEventListener('abort', () => {
            reject(transaction.error || new Error('Транзакция IndexedDB отменена.'));
        }, { once: true });
        transaction.addEventListener('error', () => {
            reject(transaction.error || new Error('Транзакция IndexedDB завершилась с ошибкой.'));
        }, { once: true });
    });
}

function cloneRecord(record) {
    return record === null || record === undefined ? null : cloneValue(record);
}

export class MoodboardArchivedError extends MoodboardRepositoryError {
    constructor(id) {
        super(`MoodBoard «${id}» находится в архиве.`, 'MOODBOARD_ARCHIVED', { id });
        this.name = 'MoodboardArchivedError';
    }
}

function normalizeStoredRecord(record) {
    const id = typeof record?.id === 'string' && record.id.trim() !== ''
        ? record.id
        : null;

    try {
        if (record === null || typeof record !== 'object' || Array.isArray(record)) {
            throw new TypeError('Запись должна быть объектом.');
        }
        assertNonEmptyId(record.id);
        const title = normalizeTitle(record.title);
        if (!Number.isInteger(record.revision) || record.revision < 0) {
            throw new TypeError('Ревизия должна быть неотрицательным целым числом.');
        }
        for (const field of ['createdAt', 'updatedAt']) {
            if (
                typeof record[field] !== 'string'
                || record[field].trim() === ''
                || Number.isNaN(Date.parse(record[field]))
            ) {
                throw new TypeError(`${field} должен содержать корректную дату.`);
            }
        }
        if (
            record.previewBlob !== undefined
            && record.previewBlob !== null
            && (!(record.previewBlob instanceof Blob) || !record.previewBlob.type.startsWith('image/'))
        ) {
            throw new TypeError('previewBlob должен быть изображением Blob или null.');
        }
        const archivedAt = record.archivedAt ?? null;
        if (
            archivedAt !== null
            && (
                typeof archivedAt !== 'string'
                || archivedAt.trim() === ''
                || Number.isNaN(Date.parse(archivedAt))
            )
        ) {
            throw new TypeError('archivedAt должен содержать корректную дату или null.');
        }

        return {
            ...record,
            title,
            document: cloneMoodboardDocument(record.document),
            previewBlob: record.previewBlob ?? null,
            archivedAt,
        };
    } catch (error) {
        if (error instanceof MoodboardRepositoryError && error.code === 'CORRUPT_RECORD') {
            throw error;
        }
        const corruptRecordError = new MoodboardRepositoryError(
            `Локальная запись MoodBoard${id ? ` «${id}»` : ''} повреждена.`,
            'CORRUPT_RECORD',
            { id },
        );
        corruptRecordError.cause = error;
        throw corruptRecordError;
    }
}

function assertRecordActive(record) {
    if (record.archivedAt !== null) {
        throw new MoodboardArchivedError(record.id);
    }
}

function toRepositoryError(error, action) {
    if (error instanceof MoodboardRepositoryError || error instanceof MoodboardValidationError) {
        return error;
    }

    const wrapped = new MoodboardRepositoryError(
        `Не удалось ${action}. ${error?.message || 'Неизвестная ошибка IndexedDB.'}`,
        'INDEXEDDB_OPERATION_FAILED',
    );
    wrapped.cause = error;
    return wrapped;
}

function replaceAssetReferences(value, assetIdMap) {
    if (Array.isArray(value)) {
        return value.map((item) => replaceAssetReferences(item, assetIdMap));
    }

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (key === 'assetId' && typeof item === 'string' && assetIdMap.has(item)) {
                return [key, assetIdMap.get(item)];
            }
            return [key, replaceAssetReferences(item, assetIdMap)];
        }));
    }

    return value;
}

async function getImageDimensions(blob) {
    if (typeof globalThis.createImageBitmap === 'function') {
        const bitmap = await globalThis.createImageBitmap(blob);
        try {
            return { width: bitmap.width, height: bitmap.height };
        } finally {
            bitmap.close();
        }
    }

    if (typeof Image === 'undefined' || typeof URL === 'undefined') {
        throw new MoodboardRepositoryError(
            'Браузер не поддерживает чтение размеров изображения.',
            'IMAGE_DECODER_UNAVAILABLE',
        );
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new MoodboardRepositoryError(
                'Не удалось прочитать изображение.',
                'INVALID_IMAGE',
            ));
            image.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export class IndexedDbMoodboardRepository extends MoodboardRepository {
    constructor(options = {}) {
        super();

        this.databaseName = options.databaseName || 'moodboards-demo';
        this.version = options.version ?? 1;
        this.idFactory = options.idFactory || (() => {
            if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
                throw new IndexedDbUnavailableError('crypto.randomUUID() недоступен в этом окружении.');
            }
            return globalThis.crypto.randomUUID();
        });
        this.databasePromise = null;

        if (!Number.isInteger(this.version) || this.version < 1) {
            throw new MoodboardRepositoryError('Версия IndexedDB должна быть положительным целым числом.', 'INVALID_ARGUMENT');
        }
    }

    static isSupported() {
        return typeof globalThis.indexedDB !== 'undefined';
    }

    async open() {
        if (!IndexedDbMoodboardRepository.isSupported()) {
            throw new IndexedDbUnavailableError();
        }

        if (!this.databasePromise) {
            this.databasePromise = this._openDatabase().catch((error) => {
                this.databasePromise = null;
                throw error;
            });
        }

        return this.databasePromise;
    }

    async _openDatabase() {
        return new Promise((resolve, reject) => {
            let settled = false;
            let upgradeError = null;
            let request;

            try {
                request = globalThis.indexedDB.open(this.databaseName, this.version);
            } catch (error) {
                reject(new IndexedDbUnavailableError('Не удалось открыть IndexedDB.', { cause: error }));
                return;
            }

            request.addEventListener('upgradeneeded', () => {
                try {
                    const database = request.result;
                    const transaction = request.transaction;

                    const moodboardsStore = database.objectStoreNames.contains(MOODBOARDS_STORE)
                        ? transaction.objectStore(MOODBOARDS_STORE)
                        : database.createObjectStore(MOODBOARDS_STORE, { keyPath: 'id' });

                    const assetsStore = database.objectStoreNames.contains(ASSETS_STORE)
                        ? transaction.objectStore(ASSETS_STORE)
                        : database.createObjectStore(ASSETS_STORE, { keyPath: 'id' });

                    if (!assetsStore.indexNames.contains(ASSET_MOODBOARD_INDEX)) {
                        assetsStore.createIndex(ASSET_MOODBOARD_INDEX, 'moodboardId', { unique: false });
                    }

                    void moodboardsStore;
                } catch (error) {
                    upgradeError = error;
                    request.transaction?.abort();
                }
            });

            request.addEventListener('success', () => {
                const database = request.result;
                if (settled) {
                    database.close();
                    return;
                }

                settled = true;
                database.addEventListener('versionchange', () => {
                    database.close();
                    this.databasePromise = null;
                });
                resolve(database);
            }, { once: true });

            request.addEventListener('error', () => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(toRepositoryError(upgradeError || request.error, 'открыть локальное хранилище'));
            }, { once: true });

            request.addEventListener('blocked', () => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(new MoodboardRepositoryError(
                    'Обновление IndexedDB заблокировано другой открытой вкладкой.',
                    'INDEXEDDB_UPGRADE_BLOCKED',
                ));
            }, { once: true });
        });
    }

    async close() {
        if (!this.databasePromise) {
            return;
        }

        try {
            const database = await this.databasePromise;
            database.close();
        } finally {
            this.databasePromise = null;
        }
    }

    async _runTransaction(storeNames, mode, action, operation) {
        const database = await this.open();
        let transaction;

        try {
            transaction = database.transaction(storeNames, mode);
        } catch (error) {
            throw toRepositoryError(error, action);
        }

        const completion = transactionAsPromise(transaction).then(
            () => ({ error: null }),
            (error) => ({ error }),
        );

        try {
            const result = await operation(transaction);
            const { error } = await completion;
            if (error) {
                throw error;
            }
            return cloneRecord(result);
        } catch (error) {
            try {
                transaction.abort();
            } catch (_) {
                // Транзакция уже завершена или автоматически отменена браузером.
            }
            await completion;
            throw toRepositoryError(error, action);
        }
    }

    async list() {
        return this._runTransaction([MOODBOARDS_STORE], 'readonly', 'получить список MoodBoards', async (transaction) => {
            const records = await requestAsPromise(transaction.objectStore(MOODBOARDS_STORE).getAll());
            return records
                .map((record) => normalizeStoredRecord(record))
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        });
    }

    async create(data = {}) {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            throw new MoodboardRepositoryError('Данные нового MoodBoard должны быть объектом.', 'INVALID_ARGUMENT');
        }

        const now = new Date().toISOString();
        const record = {
            id: this.idFactory(),
            title: normalizeTitle(data.title),
            document: data.document === undefined
                ? createMoodboardDocument()
                : cloneMoodboardDocument(data.document),
            revision: 0,
            previewBlob: null,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
        };

        return this._runTransaction([MOODBOARDS_STORE], 'readwrite', 'создать MoodBoard', async (transaction) => {
            await requestAsPromise(transaction.objectStore(MOODBOARDS_STORE).add(record));
            return record;
        });
    }

    async get(id) {
        assertNonEmptyId(id);
        return this._runTransaction([MOODBOARDS_STORE], 'readonly', 'получить MoodBoard', async (transaction) => {
            const record = await requestAsPromise(transaction.objectStore(MOODBOARDS_STORE).get(id));
            return record ? normalizeStoredRecord(record) : null;
        });
    }

    async updateMeta(id, data) {
        assertNonEmptyId(id);
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            throw new MoodboardRepositoryError('Метаданные должны быть объектом.', 'INVALID_ARGUMENT');
        }

        return this._runTransaction([MOODBOARDS_STORE], 'readwrite', 'обновить метаданные MoodBoard', async (transaction) => {
            const store = transaction.objectStore(MOODBOARDS_STORE);
            const record = await requestAsPromise(store.get(id));
            if (!record) {
                throw new MoodboardNotFoundError(id);
            }

            const normalizedRecord = normalizeStoredRecord(record);
            assertRecordActive(normalizedRecord);

            if (Object.prototype.hasOwnProperty.call(data, 'title')) {
                normalizedRecord.title = normalizeTitle(data.title);
            }
            normalizedRecord.updatedAt = new Date().toISOString();
            await requestAsPromise(store.put(normalizedRecord));
            return normalizedRecord;
        });
    }

    async setArchived(id, archived) {
        assertNonEmptyId(id);
        if (typeof archived !== 'boolean') {
            throw new MoodboardRepositoryError('Состояние архива должно быть boolean.', 'INVALID_ARGUMENT');
        }

        return this._runTransaction([MOODBOARDS_STORE], 'readwrite', 'изменить состояние архива MoodBoard', async (transaction) => {
            const store = transaction.objectStore(MOODBOARDS_STORE);
            const record = await requestAsPromise(store.get(id));
            if (!record) {
                throw new MoodboardNotFoundError(id);
            }

            const normalizedRecord = normalizeStoredRecord(record);
            if ((normalizedRecord.archivedAt !== null) === archived) {
                return normalizedRecord;
            }

            const now = new Date().toISOString();
            normalizedRecord.archivedAt = archived ? now : null;
            normalizedRecord.updatedAt = now;
            await requestAsPromise(store.put(normalizedRecord));
            return normalizedRecord;
        });
    }

    async saveContent(id, document, revision) {
        assertNonEmptyId(id);
        if (!Number.isInteger(revision) || revision < 0) {
            throw new MoodboardRepositoryError('Ревизия должна быть неотрицательным целым числом.', 'INVALID_ARGUMENT');
        }
        const documentCopy = cloneMoodboardDocument(document);

        return this._runTransaction([MOODBOARDS_STORE], 'readwrite', 'сохранить содержимое MoodBoard', async (transaction) => {
            const store = transaction.objectStore(MOODBOARDS_STORE);
            const record = await requestAsPromise(store.get(id));
            if (!record) {
                throw new MoodboardNotFoundError(id);
            }
            const normalizedRecord = normalizeStoredRecord(record);
            assertRecordActive(normalizedRecord);
            if (normalizedRecord.revision !== revision) {
                throw new RevisionConflictError(id, revision, normalizedRecord.revision);
            }

            normalizedRecord.document = documentCopy;
            normalizedRecord.revision += 1;
            normalizedRecord.updatedAt = new Date().toISOString();
            await requestAsPromise(store.put(normalizedRecord));
            return normalizedRecord;
        });
    }

    async delete(id) {
        assertNonEmptyId(id);
        return this._runTransaction(
            [MOODBOARDS_STORE, ASSETS_STORE],
            'readwrite',
            'удалить MoodBoard',
            async (transaction) => {
                const moodboardsStore = transaction.objectStore(MOODBOARDS_STORE);
                const assetsStore = transaction.objectStore(ASSETS_STORE);
                const existing = await requestAsPromise(moodboardsStore.get(id));
                if (!existing) {
                    return false;
                }

                const assetKeys = await requestAsPromise(
                    assetsStore.index(ASSET_MOODBOARD_INDEX).getAllKeys(id),
                );
                for (const assetId of assetKeys) {
                    await requestAsPromise(assetsStore.delete(assetId));
                }
                await requestAsPromise(moodboardsStore.delete(id));
                return true;
            },
        );
    }

    async duplicate(id) {
        assertNonEmptyId(id);
        return this._runTransaction(
            [MOODBOARDS_STORE, ASSETS_STORE],
            'readwrite',
            'дублировать MoodBoard',
            async (transaction) => {
                const moodboardsStore = transaction.objectStore(MOODBOARDS_STORE);
                const assetsStore = transaction.objectStore(ASSETS_STORE);
                const source = await requestAsPromise(moodboardsStore.get(id));
                if (!source) {
                    throw new MoodboardNotFoundError(id);
                }
                const normalizedSource = normalizeStoredRecord(source);
                assertRecordActive(normalizedSource);

                const sourceAssets = await requestAsPromise(
                    assetsStore.index(ASSET_MOODBOARD_INDEX).getAll(id),
                );
                const duplicateId = this.idFactory();
                const assetIdMap = new Map(sourceAssets.map((asset) => [asset.id, this.idFactory()]));
                const now = new Date().toISOString();
                const duplicate = {
                    id: duplicateId,
                    title: normalizeTitle(`Копия ${normalizedSource.title}`.slice(0, 160)),
                    document: replaceAssetReferences(normalizedSource.document, assetIdMap),
                    revision: 0,
                    previewBlob: normalizedSource.previewBlob ? cloneValue(normalizedSource.previewBlob) : null,
                    archivedAt: null,
                    createdAt: now,
                    updatedAt: now,
                };

                await requestAsPromise(moodboardsStore.add(duplicate));
                for (const asset of sourceAssets) {
                    await requestAsPromise(assetsStore.add({
                        ...asset,
                        id: assetIdMap.get(asset.id),
                        moodboardId: duplicateId,
                        blob: cloneValue(asset.blob),
                        createdAt: now,
                    }));
                }

                return duplicate;
            },
        );
    }

    async addAsset(moodboardId, file) {
        assertNonEmptyId(moodboardId, 'moodboardId');
        if (!(file instanceof Blob)) {
            throw new MoodboardRepositoryError('Ассет должен быть объектом Blob или File.', 'INVALID_ARGUMENT');
        }
        if (!file.type.startsWith('image/')) {
            throw new MoodboardRepositoryError('Поддерживаются только изображения.', 'INVALID_ASSET_TYPE');
        }

        let dimensions;
        try {
            dimensions = await getImageDimensions(file);
        } catch (error) {
            if (error instanceof MoodboardRepositoryError) {
                throw error;
            }
            const wrapped = new MoodboardRepositoryError(
                `Не удалось декодировать изображение. ${error?.message || ''}`.trim(),
                'INVALID_IMAGE',
            );
            wrapped.cause = error;
            throw wrapped;
        }
        const asset = {
            id: this.idFactory(),
            moodboardId,
            blob: file.slice(0, file.size, file.type),
            width: dimensions.width,
            height: dimensions.height,
            mimeType: file.type,
            createdAt: new Date().toISOString(),
        };

        return this._runTransaction(
            [MOODBOARDS_STORE, ASSETS_STORE],
            'readwrite',
            'сохранить изображение',
            async (transaction) => {
                const moodboard = await requestAsPromise(
                    transaction.objectStore(MOODBOARDS_STORE).get(moodboardId),
                );
                if (!moodboard) {
                    throw new MoodboardNotFoundError(moodboardId);
                }
                assertRecordActive(normalizeStoredRecord(moodboard));
                await requestAsPromise(transaction.objectStore(ASSETS_STORE).add(asset));
                return asset;
            },
        );
    }

    async getAsset(assetId) {
        assertNonEmptyId(assetId, 'assetId');
        return this._runTransaction([ASSETS_STORE], 'readonly', 'получить изображение', async (transaction) => {
            const asset = await requestAsPromise(transaction.objectStore(ASSETS_STORE).get(assetId));
            return asset || null;
        });
    }

    async deleteAsset(assetId) {
        assertNonEmptyId(assetId, 'assetId');
        return this._runTransaction([ASSETS_STORE], 'readwrite', 'удалить изображение', async (transaction) => {
            const store = transaction.objectStore(ASSETS_STORE);
            const existing = await requestAsPromise(store.get(assetId));
            if (!existing) {
                return false;
            }
            await requestAsPromise(store.delete(assetId));
            return true;
        });
    }

    async savePreview(moodboardId, blob) {
        assertNonEmptyId(moodboardId, 'moodboardId');
        if (blob !== null && (!(blob instanceof Blob) || !blob.type.startsWith('image/'))) {
            throw new MoodboardRepositoryError('Превью должно быть изображением Blob или null.', 'INVALID_ARGUMENT');
        }
        const previewCopy = blob === null ? null : blob.slice(0, blob.size, blob.type);

        return this._runTransaction([MOODBOARDS_STORE], 'readwrite', 'сохранить превью', async (transaction) => {
            const store = transaction.objectStore(MOODBOARDS_STORE);
            const record = await requestAsPromise(store.get(moodboardId));
            if (!record) {
                throw new MoodboardNotFoundError(moodboardId);
            }
            const normalizedRecord = normalizeStoredRecord(record);
            assertRecordActive(normalizedRecord);
            normalizedRecord.previewBlob = previewCopy;
            normalizedRecord.updatedAt = new Date().toISOString();
            await requestAsPromise(store.put(normalizedRecord));
            return normalizedRecord;
        });
    }
}
