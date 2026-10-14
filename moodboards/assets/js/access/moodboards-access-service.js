export const SUPPORTED_TARIFFS = Object.freeze(['guest', 'free', 'basic', 'premium', 'pro']);

export class MoodboardsAccessError extends Error {
    constructor(message, code = 'ACCESS_REQUEST_FAILED') {
        super(message);
        this.name = 'MoodboardsAccessError';
        this.code = code;
    }
}

function isPlainObject(value) {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value);
}

export function normalizeMoodboardsAccessResponse(payload) {
    if (!isPlainObject(payload) || payload.status !== 'success' || !isPlainObject(payload.data)) {
        throw new MoodboardsAccessError(
            'Сервис доступа вернул некорректный ответ.',
            'INVALID_ACCESS_RESPONSE',
        );
    }

    const { data } = payload;
    const features = data.features;
    if (
        typeof data.is_authorized !== 'boolean'
        || !SUPPORTED_TARIFFS.includes(data.tariff_plan)
        || !isPlainObject(features)
        || typeof features.moodboards_allowed !== 'boolean'
        || !Number.isInteger(features.max_moodboards)
        || features.max_moodboards < 0
    ) {
        throw new MoodboardsAccessError(
            'Сервис доступа вернул неполные данные о тарифе.',
            'INVALID_ACCESS_RESPONSE',
        );
    }

    return Object.freeze({
        isAuthorized: data.is_authorized,
        userId: Number.isInteger(data.user_id) ? data.user_id : null,
        tariffPlan: data.tariff_plan,
        moodboardsAllowed: features.moodboards_allowed,
        maxMoodboards: features.max_moodboards,
    });
}

export function buildMoodboardsAccessUrl(endpoint, search = window.location.search) {
    const url = new URL(endpoint, window.location.origin);
    const pageParameters = new URLSearchParams(search);
    const mockTariff = pageParameters.get('mock_tariff');

    if (mockTariff !== null) {
        url.searchParams.set('mock_tariff', mockTariff);
    }

    return url.toString();
}

export async function fetchMoodboardsAccess(endpoint, { signal } = {}) {
    let response;
    try {
        response = await fetch(buildMoodboardsAccessUrl(endpoint), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw error;
        }
        throw new MoodboardsAccessError(
            'Не удалось связаться с сервисом авторизации.',
            'ACCESS_NETWORK_ERROR',
        );
    }

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new MoodboardsAccessError(
            'Сервис авторизации вернул ответ не в формате JSON.',
            'INVALID_ACCESS_RESPONSE',
        );
    }

    if (!response.ok) {
        throw new MoodboardsAccessError(
            payload?.error?.message || 'Не удалось проверить доступ к мудбордам.',
            payload?.error?.code || 'ACCESS_REQUEST_FAILED',
        );
    }

    return normalizeMoodboardsAccessResponse(payload);
}
