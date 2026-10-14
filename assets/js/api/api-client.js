const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_DELAY_MS = 30_000;

function createOpaqueId(prefix = 'request') {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBaseUrl(baseUrl) {
    const value = String(baseUrl || '').trim();
    if (value === '') {
        return '';
    }
    return value.replace(/\/+$/, '');
}

function buildRequestUrl(baseUrl, path) {
    const value = String(path || '').trim();
    if (value === '') {
        throw new ApiClientError('Путь API должен быть непустой строкой.', {
            code: 'INVALID_ARGUMENT',
        });
    }
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    if (baseUrl === '') {
        return value;
    }
    return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

function parseRetryAfter(value, now = Date.now()) {
    if (!value) {
        return null;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1000));
    }
    const date = Date.parse(value);
    return Number.isFinite(date)
        ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - now))
        : null;
}

function defaultRetryDelay(attempt) {
    return Math.min(MAX_RETRY_DELAY_MS, 500 * (2 ** attempt));
}

function delay(milliseconds, signal) {
    if (milliseconds <= 0) {
        return Promise.resolve();
    }
    if (signal?.aborted) {
        return Promise.reject(signal.reason || new DOMException('Запрос отменён.', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, milliseconds);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Запрос отменён.', 'AbortError'));
        }, { once: true });
    });
}

function isReusableBody(body) {
    return typeof ReadableStream === 'undefined' || !(body instanceof ReadableStream);
}

export class ApiClientError extends Error {
    constructor(message, {
        code = 'API_ERROR',
        status = 0,
        details = {},
        requestId = null,
        retryAfterMs = null,
        cause = null,
    } = {}) {
        super(message);
        this.name = 'ApiClientError';
        this.code = code;
        this.status = status;
        this.details = details && typeof details === 'object' ? details : {};
        this.requestId = requestId;
        this.retryAfterMs = retryAfterMs;
        if (cause) {
            this.cause = cause;
        }
    }
}

export class ApiClient {
    constructor({
        baseUrl = '/api',
        fetchImpl = globalThis.fetch,
        csrfToken = '',
        requireCsrf = false,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retryCount = 0,
        requestIdFactory = () => createOpaqueId('request'),
        idempotencyKeyFactory = () => createOpaqueId('idempotency'),
    } = {}) {
        if (typeof fetchImpl !== 'function') {
            throw new TypeError('Для ApiClient требуется fetch().');
        }
        if (typeof requestIdFactory !== 'function' || typeof idempotencyKeyFactory !== 'function') {
            throw new TypeError('Фабрики request ID и idempotency key должны быть функциями.');
        }
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.fetch = fetchImpl;
        this.csrfToken = String(csrfToken || '').trim();
        this.requireCsrf = Boolean(requireCsrf);
        const normalizedTimeout = Number(timeoutMs);
        this.timeoutMs = Number.isFinite(normalizedTimeout) && normalizedTimeout >= 0
            ? normalizedTimeout
            : DEFAULT_TIMEOUT_MS;
        this.retryCount = Math.max(0, Math.min(5, Number.parseInt(retryCount, 10) || 0));
        this.requestIdFactory = requestIdFactory;
        this.idempotencyKeyFactory = idempotencyKeyFactory;
    }

    get(path, options = {}) {
        return this.request(path, { ...options, method: 'GET' });
    }

    post(path, options = {}) {
        return this.request(path, { ...options, method: 'POST' });
    }

    put(path, options = {}) {
        return this.request(path, { ...options, method: 'PUT' });
    }

    patch(path, options = {}) {
        return this.request(path, { ...options, method: 'PATCH' });
    }

    delete(path, options = {}) {
        return this.request(path, { ...options, method: 'DELETE' });
    }

