import { validateImageEraseMask } from './image-erase-mask.js';

export const MOODBOARD_SCHEMA_VERSION = 2;
export const LEGACY_MOODBOARD_SCHEMA_VERSION = 1;
export const MAX_PAGE_NAME_LENGTH = 80;
export const MAX_GROUP_DEPTH = 12;
export const SUPPORTED_SHAPE_TYPES = Object.freeze([
    'rectangle',
    'circle',
    'diamond',
    'triangle',
    'star',
    'oval',
    'hexagon',
    'cloud',
    'arrow-left',
    'arrow-up',
    'arrow-down',
    'arrow-right',
    'checkbox-x',
    'checkbox-v',
]);

export class MoodboardValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'MoodboardValidationError';
        this.details = { ...details };
    }
}

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

const SUPPORTED_ELEMENT_TYPES = new Set([
    'text',
    'shape',
    'rectangle',
    'image',
    'brush',
    'highlighter',
    'sticker',
    'frame',
    'arrow',
]);
const ARROW_BINDING_TARGET_TYPES = new Set([
    'text', 'shape', 'rectangle', 'image', 'sticker', 'frame',
]);
const FORBIDDEN_KONVA_PROPERTIES = ['scaleX', 'scaleY', 'draggable', 'className', '_id'];

function createId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePageName(name, fallback = 'Лист 1') {
    const value = name === undefined ? fallback : name;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new MoodboardValidationError('Название листа должно быть непустой строкой.');
    }
    const normalized = value.trim();
    if (normalized.length > MAX_PAGE_NAME_LENGTH) {
        throw new MoodboardValidationError(
            `Название листа не должно превышать ${MAX_PAGE_NAME_LENGTH} символов.`,
        );
    }
    return normalized;
}

function validateCanvas(canvas, path) {
    if (!isPlainObject(canvas)) {
        throw new MoodboardValidationError(`${path} должен быть объектом.`);
    }
    for (const dimension of ['width', 'height']) {
        const value = canvas[dimension];
        if (!Number.isFinite(value) || value <= 0) {
            throw new MoodboardValidationError(`${path}.${dimension} должен быть положительным числом.`);
        }
    }
    if (typeof canvas.background !== 'string' || canvas.background.trim() === '') {
        throw new MoodboardValidationError(`${path}.background должен быть непустой строкой.`);
    }
}

