export const IMAGE_ERASE_MASK_VERSION = 1;
export const MAX_IMAGE_ERASE_STROKES = 500;
export const MAX_IMAGE_ERASE_POINTS = 50000;
export const MAX_IMAGE_ERASE_COORDINATES_PER_STROKE = 4000;
export const MIN_IMAGE_ERASER_SIZE = 0.0001;
export const MAX_IMAGE_ERASER_SIZE = 4;

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

export function validateImageEraseMask(mask, path = 'eraseMask') {
    if (!isPlainObject(mask)) {
        throw new TypeError(`${path} должен быть объектом.`);
    }
    if (mask.version !== IMAGE_ERASE_MASK_VERSION) {
        throw new TypeError(`${path}.version должен быть равен ${IMAGE_ERASE_MASK_VERSION}.`);
    }
    if (!Array.isArray(mask.strokes) || mask.strokes.length > MAX_IMAGE_ERASE_STROKES) {
        throw new TypeError(`${path}.strokes содержит слишком много штрихов.`);
    }

    let pointCount = 0;
    mask.strokes.forEach((stroke, strokeIndex) => {
        const strokePath = `${path}.strokes[${strokeIndex}]`;
        if (!isPlainObject(stroke)) {
            throw new TypeError(`${strokePath} должен быть объектом.`);
        }
        if (
            !Number.isFinite(stroke.size)
            || stroke.size < MIN_IMAGE_ERASER_SIZE
            || stroke.size > MAX_IMAGE_ERASER_SIZE
        ) {
            throw new TypeError(`${strokePath}.size содержит некорректный размер ластика.`);
        }
        if (
            !Array.isArray(stroke.points)
            || stroke.points.length < 2
            || stroke.points.length % 2 !== 0
            || stroke.points.length > MAX_IMAGE_ERASE_COORDINATES_PER_STROKE
            || stroke.points.some((coordinate) => (
                !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1
            ))
        ) {
            throw new TypeError(`${strokePath}.points содержит некорректные нормализованные координаты.`);
        }
        pointCount += stroke.points.length / 2;
    });

    if (pointCount > MAX_IMAGE_ERASE_POINTS) {
        throw new TypeError(`${path} содержит слишком много точек.`);
    }
    return true;
}

export function hasImageEraseMask(mask) {
    return Boolean(mask?.version === IMAGE_ERASE_MASK_VERSION && mask.strokes?.length > 0);
}

export function createImageEraseMask(strokes = []) {
    const mask = {
        version: IMAGE_ERASE_MASK_VERSION,
        strokes: structuredClone(strokes),
    };
    validateImageEraseMask(mask);
    return mask;
}

export function appendImageEraseStroke(mask, stroke) {
    const strokes = hasImageEraseMask(mask) ? mask.strokes : [];
    return createImageEraseMask([...strokes, stroke]);
}

export function getImageEraseMaskCacheKey(mask) {
    return hasImageEraseMask(mask) ? JSON.stringify(mask) : '';
}
