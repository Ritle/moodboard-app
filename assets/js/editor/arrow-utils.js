export const ARROW_CAP_TYPES = Object.freeze(['none', 'arrow1', 'arrow2']);
export const ARROW_STROKE_WIDTHS = Object.freeze([2, 5, 10, 18]);

function finitePoint(point) {
    return point
        && Number.isFinite(Number(point.x))
        && Number.isFinite(Number(point.y));
}

function roundCoordinate(value) {
    return Math.round(value * 100000) / 100000;
}

export function normalizeArrowPoints(points, minimumDimension = 1) {
    if (!Array.isArray(points) || points.length !== 3 || !points.every(finitePoint)) {
        return null;
    }
    const normalizedPoints = points.map(({ x, y }) => ({ x: Number(x), y: Number(y) }));
    const xValues = normalizedPoints.map(({ x }) => x);
    const yValues = normalizedPoints.map(({ y }) => y);
    const x = Math.min(...xValues);
    const y = Math.min(...yValues);
    const width = Math.max(Number(minimumDimension) || 1, Math.max(...xValues) - x);
    const height = Math.max(Number(minimumDimension) || 1, Math.max(...yValues) - y);
    return Object.freeze({
        x,
        y,
        width,
        height,
        points: Object.freeze(normalizedPoints.flatMap((point) => [
            roundCoordinate((point.x - x) / width),
            roundCoordinate((point.y - y) / height),
        ])),
    });
}

export function denormalizeArrowPoints(element) {
    if (!element || !Array.isArray(element.points) || element.points.length !== 6) {
        return [];
    }
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    const width = Math.max(1, Number(element.width) || 1);
    const height = Math.max(1, Number(element.height) || 1);
    return [0, 2, 4].map((index) => Object.freeze({
        x: x + Number(element.points[index]) * width,
        y: y + Number(element.points[index + 1]) * height,
    }));
}

export function snapArrowControlPoint(start, control, end, threshold = 8) {
    if (![start, control, end].every(finitePoint)) {
        return control;
    }
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const length = Math.hypot(dx, dy);
    if (length < 1) {
        return control;
    }
    const distance = Math.abs(
        dy * Number(control.x) - dx * Number(control.y)
        + Number(end.x) * Number(start.y) - Number(end.y) * Number(start.x)
    ) / length;
    if (distance > Math.max(0, Number(threshold) || 0)) {
        return control;
    }
    return Object.freeze({
        x: (Number(start.x) + Number(end.x)) / 2,
        y: (Number(start.y) + Number(end.y)) / 2,
    });
}
