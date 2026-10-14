import {
    cloneMoodboardDocument,
    validateMoodboardDocument,
} from '../models/moodboard-document.js';

const RECOVERY_DRAFT_SCHEMA_VERSION = 1;

function assertMoodboardId(moodboardId) {
    const normalized = String(moodboardId || '').trim();
    if (!normalized) {
        throw new TypeError('Идентификатор черновика не может быть пустым.');
    }
    return normalized;
}

function normalizeRevision(value) {
    const revision = Number(value);
    if (!Number.isInteger(revision) || revision < 0) {
        throw new TypeError('Ревизия черновика должна быть неотрицательным целым числом.');
    }
    return revision;
}

export function isRecoveryDraftApplicable(draft, record) {
    if (
        !draft
        || !record
        || String(draft.moodboardId) !== String(record.id)
        || !Number.isInteger(draft.baseRevision)
        || !Number.isInteger(record.revision)
        || record.revision > draft.baseRevision
    ) {
        return false;
    }
    try {
        validateMoodboardDocument(draft.document);
        validateMoodboardDocument(record.document);
        return JSON.stringify(draft.document) !== JSON.stringify(record.document);
    } catch (_) {
        return false;
    }
}

export class LocalStorageRecoveryDraftRepository {
    constructor({
        storage,
        namespace = 'moodboards-demo',
    } = {}) {
        this.storage = storage === undefined ? this._getDefaultStorage() : storage;
        this.namespace = String(namespace || 'moodboards-demo');
    }

    save({ moodboardId, document, baseRevision, changeVersion = 0 }) {
        if (!this.storage) {
            throw new Error('localStorage недоступен: аварийный черновик не создан.');
        }
        const normalizedId = assertMoodboardId(moodboardId);
        const normalizedRevision = normalizeRevision(baseRevision);
        validateMoodboardDocument(document);
        const draft = {
            schemaVersion: RECOVERY_DRAFT_SCHEMA_VERSION,
            moodboardId: normalizedId,
            baseRevision: normalizedRevision,
            changeVersion: Math.max(0, Math.floor(Number(changeVersion) || 0)),
            updatedAt: new Date().toISOString(),
            document: cloneMoodboardDocument(document),
        };
        this.storage.setItem(this._key(normalizedId), JSON.stringify(draft));
        return draft;
    }

    load(moodboardId) {
        const normalizedId = assertMoodboardId(moodboardId);
        if (!this.storage) {
            return null;
        }
        const key = this._key(normalizedId);
        const serialized = this.storage.getItem(key);
        if (!serialized) {
            return null;
        }
        try {
            const draft = JSON.parse(serialized);
            if (
                draft?.schemaVersion !== RECOVERY_DRAFT_SCHEMA_VERSION
                || String(draft.moodboardId) !== normalizedId
            ) {
                throw new TypeError('Неподдерживаемый формат аварийного черновика.');
            }
            const baseRevision = normalizeRevision(draft.baseRevision);
            validateMoodboardDocument(draft.document);
            return Object.freeze({
                ...draft,
                baseRevision,
                document: cloneMoodboardDocument(draft.document),
            });
        } catch (_) {
            this.storage.removeItem(key);
            return null;
        }
    }

    remove(moodboardId) {
        this.storage?.removeItem(this._key(assertMoodboardId(moodboardId)));
    }

    _key(moodboardId) {
        return `${this.namespace}:recovery-draft:v1:${encodeURIComponent(moodboardId)}`;
    }

    _getDefaultStorage() {
        try {
            return globalThis.localStorage || null;
        } catch (_) {
            return null;
        }
    }
}