function validateElement(element, path, elementIds) {
    if (!isPlainObject(element)) {
        throw new MoodboardValidationError(`${path} должен быть объектом.`);
    }
    if (typeof element.id !== 'string' || element.id.trim() === '') {
        throw new MoodboardValidationError(`${path}.id должен быть непустой строкой.`);
    }
    if (elementIds.has(element.id)) {
        throw new MoodboardValidationError(`Идентификатор элемента ${element.id} используется повторно.`);
    }
    elementIds.add(element.id);

    if (!SUPPORTED_ELEMENT_TYPES.has(element.type)) {
        throw new MoodboardValidationError(`Неподдерживаемый тип элемента: ${String(element.type)}.`);
    }
    for (const property of ['x', 'y', 'width', 'height']) {
        if (
            element[property] !== undefined
            && (!Number.isFinite(element[property]) || (['width', 'height'].includes(property) && element[property] <= 0))
        ) {
            throw new MoodboardValidationError(`${path}.${property} содержит некорректное значение.`);
        }
    }
    if (element.rotation !== undefined && !Number.isFinite(element.rotation)) {
        throw new MoodboardValidationError(`${path}.rotation должен быть числом.`);
    }
    if (
        element.opacity !== undefined
        && (!Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1)
    ) {
        throw new MoodboardValidationError(`${path}.opacity должен быть числом от 0 до 1.`);
    }
    if (element.locked !== undefined && typeof element.locked !== 'boolean') {
        throw new MoodboardValidationError(`${path}.locked должен быть boolean.`);
    }
    if (
        element.groupId !== undefined
        && (typeof element.groupId !== 'string' || element.groupId.trim() === '')
    ) {
        throw new MoodboardValidationError(`${path}.groupId должен быть непустой строкой.`);
    }
    if (element.groupPath !== undefined) {
        if (
            !Array.isArray(element.groupPath)
            || element.groupPath.length === 0
            || element.groupPath.length > MAX_GROUP_DEPTH
            || element.groupPath.some((groupId) => typeof groupId !== 'string' || groupId.trim() === '')
            || new Set(element.groupPath).size !== element.groupPath.length
        ) {
            throw new MoodboardValidationError(
                `${path}.groupPath должен содержать от 1 до ${MAX_GROUP_DEPTH} уникальных непустых ID групп.`,
            );
        }
        if (element.groupId !== element.groupPath[0]) {
            throw new MoodboardValidationError(`${path}.groupId должен совпадать с первой группой в groupPath.`);
        }
    }
    if (element.groupNames !== undefined) {
        if (!isPlainObject(element.groupNames) || element.groupPath === undefined) {
            throw new MoodboardValidationError(`${path}.groupNames допустим только вместе с groupPath.`);
        }
        const allowedGroupIds = new Set(element.groupPath);
        for (const [groupId, groupName] of Object.entries(element.groupNames)) {
            if (
                !allowedGroupIds.has(groupId)
                || typeof groupName !== 'string'
                || groupName.trim() === ''
                || groupName.trim().length > MAX_PAGE_NAME_LENGTH
            ) {
                throw new MoodboardValidationError(
                    `${path}.groupNames содержит неизвестную группу или некорректное имя.`,
                );
            }
        }
    }
    for (const property of ['name', 'groupName']) {
        if (
            element[property] !== undefined
            && (
                typeof element[property] !== 'string'
                || element[property].trim() === ''
                || element[property].trim().length > MAX_PAGE_NAME_LENGTH
            )
        ) {
            throw new MoodboardValidationError(
                `${path}.${property} должен содержать от 1 до ${MAX_PAGE_NAME_LENGTH} символов.`,
            );
        }
    }
    if (element.groupName !== undefined && element.groupId === undefined) {
        throw new MoodboardValidationError(`${path}.groupName допустим только вместе с groupId.`);
    }
    if (['text', 'sticker'].includes(element.type) && typeof element.text !== 'string') {
        throw new MoodboardValidationError(`${path}.text должен быть строкой.`);
    }
    if (element.type === 'shape' && !SUPPORTED_SHAPE_TYPES.includes(element.shapeType || 'rectangle')) {
        throw new MoodboardValidationError(`${path}.shapeType содержит неизвестную фигуру.`);
    }
    if (['brush', 'highlighter'].includes(element.type)) {
        if (
            !Array.isArray(element.points)
            || element.points.length < 2
            || element.points.length % 2 !== 0
            || element.points.some((point) => !Number.isFinite(point) || point < 0 || point > 1)
        ) {
            throw new MoodboardValidationError(
                `${path}.points штриха должен быть массивом нормализованных координат от 0 до 1.`,
            );
        }
        if (typeof element.stroke !== 'string' || !/^#[0-9a-f]{6}$/i.test(element.stroke)) {
            throw new MoodboardValidationError(`${path}.stroke штриха должен быть цветом в формате HEX.`);
        }
        if (!Number.isFinite(element.strokeWidth) || element.strokeWidth <= 0) {
            throw new MoodboardValidationError(`${path}.strokeWidth штриха должен быть положительным числом.`);
        }
    }
    if (element.type === 'arrow') {
        if (
            !Array.isArray(element.points)
            || element.points.length !== 6
            || element.points.some((point) => !Number.isFinite(point) || point < 0 || point > 1)
        ) {
            throw new MoodboardValidationError(
                `${path}.points стрелки должен содержать три пары нормализованных координат от 0 до 1.`,
            );
        }
        if (typeof element.stroke !== 'string' || !/^#[0-9a-f]{6}$/i.test(element.stroke)) {
            throw new MoodboardValidationError(`${path}.stroke стрелки должен быть цветом в формате HEX.`);
        }
        if (!Number.isFinite(element.strokeWidth) || element.strokeWidth <= 0) {
            throw new MoodboardValidationError(`${path}.strokeWidth стрелки должен быть положительным числом.`);
        }
        for (const property of ['startCap', 'endCap']) {
            if (!['none', 'arrow1', 'arrow2'].includes(element[property])) {
                throw new MoodboardValidationError(
                    `${path}.${property} стрелки должен быть none, arrow1 или arrow2.`,
                );
            }
        }
    }
    if (element.type === 'sticker') {
        if (typeof element.fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(element.fill)) {
            throw new MoodboardValidationError(`${path}.fill стикера должен быть цветом в формате HEX.`);
        }
        if (typeof element.textColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(element.textColor)) {
            throw new MoodboardValidationError(`${path}.textColor стикера должен быть цветом в формате HEX.`);
        }
    }
    if (element.type === 'frame') {
        if (element.name === undefined) {
            throw new MoodboardValidationError(
                `${path}.name фрейма должен содержать от 1 до ${MAX_PAGE_NAME_LENGTH} символов.`,
            );
        }
        if (element.clipContent !== undefined && typeof element.clipContent !== 'boolean') {
            throw new MoodboardValidationError(`${path}.clipContent фрейма должен быть boolean.`);
        }
        if (
            element.backgroundColor !== undefined
            && (typeof element.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(element.backgroundColor))
        ) {
            throw new MoodboardValidationError(
                `${path}.backgroundColor фрейма должен быть цветом в формате HEX.`,
            );
        }
        if (
            element.backgroundOpacity !== undefined
            && (!Number.isFinite(element.backgroundOpacity)
                || element.backgroundOpacity < 0
                || element.backgroundOpacity > 1)
        ) {
            throw new MoodboardValidationError(
                `${path}.backgroundOpacity фрейма должен быть числом от 0 до 1.`,
            );
        }
        if (
            element.layoutGridColumns !== undefined
            && (!Number.isInteger(element.layoutGridColumns)
                || element.layoutGridColumns < 0
                || element.layoutGridColumns > 12)
        ) {
            throw new MoodboardValidationError(
                `${path}.layoutGridColumns фрейма должен быть целым числом от 0 до 12.`,
            );
        }
        for (const property of ['layoutGridGap', 'layoutGridPadding']) {
            if (
                element[property] !== undefined
                && (!Number.isFinite(element[property]) || element[property] < 0 || element[property] > 200)
            ) {
                throw new MoodboardValidationError(
                    `${path}.${property} фрейма должен быть числом от 0 до 200.`,
                );
            }
        }
    }
    if (
        element.type !== 'frame'
        && [
            'clipContent',
            'backgroundColor',
            'backgroundOpacity',
            'layoutGridColumns',
            'layoutGridGap',
            'layoutGridPadding',
        ]
            .some((property) => element[property] !== undefined)
    ) {
        throw new MoodboardValidationError(
            `${path} содержит настройки компоновки, допустимые только для фрейма.`,
        );
    }
    if (element.type === 'image' && (typeof element.assetId !== 'string' || element.assetId === '')) {
        throw new MoodboardValidationError(`${path}.assetId должен быть непустой строкой.`);
    }
    if (
        element.cornerRadius !== undefined
        && (!Number.isFinite(element.cornerRadius) || element.cornerRadius < 0 || element.cornerRadius > 1000)
    ) {
        throw new MoodboardValidationError(
            `${path}.cornerRadius должен быть числом от 0 до 1000.`,
        );
    }
    if (
        element.backgroundRemoved !== undefined
        && (element.type !== 'image' || typeof element.backgroundRemoved !== 'boolean')
    ) {
        throw new MoodboardValidationError(
            `${path}.backgroundRemoved допустим только для изображения и должен быть boolean.`,
        );
    }
    if (element.eraseMask !== undefined) {
        if (element.type !== 'image') {
            throw new MoodboardValidationError(`${path}.eraseMask допустим только для изображения.`);
        }
        try {
            validateImageEraseMask(element.eraseMask, `${path}.eraseMask`);
        } catch (error) {
            throw new MoodboardValidationError(error.message);
        }
    }
    for (const property of ['flipX', 'flipY']) {
        if (element[property] !== undefined && typeof element[property] !== 'boolean') {
            throw new MoodboardValidationError(`${path}.${property} должен быть boolean.`);
        }
    }
    if (
        element.strokeWidth !== undefined
        && (!Number.isFinite(element.strokeWidth) || element.strokeWidth < 0)
    ) {
        throw new MoodboardValidationError(`${path}.strokeWidth должен быть неотрицательным числом.`);
    }
    if (element.hyperlink !== undefined && element.hyperlink !== null) {
        if (typeof element.hyperlink !== 'string' || element.hyperlink.length > 2048) {
            throw new MoodboardValidationError(`${path}.hyperlink должен быть URL-строкой до 2048 символов.`);
        }
        try {
            const url = new URL(element.hyperlink);
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('unsupported protocol');
            }
        } catch (_) {
            throw new MoodboardValidationError(`${path}.hyperlink должен использовать http:// или https://.`);
        }
    }
    for (const property of FORBIDDEN_KONVA_PROPERTIES) {
        if (Object.prototype.hasOwnProperty.call(element, property)) {
            throw new MoodboardValidationError(
                `Техническое свойство Konva ${property} нельзя хранить в документе.`,
            );
        }
    }
}

