import { BACKGROUND_REMOVAL_PRESET_IDS } from '../background-removal-presets.js';

const DEFAULT_TIMEOUT_MS = 130000;
export const BACKGROUND_REMOVAL_PRESETS = BACKGROUND_REMOVAL_PRESET_IDS;

export function resolveDemoBackgroundRemovalPreset(
    search = globalThis.window?.location?.search || '',
) {
    const parameters = new URLSearchParams(search);
    if (parameters.get('mode') !== 'view') {
        return null;
    }
    const requestedPreset = parameters.get('mock_preset');
    return BACKGROUND_REMOVAL_PRESETS.includes(requestedPreset)
        ? requestedPreset
        : 'preset_0';
}

function readErrorMessage(payload, fallback) {
    if (!payload || typeof payload !== 'object') {
        return fallback;
    }
    return String(payload.error?.message || payload.message || fallback);
}

export class BackgroundRemovalClient {
    constructor({
        endpoint,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        fetchImpl = null,
        presetId = null,
    } = {}) {
        this.endpoint = String(endpoint || '').trim();
        this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
        this.fetchImpl = typeof fetchImpl === 'function'
            ? fetchImpl
            : globalThis.fetch?.bind(globalThis);
        this.presetId = BACKGROUND_REMOVAL_PRESETS.includes(presetId) ? presetId : null;
    }

    async remove(blob) {
        if (!(blob instanceof Blob) || !String(blob.type || '').startsWith('image/')) {
            throw new TypeError('Для удаления фона требуется изображение.');
        }
        if (!this.endpoint || typeof this.fetchImpl !== 'function') {
            throw new Error('Сервис удаления фона не настроен.');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const formData = new FormData();
        formData.append('file', blob, `moodboard-image.${this._getExtension(blob.type)}`);
        if (this.presetId !== null) {
            formData.append('preset_id', this.presetId);
        }

        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                body: formData,
                signal: controller.signal,
                credentials: 'same-origin',
                headers: { Accept: 'image/png, application/json' },
            });
            const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
            if (!response.ok) {
                let payload = null;
                if (contentType.includes('application/json')) {
                    try {
                        payload = await response.json();
                    } catch (_) {
                        // Некорректный JSON внешнего сервиса заменяется общей ошибкой.
                    }
                }
                throw new Error(readErrorMessage(payload, 'Не удалось удалить фон изображения.'));
            }
            if (!contentType.startsWith('image/')) {
                throw new Error('Сервис удаления фона вернул некорректный ответ.');
            }
            const result = await response.blob();
            if (result.size === 0 || !String(result.type || contentType).startsWith('image/')) {
                throw new Error('Сервис удаления фона вернул пустое изображение.');
            }
            return result.type ? result : result.slice(0, result.size, contentType.split(';')[0]);
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Удаление фона заняло слишком много времени. Попробуйте ещё раз.');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    _getExtension(mimeType) {
        return {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
        }[String(mimeType || '').toLowerCase()] || 'png';
    }
}