    async request(path, {
        method = 'GET',
        headers = {},
        body,
        json,
        responseType = 'json',
        signal = null,
        timeoutMs = this.timeoutMs,
        retryCount = this.retryCount,
        idempotencyKey = null,
        credentials = 'same-origin',
        cache,
    } = {}) {
        const normalizedMethod = String(method || 'GET').toUpperCase();
        const url = buildRequestUrl(this.baseUrl, path);
        if (body !== undefined && json !== undefined) {
            throw new ApiClientError('Нельзя одновременно передать body и json.', {
                code: 'INVALID_ARGUMENT',
            });
        }

        const requestHeaders = new Headers(headers);
        if (!requestHeaders.has('Accept')) {
            requestHeaders.set('Accept', 'application/json');
        }
        const requestId = requestHeaders.get('X-Request-Id') || String(this.requestIdFactory());
        requestHeaders.set('X-Request-Id', requestId);

        if (!SAFE_METHODS.has(normalizedMethod)) {
            if (this.requireCsrf && !this.csrfToken && !requestHeaders.has('X-CSRF-Token')) {
                throw new ApiClientError('Для изменения данных требуется CSRF token.', {
                    code: 'CSRF_TOKEN_REQUIRED',
                    requestId,
                });
            }
            if (this.csrfToken && !requestHeaders.has('X-CSRF-Token')) {
                requestHeaders.set('X-CSRF-Token', this.csrfToken);
            }
        }

        if (idempotencyKey) {
            requestHeaders.set(
                'Idempotency-Key',
                idempotencyKey === true ? String(this.idempotencyKeyFactory()) : String(idempotencyKey),
            );
        }

        let requestBody = body;
        if (json !== undefined) {
            requestHeaders.set('Content-Type', 'application/json');
            requestBody = JSON.stringify(json);
        }

        const attempts = Math.max(0, Math.min(5, Number.parseInt(retryCount, 10) || 0)) + 1;
        const canRetry = (
            SAFE_METHODS.has(normalizedMethod)
            || requestHeaders.has('Idempotency-Key')
        ) && isReusableBody(requestBody);
        let lastError = null;

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await this._execute(url, {
                    method: normalizedMethod,
                    headers: requestHeaders,
                    body: requestBody,
                    responseType,
                    signal,
                    timeoutMs,
                    credentials,
                    cache,
                });
            } catch (error) {
                lastError = error;
                const retryable = canRetry
                    && attempt + 1 < attempts
                    && error instanceof ApiClientError
                    && (error.code === 'NETWORK_ERROR' || RETRYABLE_STATUSES.has(error.status));
                if (!retryable) {
                    throw error;
                }
                try {
                    await delay(error.retryAfterMs ?? defaultRetryDelay(attempt), signal);
                } catch (delayError) {
                    throw new ApiClientError('Запрос API отменён.', {
                        code: 'REQUEST_ABORTED',
                        requestId,
                        cause: delayError,
                    });
                }
            }
        }
        throw lastError;
    }

    async _execute(url, options) {
        const controller = new AbortController();
        const requestId = options.headers.get('X-Request-Id');
        let timedOut = false;
        const onAbort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) {
            controller.abort(options.signal.reason);
        } else {
            options.signal?.addEventListener('abort', onAbort, { once: true });
        }
        const timeout = Number(options.timeoutMs) > 0
            ? setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, Number(options.timeoutMs))
            : null;

        try {
            const response = await this.fetch(url, {
                method: options.method,
                headers: options.headers,
                body: options.body,
                credentials: options.credentials,
                signal: controller.signal,
                ...(options.cache ? { cache: options.cache } : {}),
            });
            if (!response.ok) {
                throw await this._createResponseError(response);
            }
            return await this._readSuccessResponse(response, options.responseType);
        } catch (error) {
            if (error instanceof ApiClientError) {
                throw error;
            }
            if (timedOut) {
                throw new ApiClientError('Превышено время ожидания ответа API.', {
                    code: 'REQUEST_TIMEOUT',
                    requestId,
                    cause: error,
                });
            }
            if (options.signal?.aborted || error?.name === 'AbortError') {
                throw new ApiClientError('Запрос API отменён.', {
                    code: 'REQUEST_ABORTED',
                    requestId,
                    cause: error,
                });
            }
            throw new ApiClientError('Не удалось выполнить запрос к API.', {
                code: 'NETWORK_ERROR',
                requestId,
                cause: error,
            });
        } finally {
            if (timeout !== null) {
                clearTimeout(timeout);
            }
            options.signal?.removeEventListener('abort', onAbort);
        }
    }

    async _readSuccessResponse(response, responseType) {
        if (responseType === 'response') {
            return response;
        }
        if (response.status === 204 || responseType === 'none') {
            return null;
        }
        if (responseType === 'blob') {
            return response.blob();
        }
        if (responseType === 'text') {
            return response.text();
        }
        try {
            return await response.json();
        } catch (error) {
            throw new ApiClientError('API вернул ответ не в формате JSON.', {
                code: 'INVALID_JSON_RESPONSE',
                status: response.status,
                requestId: response.headers.get('X-Request-Id'),
                cause: error,
            });
        }
    }

    async _createResponseError(response) {
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (_) {
            // HTML и plain text не попадают в пользовательское сообщение.
        }
        const envelope = payload?.error && typeof payload.error === 'object'
            ? payload.error
            : (payload && typeof payload === 'object' ? payload : {});
        return new ApiClientError(
            envelope.message || `API вернул HTTP ${response.status}.`,
            {
                code: envelope.code || 'API_REQUEST_FAILED',
                status: response.status,
                details: envelope.details || {},
                requestId: envelope.requestId || response.headers.get('X-Request-Id'),
                retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
            },
        );
    }
}