function validatePage(page, index, pageIds, elementIds) {
    const path = `pages[${index}]`;
    if (!isPlainObject(page)) {
        throw new MoodboardValidationError(`${path} должен быть объектом.`);
    }
    if (typeof page.id !== 'string' || page.id.trim() === '') {
        throw new MoodboardValidationError(`${path}.id должен быть непустой строкой.`);
    }
    if (pageIds.has(page.id)) {
        throw new MoodboardValidationError(`Идентификатор листа ${page.id} используется повторно.`);
    }
    pageIds.add(page.id);
    normalizePageName(page.name);
    validateCanvas(page.canvas, `${path}.canvas`);
    if (!Array.isArray(page.elements)) {
        throw new MoodboardValidationError(`${path}.elements должен быть массивом.`);
    }
    page.elements.forEach((element, elementIndex) => {
        validateElement(element, `${path}.elements[${elementIndex}]`, elementIds);
    });
    const frameIds = new Set(
        page.elements.filter(({ type }) => type === 'frame').map(({ id }) => id),
    );
    page.elements.forEach((element, elementIndex) => {
        if (element.frameId === undefined) {
            return;
        }
        if (
            element.type === 'frame'
            || typeof element.frameId !== 'string'
            || !frameIds.has(element.frameId)
        ) {
            throw new MoodboardValidationError(
                `${path}.elements[${elementIndex}].frameId должен ссылаться на фрейм того же листа.`,
            );
        }
    });
    const elementsById = new Map(page.elements.map((element) => [element.id, element]));
    page.elements.forEach((element, elementIndex) => {
        if (element.type !== 'arrow' || element.bindings === undefined) {
            return;
        }
        const bindingPath = `${path}.elements[${elementIndex}].bindings`;
        if (!isPlainObject(element.bindings)) {
            throw new MoodboardValidationError(`${bindingPath} должен быть объектом.`);
        }
        for (const endpoint of ['start', 'end']) {
            const binding = element.bindings[endpoint];
            if (binding === undefined) {
                continue;
            }
            if (
                !isPlainObject(binding)
                || typeof binding.targetElementId !== 'string'
                || !isPlainObject(binding.anchor)
                || !Number.isFinite(binding.anchor.x)
                || !Number.isFinite(binding.anchor.y)
                || binding.anchor.x < 0
                || binding.anchor.x > 1
                || binding.anchor.y < 0
                || binding.anchor.y > 1
            ) {
                throw new MoodboardValidationError(
                    `${bindingPath}.${endpoint} содержит некорректную привязку.`,
                );
            }
            const target = elementsById.get(binding.targetElementId);
            if (
                !target
                || target.id === element.id
                || !ARROW_BINDING_TARGET_TYPES.has(target.type)
            ) {
                throw new MoodboardValidationError(
                    `${bindingPath}.${endpoint}.targetElementId должен ссылаться на поддерживаемый объект того же листа.`,
                );
            }
        }
    });
}

