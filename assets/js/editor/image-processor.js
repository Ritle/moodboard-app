export const SUPPORTED_IMAGE_TYPES = Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

export const DEFAULT_MAX_IMAGE_SIDE = 2800;
export const DEFAULT_MAX_FILE_SIZE = 30 * 1024 * 1024;

const SUPPORTED_TYPE_SET = new Set(SUPPORTED_IMAGE_TYPES);

export class ImageProcessingError extends Error {
    constructor(message, code = 'IMAGE_PROCESSING_FAILED') {
        super(message);
        this.name = 'ImageProcessingError';
        this.code = code;
    }
}

export function validateImageFile(file, maxFileSize = DEFAULT_MAX_FILE_SIZE) {
    if (!(file instanceof Blob)) {
        throw new ImageProcessingError('Выбранный файл недоступен.', 'INVALID_FILE');
    }
    if (!SUPPORTED_TYPE_SET.has(String(file.type).toLowerCase())) {
        throw new ImageProcessingError(
            'Поддерживаются только JPEG, PNG и WebP.',
            'UNSUPPORTED_IMAGE_TYPE',
        );
    }
    if (file.size <= 0) {
        throw new ImageProcessingError('Файл изображения пуст.', 'EMPTY_IMAGE');
    }
    if (file.size > maxFileSize) {
        throw new ImageProcessingError(
            `Размер файла не должен превышать ${Math.round(maxFileSize / 1024 / 1024)} МБ.`,
            'IMAGE_TOO_LARGE',
        );
    }
    return true;
}

export function calculateConstrainedSize(width, height, maxSide = DEFAULT_MAX_IMAGE_SIDE) {
    const sourceWidth = Number(width);
    const sourceHeight = Number(height);
    const limit = Number(maxSide);
    if (
        !Number.isFinite(sourceWidth)
        || !Number.isFinite(sourceHeight)
        || sourceWidth <= 0
        || sourceHeight <= 0
        || !Number.isFinite(limit)
        || limit <= 0
    ) {
        throw new ImageProcessingError('Не удалось определить размеры изображения.', 'INVALID_DIMENSIONS');
    }

    const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
        scale,
    };
}

function nextFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });
}

function loadHtmlImage(blob) {
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
        const image = new Image();
        const release = () => URL.revokeObjectURL(objectUrl);
        image.onload = () => {
            release();
            resolve({
                source: image,
                width: image.naturalWidth,
                height: image.naturalHeight,
                dispose: () => {},
            });
        };
        image.onerror = () => {
            release();
            reject(new ImageProcessingError('Файл не является корректным изображением.', 'INVALID_IMAGE'));
        };
        image.src = objectUrl;
    });
}

async function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob);
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                dispose: () => bitmap.close(),
            };
        } catch (_) {
            // HTMLImageElement даёт совместимый fallback для старых браузеров.
        }
    }
    return loadHtmlImage(blob);
}

function canvasToBlob(canvas, type, quality) {
    if (typeof canvas.convertToBlob === 'function') {
        return canvas.convertToBlob({ type, quality });
    }
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new ImageProcessingError('Не удалось оптимизировать изображение.'));
            }
        }, type, quality);
    });
}

function createResizeCanvas(width, height) {
    if (typeof OffscreenCanvas === 'function') {
        return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

export class ImageProcessor {
    constructor(options = {}) {
        this.maxSide = options.maxSide ?? DEFAULT_MAX_IMAGE_SIDE;
        this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
        this.lossyQuality = options.lossyQuality ?? 0.88;
    }

    async process(file) {
        validateImageFile(file, this.maxFileSize);
        await nextFrame();

        const decoded = await decodeImage(file);
        try {
            const constrained = calculateConstrainedSize(decoded.width, decoded.height, this.maxSide);
            if (constrained.scale === 1) {
                return {
                    blob: file.slice(0, file.size, file.type),
                    width: decoded.width,
                    height: decoded.height,
                    originalWidth: decoded.width,
                    originalHeight: decoded.height,
                    resized: false,
                };
            }

            await nextFrame();
            const canvas = createResizeCanvas(constrained.width, constrained.height);
            const context = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg' });
            if (!context) {
                throw new ImageProcessingError('Браузер не поддерживает обработку изображения.');
            }
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(decoded.source, 0, 0, constrained.width, constrained.height);

            const outputBlob = await canvasToBlob(canvas, file.type, this.lossyQuality);
            return {
                blob: outputBlob,
                width: constrained.width,
                height: constrained.height,
                originalWidth: decoded.width,
                originalHeight: decoded.height,
                resized: true,
            };
        } catch (error) {
            if (error instanceof ImageProcessingError) {
                throw error;
            }
            throw new ImageProcessingError(error?.message || 'Не удалось обработать изображение.');
        } finally {
            decoded.dispose();
        }
    }
}
