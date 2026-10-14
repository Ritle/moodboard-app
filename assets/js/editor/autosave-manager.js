const DEFAULT_DEBOUNCE_MS = 1200;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1000, 2500, 5000, 10000]);
const MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_CODES = new Set([
    'INVALID_ARGUMENT',
    'INVALID_ASSET_TYPE',
    'INVALID_IMAGE',
    'INVALID_JSON_RESPONSE',
    'CSRF_TOKEN_REQUIRED',
    'MOODBOARD_ARCHIVED',
    'MOODBOARD_NOT_FOUND',
    'REQUEST_ABORTED',
    'REVISION_CONFLICT',
]);

export function isAutosaveRetryableError(error) {
    if (!error || error.name === 'MoodboardValidationError' || NON_RETRYABLE_CODES.has(error.code)) {
        return false;
    }

    const status = Number(error.status);
    if (Number.isInteger(status) && status >= 400) {
        return RETRYABLE_HTTP_STATUSES.has(status)
            || (status >= 500 && status <= 599 && status !== 501 && status !== 505);
    }

    return true;
}

export function resolveAutosaveRetryDelay(error, configuredDelay) {
    const fallback = Math.max(0, Number(configuredDelay) || 0);
    if (error?.retryAfterMs === null || error?.retryAfterMs === undefined) {
        return fallback;
    }
    const retryAfter = Number(error?.retryAfterMs);
    if (!Number.isFinite(retryAfter) || retryAfter < 0) {
        return fallback;
    }
    return Math.min(MAX_RETRY_DELAY_MS, retryAfter);
}

export class AutosaveManager {
    constructor({
        store,
        repository,
        debounceMs = DEFAULT_DEBOUNCE_MS,
        retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
        onStableSave = () => {},
        draftRepository = null,
        onDraftError = () => {},
    }) {
        this.store = store;
        this.repository = repository;
        this.debounceMs = Math.min(1500, Math.max(1000, Number(debounceMs) || DEFAULT_DEBOUNCE_MS));
        this.retryDelaysMs = Array.isArray(retryDelaysMs) && retryDelaysMs.length > 0
            ? retryDelaysMs.map((delay) => Math.max(0, Number(delay) || 0))
            : [...DEFAULT_RETRY_DELAYS_MS];
        this.changeVersion = 0;
        this.pending = false;
        this.inFlightPromise = null;
        this.saveTimer = null;
        this.retryTimer = null;
        this.retryAttempt = 0;
        this.destroyed = false;
        this.onStableSave = onStableSave;
        this.draftRepository = draftRepository;
        this.onDraftError = onDraftError;
    }

    markChanged() {
        if (this.destroyed || !this.store.moodboardId) {
            return;
        }
        this.changeVersion += 1;
        this.pending = true;
        this._persistRecoveryDraft();
        this.store.setSaveStatus('dirty');
        this._clearTimer('saveTimer');
        this._clearTimer('retryTimer');
        if (!this.inFlightPromise) {
            this._scheduleSave(this.debounceMs);
        }
    }

    async flush() {
        this._clearTimer('saveTimer');
        this._clearTimer('retryTimer');
        if (this.destroyed || !this.store.moodboardId) {
            return false;
        }

        while (this.inFlightPromise || this.pending) {
            if (this.inFlightPromise) {
                await this.inFlightPromise;
                continue;
            }
            const saved = await this._startSave();
            this._clearTimer('saveTimer');
            if (!saved) {
                return false;
            }
            this._clearTimer('retryTimer');
        }
        return true;
    }

    async destroy({ flush = true } = {}) {
        if (this.destroyed) {
            return;
        }
        if (flush) {
            await this.flush();
        }
        this.destroyed = true;
        this._clearTimer('saveTimer');
        this._clearTimer('retryTimer');
    }

    getState() {
        return Object.freeze({
            pending: this.pending,
            saving: Boolean(this.inFlightPromise),
            changeVersion: this.changeVersion,
            retryAttempt: this.retryAttempt,
        });
    }

    _scheduleSave(delay) {
        this._clearTimer('saveTimer');
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this._startSave();
        }, delay);
    }

    _scheduleRetry(error = null) {
        this._clearTimer('retryTimer');
        const index = Math.min(this.retryAttempt, this.retryDelaysMs.length - 1);
        const delay = resolveAutosaveRetryDelay(error, this.retryDelaysMs[index]);
        this.retryAttempt += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this._startSave();
        }, delay);
    }

    _startSave() {
        if (this.inFlightPromise) {
            return this.inFlightPromise;
        }
        if (this.destroyed || !this.pending || !this.store.moodboardId) {
            return Promise.resolve(true);
        }

        this.pending = false;
        const savedChangeVersion = this.changeVersion;
        const moodboardId = this.store.moodboardId;
        const revision = this.store.revision;
        const documentSnapshot = this.store.getDocument();
        this.store.setSaveStatus('saving');

        let completedSuccessfully = false;
        this.inFlightPromise = (async () => {
            try {
                const saved = await this.repository.saveContent(
                    moodboardId,
                    documentSnapshot,
                    revision,
                );
                this.store.setRevision(saved.revision);
                this.retryAttempt = 0;
                completedSuccessfully = true;

                if (this.changeVersion !== savedChangeVersion || this.pending) {
                    this.pending = true;
                    // Более новый черновик теперь основан на только что сохранённой
                    // revision и не должен считаться устаревшим после перезапуска.
                    this._persistRecoveryDraft();
                    this.store.setSaveStatus('dirty');
                } else {
                    this.store.setSaveStatus('saved');
                    this._clearRecoveryDraft(moodboardId);
                    try {
                        Promise.resolve(this.onStableSave({
                            moodboardId,
                            document: documentSnapshot,
                            revision: saved.revision,
                        })).catch(() => {});
                    } catch (_) {
                        // Preview и другие post-save задачи не меняют результат сохранения документа.
                    }
                }
                return true;
            } catch (error) {
                this.pending = true;
                this.store.setSaveStatus(
                    'error',
                    error?.message || 'Не удалось сохранить изменения.',
                );
                if (this._isRetryable(error)) {
                    this._scheduleRetry(error);
                } else {
                    this.retryAttempt = 0;
                }
                return false;
            } finally {
                this.inFlightPromise = null;
                if (completedSuccessfully && this.pending && !this.retryTimer && !this.destroyed) {
                    this._scheduleSave(0);
                }
            }
        })();

        return this.inFlightPromise;
    }

    _isRetryable(error) {
        return isAutosaveRetryableError(error);
    }

    _persistRecoveryDraft() {
        if (!this.draftRepository) {
            return;
        }
        try {
            this.draftRepository.save({
                moodboardId: this.store.moodboardId,
                document: this.store.getDocument(),
                baseRevision: this.store.revision,
                changeVersion: this.changeVersion,
            });
        } catch (error) {
            this._reportDraftError(error);
        }
    }

    _clearRecoveryDraft(moodboardId) {
        if (!this.draftRepository) {
            return;
        }
        try {
            this.draftRepository.remove(moodboardId);
        } catch (error) {
            this._reportDraftError(error);
        }
    }

    _reportDraftError(error) {
        try {
            this.onDraftError(error);
        } catch (_) {
            // Ошибка обработчика не должна прерывать основное сохранение IndexedDB.
        }
    }

    _clearTimer(property) {
        if (this[property] !== null) {
            clearTimeout(this[property]);
            this[property] = null;
        }
    }
}