function validateLegacyDocument(document) {
    validateCanvas(document.canvas, 'canvas');
    if (!Array.isArray(document.elements)) {
        throw new MoodboardValidationError('Поле elements должно быть массивом.');
    }
    const elementIds = new Set();
    document.elements.forEach((element, index) => validateElement(element, `elements[${index}]`, elementIds));
}

export function cloneValue(value) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    if (value instanceof Blob) {
        return value.slice(0, value.size, value.type);
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item));
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
}

export function createMoodboardPage(overrides = {}) {
    if (!isPlainObject(overrides)) {
        throw new MoodboardValidationError('Параметры листа должны быть объектом.');
    }
    const canvasOverrides = isPlainObject(overrides.canvas) ? overrides.canvas : {};
    const page = {
        id: overrides.id ?? createId('page'),
        name: normalizePageName(overrides.name),
        canvas: {
            width: canvasOverrides.width ?? 1600,
            height: canvasOverrides.height ?? 1000,
            background: canvasOverrides.background ?? '#ffffff',
        },
        elements: overrides.elements ?? [],
    };
    validatePage(page, 0, new Set(), new Set());
    return cloneValue(page);
}

export function createMoodboardDocument(overrides = {}) {
    if (!isPlainObject(overrides)) {
        throw new MoodboardValidationError('Параметры документа должны быть объектом.');
    }
    const pages = Array.isArray(overrides.pages)
        ? overrides.pages
        : [createMoodboardPage({
            id: overrides.pageId,
            name: overrides.pageName,
            canvas: overrides.canvas,
            elements: overrides.elements,
        })];
    const document = {
        schemaVersion: overrides.schemaVersion ?? MOODBOARD_SCHEMA_VERSION,
        pages,
    };
    validateMoodboardDocument(document);
    return cloneValue(document);
}

