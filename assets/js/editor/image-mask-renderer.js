import {
    getImageEraseMaskCacheKey,
    hasImageEraseMask,
    validateImageEraseMask,
} from '../models/image-erase-mask.js';

function resolveSourceSize(source) {
    return {
        width: Math.round(Number(source?.naturalWidth || source?.videoWidth || source?.width) || 0),
        height: Math.round(Number(source?.naturalHeight || source?.videoHeight || source?.height) || 0),
    };
}

function drawEraseStroke(context, stroke, width, height) {
    const points = stroke.points;
    const lineWidth = Math.max(1, stroke.size * width);
    const firstX = points[0] * width;
    const firstY = points[1] * height;

    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000000';
    context.strokeStyle = '#000000';
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.arc(firstX, firstY, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    if (points.length > 2) {
        context.beginPath();
        context.moveTo(firstX, firstY);
        for (let index = 2; index < points.length; index += 2) {
            context.lineTo(points[index] * width, points[index + 1] * height);
        }
        context.stroke();
    }
    context.restore();
}

export function applyImageEraseMask(context, mask, width, height) {
    if (!hasImageEraseMask(mask)) {
        return false;
    }
    validateImageEraseMask(mask);
    mask.strokes.forEach((stroke) => drawEraseStroke(context, stroke, width, height));
    return true;
}

export function createMaskedImageCanvas(source, mask, documentRef = globalThis.document) {
    const { width, height } = resolveSourceSize(source);
    if (width < 1 || height < 1) {
        throw new Error('Невозможно применить маску к изображению нулевого размера.');
    }
    if (!documentRef?.createElement) {
        throw new Error('Canvas API недоступен для применения маски изображения.');
    }

    const canvas = documentRef.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Не удалось создать рабочий холст маски изображения.');
    }
    context.drawImage(source, 0, 0, width, height);
    applyImageEraseMask(context, mask, width, height);
    return canvas;
}

export function createImageRenderCacheKey(element) {
    const assetId = String(element?.assetId || '');
    const maskKey = getImageEraseMaskCacheKey(element?.eraseMask);
    return maskKey ? `${assetId}|${maskKey}` : assetId;
}
