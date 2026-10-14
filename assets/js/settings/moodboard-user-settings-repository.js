export const MOODBOARD_SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_IMAGE_ERASER_SIZE = 64;
export const MIN_IMAGE_ERASER_SIZE = 8;
export const MAX_IMAGE_ERASER_SIZE = 256;

export const DEFAULT_MOODBOARD_USER_SETTINGS = Object.freeze({
    showGrid: true,
    showCanvasSheet: true,
    showElementDimensions: false,
    alwaysSnap: true,
    showBindingGuides: false,
    darkMode: false,
    focusMode: false,
    imageEraserSize: DEFAULT_IMAGE_ERASER_SIZE,
});

function normalizeImageEraserSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size)) {
        return DEFAULT_IMAGE_ERASER_SIZE;
    }
    return Math.min(MAX_IMAGE_ERASER_SIZE, Math.max(MIN_IMAGE_ERASER_SIZE, Math.round(size)));
}

function cloneSettings(settings) {
    return {
        showGrid: settings.showGrid,
        showCanvasSheet: settings.showCanvasSheet,
        showElementDimensions: settings.showElementDimensions,
        alwaysSnap: settings.alwaysSnap,
        showBindingGuides: settings.showBindingGuides,
        darkMode: settings.darkMode,
        focusMode: settings.focusMode,
        imageEraserSize: settings.imageEraserSize,
    };
}

export function normalizeMoodboardUserSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return Object.freeze({
        showGrid: source.showGrid !== false,
        showCanvasSheet: source.showCanvasSheet !== false,
        showElementDimensions: source.showElementDimensions === true,
        alwaysSnap: source.alwaysSnap !== false,
        showBindingGuides: source.showBindingGuides === true,
        darkMode: source.darkMode === true,
        focusMode: source.focusMode === true,
        imageEraserSize: normalizeImageEraserSize(source.imageEraserSize),
    });
}

export function buildMoodboardSettingsStorageKey(namespace, userId = null) {
    const safeNamespace = String(namespace || 'moodboards')
        .trim()
        .replace(/[^a-z0-9_.-]+/gi, '-') || 'moodboards';
    const scope = Number.isInteger(userId) && userId > 0 ? `user-${userId}` : 'guest';
    return `${safeNamespace}-settings-${scope}-v${MOODBOARD_SETTINGS_SCHEMA_VERSION}`;
}

export class MoodboardSettingsRepository {
    async load() { throw new Error('Метод load() не реализован.'); }
    async save(settings) { void settings; throw new Error('Метод save() не реализован.'); }
}

export class LocalStorageMoodboardSettingsRepository extends MoodboardSettingsRepository {
    constructor({
        namespace = 'moodboards',
        userId = null,
        storage,
        legacyStorageKey = null,
    } = {}) {
        super();
        this.storageKey = buildMoodboardSettingsStorageKey(namespace, userId);
        this.legacyStorageKey = legacyStorageKey ? String(legacyStorageKey) : null;
        this.storage = storage === undefined ? this._getDefaultStorage() : storage;
        this.memorySettings = normalizeMoodboardUserSettings(DEFAULT_MOODBOARD_USER_SETTINGS);
        this.persistent = Boolean(this.storage);
    }

    async load() {
        const primaryValue = this._read(this.storageKey);
        if (primaryValue !== null) {
            this.memorySettings = this._parse(primaryValue);
            return cloneSettings(this.memorySettings);
        }

        if (this.legacyStorageKey) {
            const legacyValue = this._read(this.legacyStorageKey);
            if (legacyValue !== null) {
                this.memorySettings = this._parse(legacyValue);
                await this.save(this.memorySettings);
                return cloneSettings(this.memorySettings);
            }
        }

        return cloneSettings(this.memorySettings);
    }

    async save(settings) {
        this.memorySettings = normalizeMoodboardUserSettings(settings);
        const record = {
            schemaVersion: MOODBOARD_SETTINGS_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
            settings: cloneSettings(this.memorySettings),
        };
        try {
            this.storage?.setItem(this.storageKey, JSON.stringify(record));
            this.persistent = Boolean(this.storage);
        } catch (_) {
            this.persistent = false;
        }
        return cloneSettings(this.memorySettings);
    }

    _parse(serializedValue) {
        try {
            const parsed = JSON.parse(serializedValue);
            if (
                Number.isInteger(parsed?.schemaVersion)
                && parsed.schemaVersion !== MOODBOARD_SETTINGS_SCHEMA_VERSION
            ) {
                return normalizeMoodboardUserSettings(DEFAULT_MOODBOARD_USER_SETTINGS);
            }
            const settings = parsed?.settings && typeof parsed.settings === 'object'
                ? parsed.settings
                : parsed;
            return normalizeMoodboardUserSettings(settings);
        } catch (_) {
            return normalizeMoodboardUserSettings(DEFAULT_MOODBOARD_USER_SETTINGS);
        }
    }

    _read(key) {
        if (!this.storage || !key) {
            return null;
        }
        try {
            return this.storage.getItem(key);
        } catch (_) {
            this.persistent = false;
            return null;
        }
    }

    _getDefaultStorage() {
        try {
            return globalThis.localStorage || null;
        } catch (_) {
            return null;
        }
    }
}