export function validateMoodboardDocument(document) {
    if (!isPlainObject(document)) {
        throw new MoodboardValidationError('Документ MoodBoard должен быть объектом.');
    }
    if (document.schemaVersion === LEGACY_MOODBOARD_SCHEMA_VERSION) {
        validateLegacyDocument(document);
        return true;
    }
    if (document.schemaVersion !== MOODBOARD_SCHEMA_VERSION) {
        throw new MoodboardValidationError(
            `Неподдерживаемая версия схемы: ${String(document.schemaVersion)}.`,
            { expected: MOODBOARD_SCHEMA_VERSION, actual: document.schemaVersion },
        );
    }
    if (!Array.isArray(document.pages) || document.pages.length === 0) {
        throw new MoodboardValidationError('Документ должен содержать хотя бы один лист.');
    }
    const pageIds = new Set();
    const elementIds = new Set();
    document.pages.forEach((page, index) => validatePage(page, index, pageIds, elementIds));
    return true;
}

export function cloneMoodboardDocument(document) {
    validateMoodboardDocument(document);
    if (document.schemaVersion === LEGACY_MOODBOARD_SCHEMA_VERSION) {
        return createMoodboardDocument({ canvas: document.canvas, elements: document.elements });
    }
    return cloneValue(document);
}

export function cloneMoodboardPage(page) {
    validatePage(page, 0, new Set(), new Set());
    return cloneValue(page);
}

export function getMoodboardPage(document, pageId) {
    if (!document || !Array.isArray(document.pages)) {
        return null;
    }
    return document.pages.find(({ id }) => id === pageId) || null;
}
