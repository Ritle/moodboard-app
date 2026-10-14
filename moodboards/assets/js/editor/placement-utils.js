function finitePoint(point = {}) {
    return {
        x: Number.isFinite(Number(point.x)) ? Number(point.x) : 0,
        y: Number.isFinite(Number(point.y)) ? Number(point.y) : 0,
    };
}

export function normalizePlacementBounds(start, end, aspectRatio = null) {
    const from = finitePoint(start);
    const to = finitePoint(end);
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    let width = Math.abs(deltaX);
    let height = Math.abs(deltaY);
    const ratio = Number(aspectRatio);

    if (Number.isFinite(ratio) && ratio > 0 && width > 0 && height > 0) {
        if (width / height > ratio) {
            height = width / ratio;
        } else {
            width = height * ratio;
        }
    }

    return Object.freeze({
        x: deltaX < 0 ? from.x - width : from.x,
        y: deltaY < 0 ? from.y - height : from.y,
        width,
        height,
    });
}

export function resolvePlacementBounds(start, end, options = {}) {
    const from = finitePoint(start);
    const to = finitePoint(end);
    const ratio = Number(options.aspectRatio);
    const minWidth = Math.max(1, Number(options.minWidth) || 1);
    const minHeight = Math.max(1, Number(options.minHeight) || 1);
    const normalized = normalizePlacementBounds(from, to, ratio);
    let width = Math.max(normalized.width, minWidth);
    let height = Math.max(normalized.height, minHeight);

    if (Number.isFinite(ratio) && ratio > 0) {
        if (width / height > ratio) {
            height = width / ratio;
        } else {
            width = height * ratio;
        }
    }

    return Object.freeze({
        x: to.x < from.x ? from.x - width : from.x,
        y: to.y < from.y ? from.y - height : from.y,
        width,
        height,
    });
}
