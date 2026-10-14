import {
    ARROW_CAP_TYPES,
    ARROW_STROKE_WIDTHS,
    normalizeArrowPoints,
    snapArrowControlPoint,
} from './arrow-utils.js';
import {
    ARROW_BINDING_ANCHORS,
    findNearestArrowBinding,
    normalizeArrowBindings,
    reconcileArrowBindings,
    resolveElementAnchor,
} from './arrow-binding-utils.js';
import {
    BINDING_GUIDE_TARGET_TYPES,
    calculatePerpendicularBindingGuides,
} from './binding-guide-utils.js';
import { normalizeSelectionRect, selectionRectIntersects } from './selection-utils.js';
import { normalizePlacementBounds, resolvePlacementBounds } from './placement-utils.js';
import { getFrameClipPolygon, isFrameClippingEnabled } from './frame-utils.js';
import { AsyncTaskQueue } from './async-task-queue.js';
import { planElementReconciliation } from './canvas-reconciliation-utils.js';
import {
    createImageRenderCacheKey,
    createMaskedImageCanvas,
} from './image-mask-renderer.js';
import {
    MAX_IMAGE_ERASE_COORDINATES_PER_STROKE,
    hasImageEraseMask,
} from '../models/image-erase-mask.js';

const MIN_ELEMENT_SIZE = 12;
const MIN_IMAGE_SIZE = 48;
const MIN_FRAME_SIZE = 24;
const SNAP_GRID_SIZE = 20;
const ROTATION_CONTROL_SIZE = 32;
const ROTATION_CONTROL_OFFSET = 18;
const ROTATION_SNAP_STEP = 15;
const ROTATION_KEY_ANGLE_STEP = 45;
const ROTATION_KEY_ANGLE_TOLERANCE = 4;
const ARROW_BINDING_SNAP_RADIUS = 14;
const ELEMENT_BINDING_GUIDE_RADIUS = 720;
const ELEMENT_BINDING_GUIDE_SNAP_TOLERANCE = 8;
const ELEMENT_BINDING_GUIDE_DISPLAY_TOLERANCE = 0.5;
const MIN_TEXT_FONT_SIZE = 8;
const MAX_TEXT_FONT_SIZE = 240;
const FREEHAND_CACHE_MIN_COORDINATES = 40;
const MAX_COMPLEX_NODE_CACHE_PIXEL_RATIO = 2;
const CORNER_RESIZE_ANCHORS = Object.freeze([
    'top-left',
    'top-right',
    'bottom-right',
    'bottom-left',
]);
const FULL_RESIZE_ANCHORS = Object.freeze([
    'top-left',
    'top-center',
    'top-right',
    'middle-right',
    'bottom-right',
    'bottom-center',
    'bottom-left',
    'middle-left',
]);
const CUSTOM_SHAPE_TYPES = new Set([
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
const PROPORTIONAL_SHAPE_TYPES = new Set([
    'circle',
    'diamond',
    'star',
    'hexagon',
    'checkbox-x',
    'checkbox-v',
]);

function tracePolygon(context, width, height, points) {
    context.beginPath();
    points.forEach(([x, y], index) => {
        const pointX = x * width;
        const pointY = y * height;
        if (index === 0) {
            context.moveTo(pointX, pointY);
        } else {
            context.lineTo(pointX, pointY);
        }
    });
    context.closePath();
}

function traceStar(context, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const outerX = width / 2;
    const outerY = height / 2;
    const innerRatio = 0.43;
    context.beginPath();
    for (let index = 0; index < 10; index += 1) {
        const angle = -Math.PI / 2 + index * Math.PI / 5;
        const radius = index % 2 === 0 ? 1 : innerRatio;
        const x = centerX + Math.cos(angle) * outerX * radius;
        const y = centerY + Math.sin(angle) * outerY * radius;
        if (index === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    }
    context.closePath();
}

function traceOval(context, width, height) {
    const kappa = 0.5522848;
    const radiusX = width / 2;
    const radiusY = height / 2;
    context.beginPath();
    context.moveTo(radiusX, 0);
    context.bezierCurveTo(radiusX + radiusX * kappa, 0, width, radiusY - radiusY * kappa, width, radiusY);
    context.bezierCurveTo(width, radiusY + radiusY * kappa, radiusX + radiusX * kappa, height, radiusX, height);
    context.bezierCurveTo(radiusX - radiusX * kappa, height, 0, radiusY + radiusY * kappa, 0, radiusY);
    context.bezierCurveTo(0, radiusY - radiusY * kappa, radiusX - radiusX * kappa, 0, radiusX, 0);
    context.closePath();
}

function traceCloud(context, width, height) {
    context.beginPath();
    context.moveTo(width * 0.23, height * 0.82);
    context.bezierCurveTo(width * 0.10, height * 0.82, width * 0.02, height * 0.72, width * 0.02, height * 0.58);
    context.bezierCurveTo(width * 0.02, height * 0.44, width * 0.12, height * 0.33, width * 0.25, height * 0.32);
    context.bezierCurveTo(width * 0.30, height * 0.13, width * 0.45, height * 0.04, width * 0.60, height * 0.13);
    context.bezierCurveTo(width * 0.70, height * 0.13, width * 0.79, height * 0.21, width * 0.82, height * 0.33);
    context.bezierCurveTo(width * 0.93, height * 0.35, width * 0.98, height * 0.45, width * 0.98, height * 0.58);
    context.bezierCurveTo(width * 0.98, height * 0.72, width * 0.89, height * 0.82, width * 0.75, height * 0.82);
    context.closePath();
}

function drawCheckboxMark(context, shape, width, height, shapeType) {
    const inset = Math.min(width, height) * 0.09;
    context.beginPath();
    context.rect(inset, inset, width - inset * 2, height - inset * 2);
    context.closePath();
    context.fillStrokeShape(shape);

    context.save();
    context.setAttr('strokeStyle', shape.stroke() || '#707070');
    context.setAttr('lineWidth', Math.max(2, shape.strokeWidth()));
    context.setAttr('lineCap', 'round');
    context.setAttr('lineJoin', 'round');
    context.beginPath();
    if (shapeType === 'checkbox-x') {
        context.moveTo(width * 0.30, height * 0.30);
        context.lineTo(width * 0.70, height * 0.70);
        context.moveTo(width * 0.70, height * 0.30);
        context.lineTo(width * 0.30, height * 0.70);
    } else {
        context.moveTo(width * 0.25, height * 0.52);
        context.lineTo(width * 0.43, height * 0.69);
        context.lineTo(width * 0.76, height * 0.32);
    }
    context.stroke();
    context.restore();
}

function drawCustomShape(context, shape, shapeType) {
    const width = shape.width();
    const height = shape.height();
    if (shapeType === 'checkbox-x' || shapeType === 'checkbox-v') {
        drawCheckboxMark(context, shape, width, height, shapeType);
        return;
    }
    if (shapeType === 'diamond') {
        tracePolygon(context, width, height, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    } else if (shapeType === 'triangle') {
        tracePolygon(context, width, height, [[0.5, 0], [1, 1], [0, 1]]);
    } else if (shapeType === 'star') {
        traceStar(context, width, height);
    } else if (shapeType === 'oval') {
        traceOval(context, width, height);
    } else if (shapeType === 'hexagon') {
        tracePolygon(context, width, height, [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    } else if (shapeType === 'cloud') {
        traceCloud(context, width, height);
    } else if (shapeType === 'arrow-left') {
        tracePolygon(context, width, height, [[0, 0.5], [0.42, 0.08], [0.42, 0.32], [1, 0.32], [1, 0.68], [0.42, 0.68], [0.42, 0.92]]);
    } else if (shapeType === 'arrow-up') {
        tracePolygon(context, width, height, [[0.5, 0], [0.92, 0.42], [0.68, 0.42], [0.68, 1], [0.32, 1], [0.32, 0.42], [0.08, 0.42]]);
    } else if (shapeType === 'arrow-down') {
        tracePolygon(context, width, height, [[0.32, 0], [0.68, 0], [0.68, 0.58], [0.92, 0.58], [0.5, 1], [0.08, 0.58], [0.32, 0.58]]);
    } else {
        tracePolygon(context, width, height, [[0, 0.32], [0.58, 0.32], [0.58, 0.08], [1, 0.5], [0.58, 0.92], [0.58, 0.68], [0, 0.68]]);
    }
    context.fillStrokeShape(shape);
}

function drawBrushStroke(context, shape) {
    const points = shape.getAttr('points');
    if (!Array.isArray(points) || points.length < 2) {
        return;
    }
    const width = shape.width();
    const height = shape.height();
    const pointCount = points.length / 2;
    context.beginPath();
    const firstX = points[0] * width;
    const firstY = points[1] * height;
    if (pointCount === 1) {
        const epsilon = Math.max(0.01, Math.min(width, height) * 0.001);
        context.moveTo(firstX - epsilon, firstY);
        context.lineTo(firstX + epsilon, firstY);
    } else {
        context.moveTo(firstX, firstY);
        if (pointCount === 2) {
            context.lineTo(points[2] * width, points[3] * height);
        } else {
            for (let index = 2; index < points.length - 2; index += 2) {
                const currentX = points[index] * width;
                const currentY = points[index + 1] * height;
                const nextX = points[index + 2] * width;
                const nextY = points[index + 3] * height;
                context.quadraticCurveTo(currentX, currentY, (currentX + nextX) / 2, (currentY + nextY) / 2);
            }
            context.lineTo(points[points.length - 2] * width, points[points.length - 1] * height);
        }
    }
    context.strokeShape(shape);
}

function getArrowPoint(shape, index) {
    const points = shape.getAttr('points');
    return {
        x: points[index] * shape.width(),
        y: points[index + 1] * shape.height(),
    };
}

function drawArrowCap(context, shape, tip, tangent, capType) {
    if (!ARROW_CAP_TYPES.includes(capType) || capType === 'none') {
        return;
    }
    const length = Math.hypot(tangent.x, tangent.y);
    if (length < 0.001) {
        return;
    }
    const directionX = tangent.x / length;
    const directionY = tangent.y / length;
    const size = Math.max(12, shape.strokeWidth() * 3.2);
    const halfWidth = size * 0.48;
    const baseX = tip.x - directionX * size;
    const baseY = tip.y - directionY * size;
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const first = {
        x: baseX + perpendicularX * halfWidth,
        y: baseY + perpendicularY * halfWidth,
    };
    const second = {
        x: baseX - perpendicularX * halfWidth,
        y: baseY - perpendicularY * halfWidth,
    };
    context.beginPath();
    if (capType === 'arrow1') {
        context.moveTo(tip.x, tip.y);
        context.lineTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.closePath();
        context.fillStrokeShape(shape);
        return;
    }
    context.moveTo(first.x, first.y);
    context.lineTo(tip.x, tip.y);
    context.lineTo(second.x, second.y);
    context.strokeShape(shape);
}

function drawArrowConnector(context, shape) {
    const points = shape.getAttr('points');
    if (!Array.isArray(points) || points.length !== 6) {
        return;
    }
    const start = getArrowPoint(shape, 0);
    const control = getArrowPoint(shape, 2);
    const end = getArrowPoint(shape, 4);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(control.x, control.y, end.x, end.y);
    context.strokeShape(shape);
    drawArrowCap(
        context,
        shape,
        start,
        { x: start.x - control.x, y: start.y - control.y },
        shape.getAttr('startCap'),
    );
    drawArrowCap(
        context,
        shape,
        end,
        { x: end.x - control.x, y: end.y - control.y },
        shape.getAttr('endCap'),
    );
}

function finiteNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positiveNumber(value, fallback) {
    const number = finiteNumber(value, fallback);
    return number > 0 ? number : fallback;
}

export function normalizeImageCornerRadius(value, width, height) {
    const radius = Math.max(0, finiteNumber(value, 0));
    return Math.min(radius, positiveNumber(width, 1) / 2, positiveNumber(height, 1) / 2);
}

export function drawRoundedImage(context, shape) {
    const image = shape.image?.();
    const width = positiveNumber(shape.width?.(), 0);
    const height = positiveNumber(shape.height?.(), 0);
    const sourceWidth = finiteNumber(image?.naturalWidth ?? image?.videoWidth ?? image?.width, 0);
    const sourceHeight = finiteNumber(image?.naturalHeight ?? image?.videoHeight ?? image?.height, 0);
    if (!image || width <= 0 || height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
        return;
    }

    const radius = normalizeImageCornerRadius(shape.getAttr?.('cornerRadius'), width, height);
    if (radius <= 0) {
        context.drawImage(image, 0, 0, width, height);
        return;
    }

    context.save();
    try {
        context.beginPath();
        context.moveTo(radius, 0);
        context.lineTo(width - radius, 0);
        context.quadraticCurveTo(width, 0, width, radius);
        context.lineTo(width, height - radius);
        context.quadraticCurveTo(width, height, width - radius, height);
        context.lineTo(radius, height);
        context.quadraticCurveTo(0, height, 0, height - radius);
        context.lineTo(0, radius);
        context.quadraticCurveTo(0, 0, radius, 0);
        context.closePath();
        context.clip();
        context.drawImage(image, 0, 0, width, height);
    } finally {
        context.restore();
    }
}

function roundCoordinate(value) {
    const rounded = Math.round(value * 10000) / 10000;
    return Object.is(rounded, -0) ? 0 : rounded;
}

export function calculateScaledTextFontSize(fontSize, initialHeight, finalHeight) {
    const currentFontSize = Math.min(
        MAX_TEXT_FONT_SIZE,
        Math.max(MIN_TEXT_FONT_SIZE, positiveNumber(fontSize, 48)),
    );
    const sourceHeight = positiveNumber(initialHeight, 1);
    const targetHeight = positiveNumber(finalHeight, sourceHeight);
    return Math.min(
        MAX_TEXT_FONT_SIZE,
        Math.max(MIN_TEXT_FONT_SIZE, Math.round(currentFontSize * targetHeight / sourceHeight)),
    );
}

export function createRotationPatch(element, deltaDegrees) {
    const x = finiteNumber(element?.x, 0);
    const y = finiteNumber(element?.y, 0);
    const width = positiveNumber(element?.width, 1);
    const height = positiveNumber(element?.height, 1);
    const rotation = finiteNumber(element?.rotation, 0);
    const radians = rotation * Math.PI / 180;
    const centerX = x
        + Math.cos(radians) * width / 2
        - Math.sin(radians) * height / 2;
    const centerY = y
        + Math.sin(radians) * width / 2
        + Math.cos(radians) * height / 2;
    const nextRotation = ((rotation + finiteNumber(deltaDegrees, 0)) % 360 + 360) % 360;
    const nextRadians = nextRotation * Math.PI / 180;
    return Object.freeze({
        x: roundCoordinate(
            centerX
            - Math.cos(nextRadians) * width / 2
            + Math.sin(nextRadians) * height / 2,
        ),
        y: roundCoordinate(
            centerY
            - Math.sin(nextRadians) * width / 2
            - Math.cos(nextRadians) * height / 2,
        ),
        rotation: roundCoordinate(nextRotation),
    });
}

export function createGroupRotationUpdates(elements, deltaDegrees, center) {
    const source = Array.isArray(elements) ? elements.filter(Boolean) : [];
    const pivot = {
        x: finiteNumber(center?.x, 0),
        y: finiteNumber(center?.y, 0),
    };
    const delta = finiteNumber(deltaDegrees, 0);
    const radians = delta * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return source.map((element) => {
        const originalCenter = getElementCenter(element);
        const relativeX = originalCenter.x - pivot.x;
        const relativeY = originalCenter.y - pivot.y;
        const nextCenter = {
            x: pivot.x + relativeX * cosine - relativeY * sine,
            y: pivot.y + relativeX * sine + relativeY * cosine,
        };
        const patch = createRotationPatch(element, delta);
        return Object.freeze({
            elementId: String(element.id),
            patch: Object.freeze({
                x: roundCoordinate(patch.x + nextCenter.x - originalCenter.x),
                y: roundCoordinate(patch.y + nextCenter.y - originalCenter.y),
                rotation: patch.rotation,
            }),
        });
    });
}

function getElementCenter(element) {
    const x = finiteNumber(element?.x, 0);
    const y = finiteNumber(element?.y, 0);
    const width = positiveNumber(element?.width, 1);
    const height = positiveNumber(element?.height, 1);
    const rotation = finiteNumber(element?.rotation, 0);
    const radians = rotation * Math.PI / 180;
    return Object.freeze({
        x: x + Math.cos(radians) * width / 2 - Math.sin(radians) * height / 2,
        y: y + Math.sin(radians) * width / 2 + Math.cos(radians) * height / 2,
    });
}

function normalizeAngleDelta(degrees) {
    return ((finiteNumber(degrees, 0) + 180) % 360 + 360) % 360 - 180;
}

export function accumulateRotationDelta(accumulatedDelta, previousAngle, currentAngle) {
    return finiteNumber(accumulatedDelta, 0)
        + normalizeAngleDelta(finiteNumber(currentAngle, 0) - finiteNumber(previousAngle, 0));
}

export function snapRotationToKeyAngle(
    rotation,
    step = ROTATION_KEY_ANGLE_STEP,
    tolerance = ROTATION_KEY_ANGLE_TOLERANCE,
) {
    const angle = finiteNumber(rotation, 0);
    const normalizedStep = Math.max(1, finiteNumber(step, ROTATION_KEY_ANGLE_STEP));
    const normalizedTolerance = Math.max(0, finiteNumber(tolerance, ROTATION_KEY_ANGLE_TOLERANCE));
    const keyAngle = Math.round(angle / normalizedStep) * normalizedStep;
    return Math.abs(angle - keyAngle) <= normalizedTolerance ? keyAngle : angle;
}

export function constrainPointToCircle(center, point, radius, fallbackPoint = null) {
    const centerX = finiteNumber(center?.x, 0);
    const centerY = finiteNumber(center?.y, 0);
    const pointX = finiteNumber(point?.x, centerX);
    const pointY = finiteNumber(point?.y, centerY);
    const normalizedRadius = Math.max(0, finiteNumber(radius, 0));
    const deltaX = pointX - centerX;
    const deltaY = pointY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 0.0001) {
        return Object.freeze({
            x: finiteNumber(fallbackPoint?.x, centerX),
            y: finiteNumber(fallbackPoint?.y, centerY + normalizedRadius),
        });
    }
    return Object.freeze({
        x: centerX + deltaX / distance * normalizedRadius,
        y: centerY + deltaY / distance * normalizedRadius,
    });
}

function angleFromPoint(center, point) {
    return Math.atan2(
        finiteNumber(point?.y, center.y) - center.y,
        finiteNumber(point?.x, center.x) - center.x,
    ) * 180 / Math.PI;
}

export function createRotationDragPatch(element, startPoint, currentPoint, snapStep = 0) {
    const center = getElementCenter(element);
    const startAngle = angleFromPoint(center, startPoint);
    const currentAngle = angleFromPoint(center, currentPoint);
    const rotation = finiteNumber(element?.rotation, 0);
    let nextRotation = rotation + normalizeAngleDelta(currentAngle - startAngle);
    const normalizedSnapStep = Math.max(0, finiteNumber(snapStep, 0));
    if (normalizedSnapStep > 0) {
        nextRotation = Math.round(nextRotation / normalizedSnapStep) * normalizedSnapStep;
    }
    return createRotationPatch(element, nextRotation - rotation);
}

export function createGroupDragUpdates(positions, sourceStart, sourcePosition) {
    if (!(positions instanceof Map)) {
        return [];
    }
    const startX = finiteNumber(sourceStart?.x, 0);
    const startY = finiteNumber(sourceStart?.y, 0);
    const deltaX = finiteNumber(sourcePosition?.x, startX) - startX;
    const deltaY = finiteNumber(sourcePosition?.y, startY) - startY;
    return [...positions.entries()].map(([elementId, position]) => {
        const patch = {
            x: finiteNumber(position?.x, 0) + deltaX,
            y: finiteNumber(position?.y, 0) + deltaY,
        };
        if (Number.isFinite(Number(position?.rotation))) {
            patch.rotation = finiteNumber(position.rotation, 0);
        }
        return { elementId, patch };
    });
}

const DEFAULT_CANVAS_EXPORT_PADDING = 16;

export function calculateCanvasExportBounds(canvas, elementRects = [], padding = DEFAULT_CANVAS_EXPORT_PADDING) {
    const canvasWidth = positiveNumber(canvas?.width, 1);
    const canvasHeight = positiveNumber(canvas?.height, 1);
    const safePadding = Math.max(0, finiteNumber(padding, DEFAULT_CANVAS_EXPORT_PADDING));
    const validRects = elementRects.filter((rect) => {
        const values = [rect?.x, rect?.y, rect?.width, rect?.height].map(Number);
        return values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
    });
    if (validRects.length === 0) {
        return Object.freeze({ x: 0, y: 0, width: canvasWidth, height: canvasHeight });
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const rect of validRects) {
        const x = Number(rect?.x);
        const y = Number(rect?.y);
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        minX = Math.min(minX, x - safePadding);
        minY = Math.min(minY, y - safePadding);
        maxX = Math.max(maxX, x + width + safePadding);
        maxY = Math.max(maxY, y + height + safePadding);
    }

    const x = Math.floor(minX);
    const y = Math.floor(minY);
    return Object.freeze({
        x,
        y,
        width: Math.max(1, Math.ceil(maxX) - x),
        height: Math.max(1, Math.ceil(maxY) - y),
    });
}

export function fitExportBoundsToAspectRatio(bounds, targetAspectRatio = null) {
    const x = finiteNumber(bounds?.x, 0);
    const y = finiteNumber(bounds?.y, 0);
    const width = positiveNumber(bounds?.width, 1);
    const height = positiveNumber(bounds?.height, 1);
    const aspectRatio = Number(targetAspectRatio);
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        return Object.freeze({ x, y, width, height });
    }

    const currentAspectRatio = width / height;
    if (Math.abs(currentAspectRatio - aspectRatio) < 0.0001) {
        return Object.freeze({ x, y, width, height });
    }
    if (currentAspectRatio > aspectRatio) {
        const fittedHeight = width / aspectRatio;
        return Object.freeze({
            x,
            y: y - (fittedHeight - height) / 2,
            width,
            height: fittedHeight,
        });
    }
    const fittedWidth = height * aspectRatio;
    return Object.freeze({
        x: x - (fittedWidth - width) / 2,
        y,
        width: fittedWidth,
        height,
    });
}

export function constrainExportPixelRatio(pixelRatio, bounds, maxWidth = null, maxHeight = null) {
    const ratio = positiveNumber(pixelRatio, 1);
    const width = positiveNumber(bounds?.width, 1);
    const height = positiveNumber(bounds?.height, 1);
    const limits = [ratio];
    if (Number.isFinite(Number(maxWidth)) && Number(maxWidth) > 0) {
        limits.push(Number(maxWidth) / width);
    }
    if (Number.isFinite(Number(maxHeight)) && Number(maxHeight) > 0) {
        limits.push(Number(maxHeight) / height);
    }
    return Math.max(Number.EPSILON, Math.min(...limits));
}

export function calculateBindingGuideTolerance(snapEnabled, viewportScale = 1) {
    const scale = Math.max(0.1, Math.abs(finiteNumber(viewportScale, 1)));
    const screenTolerance = snapEnabled
        ? ELEMENT_BINDING_GUIDE_SNAP_TOLERANCE
        : ELEMENT_BINDING_GUIDE_DISPLAY_TOLERANCE;
    return screenTolerance / scale;
}

export function calculateBindingGuideSearchRadius(viewportScale = 1) {
    const scale = Math.max(0.1, Math.abs(finiteNumber(viewportScale, 1)));
    return ELEMENT_BINDING_GUIDE_RADIUS / scale;
}

export function shouldRenderExportBackground(mimeType, includeBackground = null) {
    if (mimeType === 'image/jpeg') {
        return true;
    }
    return includeBackground === true;
}

export function normalizeObjectHyperlink(value) {
    try {
        const url = new URL(String(value || '').trim());
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch (_) {
        return null;
    }
}

export function openObjectHyperlink(
    value,
    openWindow = (...args) => globalThis.open?.(...args),
) {
    const hyperlink = normalizeObjectHyperlink(value);
    if (!hyperlink || typeof openWindow !== 'function') {
        return false;
    }
    const openedWindow = openWindow(hyperlink, '_blank', 'noopener,noreferrer');
    if (openedWindow && typeof openedWindow === 'object') {
        try {
            openedWindow.opener = null;
        } catch (_) {
            // Some browsers expose a read-only opener for isolated tabs.
        }
    }
    return true;
}

export function resolveResizeAnchors(elementType, editable = true) {
    if (!editable || elementType === 'arrow') {
        return [];
    }
    return elementType === 'image'
        ? [...CORNER_RESIZE_ANCHORS]
        : [...FULL_RESIZE_ANCHORS];
}

export function resolveInitialStageSize(container, minimumSize = 1) {
    const minimum = Math.max(1, Number(minimumSize) || 1);
    let width = 0;
    let height = 0;
    let current = container;
    while (current && (width <= 0 || height <= 0)) {
        const rect = current.getBoundingClientRect?.();
        if (width <= 0) {
            width = Number(current.clientWidth) || Number(rect?.width) || 0;
        }
        if (height <= 0) {
            height = Number(current.clientHeight) || Number(rect?.height) || 0;
        }
        current = current.parentElement;
    }
    return Object.freeze({
        width: Math.max(minimum, Math.round(width) || 0),
        height: Math.max(minimum, Math.round(height) || 0),
    });
}

export function resolveCanvasPixelRatio(value = globalThis.devicePixelRatio) {
    const pixelRatio = Number(value);
    return Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.max(1, pixelRatio) : 1;
}

export function resolveComplexNodeCachePixelRatio(
    renderPixelRatio,
    viewportScale,
    maximum = MAX_COMPLEX_NODE_CACHE_PIXEL_RATIO,
) {
    const effectivePixelRatio = resolveCanvasPixelRatio(renderPixelRatio)
        * positiveNumber(viewportScale, 1);
    const maximumPixelRatio = Math.max(1, positiveNumber(
        maximum,
        MAX_COMPLEX_NODE_CACHE_PIXEL_RATIO,
    ));
    if (effectivePixelRatio > maximumPixelRatio) {
        return null;
    }
    return Math.min(
        maximumPixelRatio,
        Math.ceil(Math.max(1, effectivePixelRatio) * 2) / 2,
    );
}

export class CanvasAdapter {
    constructor({
        Konva,
        container,
        onSelect,
        onSelectMany = () => {},
        onCommit,
        onCommitMany = () => {},
        onContextMenu = () => {},
        onSelectionBoundsChange = () => {},
        onRotationStateChange = () => {},
        onElementDragStateChange = () => {},
        onBrushComplete = () => {},
        onArrowComplete = () => {},
        onFrameCreate = () => {},
        onObjectPlace = () => {},
        onTextEdit = () => {},
        onFrameCommit = () => {},
        onImageEraseStroke = () => {},
        onHyperlinkOpen = (hyperlink) => openObjectHyperlink(hyperlink),
        assetLoader,
        onAssetError = () => {},
    }) {
        this.Konva = Konva;
        this.container = container;
        this.onSelect = onSelect;
        this.onSelectMany = onSelectMany;
        this.onCommit = onCommit;
        this.onCommitMany = onCommitMany;
        this.onContextMenu = onContextMenu;
        this.onSelectionBoundsChange = onSelectionBoundsChange;
        this.onRotationStateChange = onRotationStateChange;
        this.onElementDragStateChange = onElementDragStateChange;
        this.onBrushComplete = onBrushComplete;
        this.onArrowComplete = onArrowComplete;
        this.onFrameCreate = onFrameCreate;
        this.onObjectPlace = onObjectPlace;
        this.onTextEdit = onTextEdit;
        this.onFrameCommit = onFrameCommit;
        this.onImageEraseStroke = onImageEraseStroke;
        this.onHyperlinkOpen = onHyperlinkOpen;
        this.assetLoader = assetLoader;
        this.onAssetError = onAssetError;
        this.document = null;
        this.selectedElementId = null;
        this.selectedElementIds = [];
        this.selectionOutlines = new Map();
        this.selectionMarquee = null;
        this.selectionMarqueeState = null;
        this.hyperlinkIndicators = new Map();
        this.groupDragState = null;
        this.groupDragNodes = new WeakSet();
        this.groupDragSourceNode = null;
        this.groupDragInitiator = null;
        this.frameDragState = null;
        this.destroyed = false;
        this.interactionEnabled = true;
        this.snapEnabled = true;
        this.bindingGuidesEnabled = true;
        this.canvasSheetVisible = true;
        this.brushEnabled = false;
        this.brushSuspended = false;
        this.brushOptions = {
            type: 'brush',
            stroke: '#282828',
            strokeWidth: 5,
            opacity: 1,
        };
        this.activeBrushStroke = null;
        this.arrowToolEnabled = false;
        this.arrowOptions = {
            stroke: '#282828',
            strokeWidth: 5,
            startCap: 'none',
            endCap: 'arrow1',
        };
        this.activeArrowDraft = null;
        this.arrowControlHandles = [];
        this.activeArrowBindingEdit = null;
        this.arrowBindingAnchors = [];
        this.arrowSnapIndicator = null;
        this.arrowSnapGuide = null;
        this.elementBindingGuides = [];
        this.rotationQuickControls = null;
        this.rotationInteractionActive = false;
        this.resizeInteractionActive = false;
        this.selectionTransformState = null;
        this.frameToolEnabled = false;
        this.activeFrameDraft = null;
        this.placementTool = null;
        this.activePlacementDraft = null;
        this.activeTextEditor = null;
        this.imageEraser = null;
        this.activeImageEraseStroke = null;
        this.imageEraserCursor = null;
        this.pendingImageLoads = new Set();
        this.imageCache = new Map();
        this.imageLoadPromises = new Map();
        this.maskedImageCache = new Map();
        this.maskedImageLoadPromises = new Map();
        this.imageLoadQueue = new AsyncTaskQueue(4);
        this.activeAssetIds = new Set();
        this.activeImageRenderKeys = new Set();
        this.nodesById = new Map();
        this.frameClipWrappers = new Map();
        this.elementFingerprints = new Map();
        this.contentRectsCache = null;
        this.contentDrawFrame = null;
        this.exportChain = Promise.resolve();
        this.viewportScale = 1;
        this.renderPixelRatio = resolveCanvasPixelRatio();

        // Konva caches the browser DPR on first use. Browser zoom can change DPR later,
        // so keep the explicit value authoritative for canvases created afterwards.
        this.Konva.pixelRatio = this.renderPixelRatio;

        const initialStageSize = resolveInitialStageSize(container);
        this.stage = new Konva.Stage({
            container,
            width: initialStageSize.width,
            height: initialStageSize.height,
        });
        this.backgroundLayer = new Konva.Layer({ listening: false });
        this.contentLayer = new Konva.Layer();
        this.uiLayer = new Konva.Layer();
        this.backgroundRect = new Konva.Rect({ shadowColor: '#282828', shadowBlur: 32, shadowOpacity: 0.14 });
        this.transformer = new Konva.Transformer({
            rotateEnabled: false,
            keepRatio: false,
            flipEnabled: false,
            ignoreStroke: true,
            padding: 0,
            borderStroke: '#3183ff',
            borderStrokeWidth: 2,
            anchorFill: '#ffffff',
            anchorStroke: '#3183ff',
            anchorStrokeWidth: 2,
            anchorSize: 10,
            boundBoxFunc: (oldBox, newBox) => (
                Math.abs(newBox.width) < this._getMinimumSize()
                || Math.abs(newBox.height) < this._getMinimumSize()
                    ? oldBox
                    : newBox
            ),
        });

        this.backgroundLayer.add(this.backgroundRect);
        this.uiLayer.add(this.transformer);
        this.stage.add(this.backgroundLayer, this.contentLayer, this.uiLayer);
        this.handlePixelRatioChange = () => {
            const changed = this.syncRenderPixelRatio();
            if (changed || this.pixelRatioMediaQuery?.matches === false) {
                this._observePixelRatio();
            }
        };
        window.addEventListener('resize', this.handlePixelRatioChange);
        this._observePixelRatio();
        // There is no cross-browser DPR change event. A short fallback poll also covers
        // browser zoom/device emulation implementations that update DPR silently.
        this.pixelRatioPollTimer = window.setInterval(this.handlePixelRatioChange, 250);
        this._bindTransformerSelectionDrag();

        this.stage.on('mousedown.selectionMarquee touchstart.selectionMarquee', (event) => {
            this._startSelectionMarquee(event);
        });
        this.stage.on('mousemove.selectionMarquee touchmove.selectionMarquee', (event) => {
            this._extendSelectionMarquee(event);
        });
        this.stage.on('mouseup.selectionMarquee touchend.selectionMarquee', () => {
            this._finishSelectionMarquee();
        });
        this.stage.on('contextmenu.canvasAdapter', (event) => {
            event.evt.preventDefault();
            let target = event.target;
            while (target && target !== this.stage && !target.getAttr('elementId')) {
                target = target.getParent?.();
            }
            const elementId = target && target !== this.stage
                ? (target.getAttr('elementId') || null)
                : null;
            const preserveSelection = this.selectedElementIds.includes(elementId)
                || (!elementId && this._isPointerInsideSelection(event.evt));
            this.onContextMenu({
                elementId,
                preserveSelection,
                clientX: event.evt.clientX,
                clientY: event.evt.clientY,
            });
        });
        this.stage.on('mousedown.brush touchstart.brush', (event) => this._startBrushStroke(event));
        this.stage.on('mousemove.brush touchmove.brush', (event) => this._extendBrushStroke(event));
        this.stage.on('mouseup.brush touchend.brush', () => this._finishBrushStroke());
        this.stage.on('mousedown.imageEraser touchstart.imageEraser', (event) => {
            this._startImageEraseStroke(event);
        });
        this.stage.on('mousemove.imageEraser touchmove.imageEraser', (event) => {
            this._moveImageEraser(event);
        });
        this.stage.on('mouseup.imageEraser touchend.imageEraser', () => {
            this._finishImageEraseStroke();
        });
        this.stage.on('mousedown.arrowDraft touchstart.arrowDraft', (event) => this._startArrowDraft(event));
        this.stage.on('mousemove.arrowDraft touchmove.arrowDraft', (event) => this._extendArrowDraft(event));
        this.stage.on('mouseup.arrowDraft touchend.arrowDraft', () => this._finishArrowDraft());
        this.stage.on('mousedown.frameDraft touchstart.frameDraft', (event) => this._startFrameDraft(event));
        this.stage.on('mousemove.frameDraft touchmove.frameDraft', (event) => this._extendFrameDraft(event));
        this.stage.on('mouseup.frameDraft touchend.frameDraft', () => this._finishFrameDraft());
        this.stage.on('mousedown.objectPlacement touchstart.objectPlacement', (event) => this._startObjectPlacement(event));
        this.stage.on('mousemove.objectPlacement touchmove.objectPlacement', (event) => this._extendObjectPlacement(event));
        this.stage.on('mouseup.objectPlacement touchend.objectPlacement', () => this._finishObjectPlacement());
        this.handleWindowBrushEnd = () => {
            this._finishSelectionMarquee();
            this._finishBrushStroke();
            this._finishImageEraseStroke();
            this._finishArrowDraft();
            this._hideElementBindingGuides();
            this._finishFrameDraft();
            this._finishObjectPlacement();
        };
        this.handleWindowBrushCancel = () => {
            this._cancelSelectionMarquee();
            this._cancelBrushStroke();
            this._cancelImageEraseStroke();
            this._cancelArrowDraft();
            this._hideElementBindingGuides();
            this._cancelFrameDraft();
            this._cancelObjectPlacementDraft();
            this._finishActiveRotation();
        };
        this.handleWindowRotationEnd = (event) => this._finishActiveRotation(event);
        window.addEventListener('mouseup', this.handleWindowBrushEnd);
        window.addEventListener('touchend', this.handleWindowBrushEnd);
        window.addEventListener('mouseup', this.handleWindowRotationEnd);
        window.addEventListener('touchend', this.handleWindowRotationEnd);
        window.addEventListener('pointerup', this.handleWindowRotationEnd);
        window.addEventListener('blur', this.handleWindowBrushCancel);
    }

    renderDocument(document) {
        this._finishTextEditing({ commit: false });
        this.activeArrowBindingEdit = null;
        this._hideElementBindingGuides();
        this._hideArrowBindingSnap();
        this._cancelSelectionMarquee();
        this._cancelBrushStroke();
        this._cancelImageEraseStroke();
        this._cancelArrowDraft();
        this._hideElementBindingGuides();
        this._clearArrowControlHandles();
        this._cancelFrameDraft();
        this._cancelObjectPlacementDraft();
        this.document = document;
        this.contentRectsCache = null;
        this.groupDragState = null;
        this.frameDragState = null;
        this.selectionTransformState = null;
        const selectedElementIds = [...this.selectedElementIds];
        const reconciliation = planElementReconciliation(
            this.elementFingerprints,
            document.elements,
        );
        this.elementFingerprints = reconciliation.nextFingerprints;
        this.activeAssetIds = new Set(document.elements
            .filter(({ type, assetId }) => type === 'image' && assetId)
            .map(({ assetId }) => String(assetId)));
        this.activeImageRenderKeys = new Set(document.elements
            .filter((element) => element.type === 'image' && hasImageEraseMask(element.eraseMask))
            .map((element) => createImageRenderCacheKey(element)));

        this.backgroundRect.setAttrs({
            x: 0,
            y: 0,
            width: document.canvas.width,
            height: document.canvas.height,
            fill: document.canvas.background,
        });
        this.backgroundRect.visible(this.canvasSheetVisible);

        for (const elementId of reconciliation.removedIds) {
            this._destroyElementNode(elementId);
        }
        for (const entry of [...reconciliation.changed, ...reconciliation.added]) {
            this._replaceElementNode(entry.element, entry.index);
        }
        for (const entry of reconciliation.retained) {
            if (!this.nodesById.has(entry.id)) {
                this._replaceElementNode(entry.element, entry.index);
            }
        }
        this._syncFrameClipWrappers(document.elements);
        document.elements.forEach((element, index) => {
            const node = this.nodesById.get(String(element.id));
            this._getElementRenderRoot(node)?.zIndex(index);
        });
        this._pruneImageCache();

        this._renderHyperlinkIndicators(document.elements);

        this.backgroundLayer.batchDraw();
        this.contentLayer.batchDraw();
        this.setSelections(selectedElementIds);
    }

    _replaceElementNode(element, index) {
        const elementId = String(element.id);
        this._destroyElementNode(elementId);
        const node = this._createNode(element);
        this._disableSceneNodeBuffering(node);
        this._bindNode(node, elementId);
        this.contentLayer.add(node);
        this._cacheComplexNode(node, element);
        node.zIndex(index);
        this.nodesById.set(elementId, node);
        if (
            element.type === 'image'
            && element.assetId
            && node.getAttr('imageHydrated') !== true
        ) {
            const loadPromise = this._hydrateImageNode(node, element);
            this.pendingImageLoads.add(loadPromise);
            loadPromise.then(
                () => this.pendingImageLoads.delete(loadPromise),
                () => this.pendingImageLoads.delete(loadPromise),
            );
        }
        return node;
    }

    _destroyElementNode(elementId) {
        const normalizedId = String(elementId);
        const node = this.nodesById.get(normalizedId);
        const wrapper = this.frameClipWrappers.get(normalizedId);
        if (wrapper) {
            wrapper.destroy();
            this.frameClipWrappers.delete(normalizedId);
        } else {
            node?.destroy();
        }
        this.nodesById.delete(normalizedId);
    }

    _getElementRenderRoot(node) {
        if (!node) {
            return null;
        }
        const wrapper = this.frameClipWrappers?.get(String(node.getAttr('elementId')));
        return wrapper || node;
    }

    _syncFrameClipWrappers(elements) {
        const framesById = new Map(
            elements
                .filter(({ type, id }) => type === 'frame' && typeof id === 'string')
                .map((frame) => [frame.id, frame]),
        );
        for (const element of elements) {
            const elementId = String(element.id);
            const node = this.nodesById.get(elementId);
            if (!node || element.type === 'frame') {
                continue;
            }
            node.setAttr('frameId', typeof element.frameId === 'string' ? element.frameId : null);
            const frame = framesById.get(element.frameId);
            const shouldClip = Boolean(frame && isFrameClippingEnabled(frame));
            let wrapper = this.frameClipWrappers.get(elementId);
            if (!shouldClip) {
                if (wrapper) {
                    node.moveTo(this.contentLayer);
                    wrapper.destroy();
                    this.frameClipWrappers.delete(elementId);
                }
                continue;
            }
            if (!wrapper) {
                wrapper = new this.Konva.Group({
                    listening: true,
                    frameClipWrapper: true,
                    clippedElementId: elementId,
                });
                wrapper.clipFunc((context) => {
                    const polygon = wrapper.getAttr('frameClipPolygon');
                    if (!Array.isArray(polygon) || polygon.length !== 4) {
                        return;
                    }
                    context.beginPath();
                    context.moveTo(polygon[0].x, polygon[0].y);
                    polygon.slice(1).forEach((point) => context.lineTo(point.x, point.y));
                    context.closePath();
                });
                this.contentLayer.add(wrapper);
                node.moveTo(wrapper);
                this.frameClipWrappers.set(elementId, wrapper);
            }
            wrapper.setAttrs({
                frameId: frame.id,
                frameClipPolygon: getFrameClipPolygon(frame).map((point) => ({ ...point })),
                frameClipSuspended: false,
            });
        }
    }

    _setNodeFrameClipSuspended(node, suspended) {
        const wrapper = node
            ? this.frameClipWrappers?.get(String(node.getAttr('elementId')))
            : null;
        if (!wrapper) {
            return;
        }
        wrapper.setAttr('frameClipSuspended', Boolean(suspended));
        wrapper.clipFunc(suspended ? null : ((context) => {
            const polygon = wrapper.getAttr('frameClipPolygon');
            if (!Array.isArray(polygon) || polygon.length !== 4) {
                return;
            }
            context.beginPath();
            context.moveTo(polygon[0].x, polygon[0].y);
            polygon.slice(1).forEach((point) => context.lineTo(point.x, point.y));
            context.closePath();
        }));
    }

    _setNodesFrameClipSuspended(nodes, suspended) {
        nodes.forEach((node) => this._setNodeFrameClipSuspended(node, suspended));
    }

    _updateFrameClipGeometry(frameId, patch = {}) {
        const frame = this.document?.elements.find(({ id, type }) => id === frameId && type === 'frame');
        if (!frame) {
            return;
        }
        const polygon = getFrameClipPolygon({ ...frame, ...patch }).map((point) => ({ ...point }));
        for (const wrapper of this.frameClipWrappers?.values?.() || []) {
            if (wrapper.getAttr('frameId') === frameId && wrapper.getAttr('frameClipSuspended') !== true) {
                wrapper.setAttr('frameClipPolygon', polygon);
            }
        }
    }

    _getNodeContentRect(node) {
        const rect = node.getClientRect({ relativeTo: this.contentLayer });
        const wrapper = this.frameClipWrappers?.get(String(node.getAttr('elementId')));
        const polygon = wrapper?.getAttr('frameClipPolygon');
        if (!Array.isArray(polygon) || polygon.length !== 4) {
            return rect;
        }
        const clipMinX = Math.min(...polygon.map(({ x }) => x));
        const clipMinY = Math.min(...polygon.map(({ y }) => y));
        const clipMaxX = Math.max(...polygon.map(({ x }) => x));
        const clipMaxY = Math.max(...polygon.map(({ y }) => y));
        const x = Math.max(rect.x, clipMinX);
        const y = Math.max(rect.y, clipMinY);
        const maxX = Math.min(rect.x + rect.width, clipMaxX);
        const maxY = Math.min(rect.y + rect.height, clipMaxY);
        return {
            x,
            y,
            width: Math.max(0, maxX - x),
            height: Math.max(0, maxY - y),
        };
    }

    _hideFrameLayoutGridsForExport() {
        const states = [];
        for (const node of this.nodesById.values()) {
            if (node.getAttr('elementType') !== 'frame' || typeof node.find !== 'function') {
                continue;
            }
            node.find('.frame-layout-grid').forEach((grid) => {
                states.push({ grid, visible: grid.visible() });
                grid.visible(false);
            });
        }
        return states;
    }

    _restoreFrameLayoutGrids(states) {
        states.forEach(({ grid, visible }) => grid.visible(visible));
    }

    _disableSceneNodeBuffering(node) {
        if (!node) {
            return;
        }
        // Konva perfectDraw использует общий canvas Stage. Если редактор был
        // создан в скрытом контейнере, Chrome иногда оставляет этот canvas 0x0
        // и следующий drawImage аварийно прерывает открытие сцены. Для наших
        // узлов отдельный буфер не обязателен; opacity и shadow поддерживаются
        // обычным проходом отрисовки.
        node.perfectDrawEnabled?.(false);
        const children = node.getChildren?.();
        children?.forEach?.((child) => this._disableSceneNodeBuffering(child));
    }

    _cacheComplexNode(node, element) {
        if (
            !['brush', 'highlighter'].includes(element?.type)
            || !Array.isArray(element.points)
            || element.points.length < FREEHAND_CACHE_MIN_COORDINATES
            || typeof node?.cache !== 'function'
        ) {
            return;
        }
        const width = Number(node.width?.());
        const height = Number(node.height?.());
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            return;
        }
        const cachePixelRatio = resolveComplexNodeCachePixelRatio(
            this.renderPixelRatio,
            this.viewportScale,
        );
        const currentPixelRatio = Number(node.getAttr?.('performanceCachePixelRatio'));
        if (cachePixelRatio === null) {
            if (node.getAttr?.('performanceCached') === true) {
                node.clearCache?.();
            }
            node.setAttr('performanceCached', false);
            node.setAttr('performanceCachePixelRatio', null);
            return;
        }
        if (
            node.getAttr?.('performanceCached') === true
            && currentPixelRatio === cachePixelRatio
        ) {
            return;
        }
        const padding = Math.max(2, Number(node.strokeWidth?.()) || 0);
        try {
            node.clearCache?.();
            node.cache({
                x: -padding,
                y: -padding,
                width: Math.max(1, width + padding * 2),
                height: Math.max(1, height + padding * 2),
                pixelRatio: cachePixelRatio,
            });
            node.setAttr('performanceCached', true);
            node.setAttr('performanceCachePixelRatio', cachePixelRatio);
        } catch (_) {
            // Кэш — только оптимизация. Некорректный legacy-штрих или временный
            // canvas 0x0 не должен блокировать открытие всего редактора.
            node.clearCache?.();
            node.setAttr('performanceCached', false);
            node.setAttr('performanceCachePixelRatio', null);
        }
    }

    _syncComplexNodeCaches() {
        if (!Array.isArray(this.document?.elements)) {
            return;
        }
        for (const element of this.document.elements) {
            if (!['brush', 'highlighter'].includes(element?.type)) {
                continue;
            }
            this._cacheComplexNode(this.nodesById.get(String(element.id)), element);
        }
    }

    setSelection(elementId) {
        this.setSelections(elementId ? [elementId] : []);
    }

    beginTextEditing(elementId, { selectAll = false } = {}) {
        const element = this.document?.elements.find(({ id }) => id === elementId);
        const node = this.nodesById.get(String(elementId));
        if (
            !element
            || !['text', 'sticker'].includes(element.type)
            || element.locked === true
            || !node
            || !this.interactionEnabled
        ) {
            return false;
        }
        if (this.activeTextEditor?.elementId === elementId) {
            this.activeTextEditor.textarea.focus();
            return true;
        }
        this._finishTextEditing({ commit: true });
        this.onSelect(elementId);

        const textarea = globalThis.document.createElement('textarea');
        const initialText = typeof element.text === 'string' ? element.text : '';
        const absolutePosition = node.getAbsolutePosition();
        const absoluteScale = node.getAbsoluteScale();
        const scaleX = Math.max(0.01, Math.abs(absoluteScale.x));
        const scaleY = Math.max(0.01, Math.abs(absoluteScale.y));
        const fontStyle = String(element.fontStyle || 'normal');
        const editorFontSize = positiveNumber(element.fontSize, 48) * scaleY;
        const placeholderWidth = initialText === ''
            ? Math.ceil(editorFontSize * 7.2 + 16)
            : 0;
        textarea.className = 'canvas-text-editor';
        textarea.value = initialText;
        textarea.maxLength = 2000;
        textarea.placeholder = 'Введите текст';
        textarea.setAttribute('aria-label', 'Редактирование текста на холсте');
        Object.assign(textarea.style, {
            left: `${absolutePosition.x}px`,
            top: `${absolutePosition.y}px`,
            width: `${Math.max(48, node.width() * scaleX, placeholderWidth)}px`,
            height: `${Math.max(36, node.height() * scaleY)}px`,
            color: element.type === 'sticker'
                ? (element.textColor || '#282828')
                : (element.fill || '#282828'),
            fontFamily: element.fontFamily || 'Roboto',
            fontSize: `${editorFontSize}px`,
            fontStyle: fontStyle.includes('italic') ? 'italic' : 'normal',
            fontWeight: fontStyle.includes('bold') ? '700' : '400',
            lineHeight: String(positiveNumber(element.lineHeight, 1.2)),
            textAlign: ['left', 'center', 'right'].includes(element.align) ? element.align : 'left',
            transform: `rotate(${node.getAbsoluteRotation()}deg)`,
        });
        if (element.type === 'sticker') {
            textarea.style.padding = `${22 * scaleY}px`;
        }

        const finish = (commit) => this._finishTextEditing({ commit });
        const handleKeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                finish(true);
            }
        };
        const handleBlur = () => {
            if (finish(true)) {
                this.onSelect(null);
            }
        };
        const handleOutsidePointerDown = (event) => {
            if (
                event.target === textarea
                || textarea.contains(event.target)
                || !this.stage.container().contains(event.target)
            ) {
                return;
            }
            if (finish(true)) {
                this.onSelect(null);
            }
        };
        textarea.addEventListener('keydown', handleKeydown);
        textarea.addEventListener('blur', handleBlur);
        globalThis.document.addEventListener('pointerdown', handleOutsidePointerDown, true);
        this.stage.container().append(textarea);
        node.hide();
        this.transformer.hide();
        this._clearRotationQuickControls();
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
        this.activeTextEditor = {
            elementId,
            initialText,
            node,
            textarea,
            handleKeydown,
            handleBlur,
            handleOutsidePointerDown,
        };
        requestAnimationFrame(() => {
            if (this.activeTextEditor?.textarea !== textarea) {
                return;
            }
            textarea.focus();
            if (selectAll && textarea.value) {
                textarea.select();
            }
        });
        return true;
    }

    _finishTextEditing({ commit = true } = {}) {
        const editor = this.activeTextEditor;
        if (!editor) {
            return false;
        }
        this.activeTextEditor = null;
        const text = String(editor.textarea.value || '').slice(0, 2000);
        editor.textarea.removeEventListener('keydown', editor.handleKeydown);
        editor.textarea.removeEventListener('blur', editor.handleBlur);
        globalThis.document.removeEventListener('pointerdown', editor.handleOutsidePointerDown, true);
        editor.textarea.remove();
        if (editor.node.getLayer()) {
            editor.node.show();
        }
        this.transformer.show();
        this._renderRotationQuickControls(editor.node);
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
        if (editor.initialText.trim() === '' && (!commit || text.trim() === '')) {
            this.onTextEdit(editor.elementId, '', { discardEmpty: true });
        } else if (commit && text.trim() === '') {
            this.onTextEdit(editor.elementId, '', { removeEmpty: true });
        } else if (commit && text !== editor.initialText) {
            this.onTextEdit(editor.elementId, text, {
                mergeCreation: editor.initialText.trim() === '',
            });
        }
        return true;
    }

    setSelections(elementIds = []) {
        const requestedIds = [...new Set(elementIds.map(String))];
        const nodes = requestedIds.map((elementId) => this.nodesById.get(elementId)).filter(Boolean);
        this.selectedElementIds = nodes.map((node) => node.getAttr('elementId'));
        this.selectedElementId = this.selectedElementIds.length === 1
            ? this.selectedElementIds[0]
            : null;
        const singleNode = nodes.length === 1 ? nodes[0] : null;
        const singleEditableNode = singleNode && !singleNode.getAttr('locked') ? singleNode : null;
        const singleArrowNode = singleEditableNode?.getAttr('elementType') === 'arrow'
            ? singleEditableNode
            : null;
        const singleTextNode = ['text', 'sticker'].includes(singleNode?.getAttr('elementType'));
        const eraserEditing = Boolean(
            this.imageEraser
            && singleEditableNode?.getAttr('elementType') === 'image'
            && String(singleEditableNode.getAttr('elementId')) === this.imageEraser.elementId
        );
        const groupDraggable = this.interactionEnabled
            && nodes.length > 1
            && nodes.every((node) => !node.getAttr('locked'));
        const groupResizable = groupDraggable
            && nodes.every((node) => node.getAttr('elementType') !== 'frame');
        const resizeAnchors = groupResizable
            ? [...CORNER_RESIZE_ANCHORS]
            : resolveResizeAnchors(
                singleNode?.getAttr('elementType'),
                Boolean(singleEditableNode),
            );
        this.transformer.keepRatio(groupResizable
            || Boolean(singleNode?.getAttr('keepProportions'))
            || singleTextNode);
        this.transformer.shouldOverdrawWholeArea(groupDraggable);
        this.transformer.rotateEnabled(false);
        this.transformer.enabledAnchors(resizeAnchors);
        this.transformer.nodes(nodes);
        this.transformer.visible?.(!eraserEditing);
        this.transformer.listening(
            !eraserEditing && this.interactionEnabled && (Boolean(singleEditableNode) || groupDraggable),
        );
        this._syncNodeDraggability(nodes);
        this._renderSelectionOutlines(nodes);
        this._renderArrowControlHandles(singleArrowNode);
        this._syncArrowToolBindingAnchors();
        this._renderRotationQuickControls(
            eraserEditing ? null : (singleEditableNode || (groupResizable ? nodes[0] : null)),
        );
        this._syncHyperlinkIndicatorVisibility();
        this.uiLayer.batchDraw();
        this._notifySelectionBoundsChange();
    }

    setViewport(viewport) {
        this.viewportScale = positiveNumber(viewport?.scale, 1);
        this._syncComplexNodeCaches();
        for (const layer of [this.backgroundLayer, this.contentLayer, this.uiLayer]) {
            layer.position({ x: viewport.x, y: viewport.y });
            layer.scale({ x: viewport.scale, y: viewport.scale });
            layer.batchDraw();
        }
        if (this.arrowBindingAnchors.length > 0) {
            this._showArrowBindingAnchors();
        }
        this._syncRotationQuickControls();
        this._syncHyperlinkIndicators();
        this._notifySelectionBoundsChange();
    }

    resize(width, height) {
        this.syncRenderPixelRatio();
        this.stage.size({ width: Math.max(width, 1), height: Math.max(height, 1) });
        this.stage.batchDraw();
        this._syncHyperlinkIndicators();
        this._notifySelectionBoundsChange();
    }

    syncRenderPixelRatio(pixelRatio = globalThis.devicePixelRatio) {
        const nextPixelRatio = resolveCanvasPixelRatio(pixelRatio);
        if (nextPixelRatio === this.renderPixelRatio) {
            return false;
        }
        this.renderPixelRatio = nextPixelRatio;
        this.Konva.pixelRatio = nextPixelRatio;
        for (const layer of [this.backgroundLayer, this.contentLayer, this.uiLayer]) {
            const canvas = layer.getCanvas?.();
            if (
                typeof canvas?.setPixelRatio === 'function'
                && canvas.getPixelRatio?.() !== nextPixelRatio
            ) {
                canvas.setPixelRatio(nextPixelRatio);
            }
        }
        const stageBuffer = this.stage.bufferCanvas;
        if (
            typeof stageBuffer?.setPixelRatio === 'function'
            && stageBuffer.getPixelRatio?.() !== nextPixelRatio
        ) {
            stageBuffer.setPixelRatio(nextPixelRatio);
        }
        this._syncComplexNodeCaches();
        this.stage.batchDraw();
        return true;
    }

    _observePixelRatio() {
        if (this.pixelRatioMediaQuery) {
            this.pixelRatioMediaQuery.removeEventListener?.('change', this.handlePixelRatioChange);
            this.pixelRatioMediaQuery.removeListener?.(this.handlePixelRatioChange);
        }
        this.pixelRatioMediaQuery = typeof globalThis.matchMedia === 'function'
            ? globalThis.matchMedia(`(resolution: ${this.renderPixelRatio}dppx)`)
            : null;
        this.pixelRatioMediaQuery?.addEventListener?.('change', this.handlePixelRatioChange);
        if (
            this.pixelRatioMediaQuery
            && typeof this.pixelRatioMediaQuery.addEventListener !== 'function'
        ) {
            this.pixelRatioMediaQuery.addListener?.(this.handlePixelRatioChange);
        }
    }

    getSelectionClientRect() {
        const nodes = this._getSelectedNodes();
        if (nodes.length === 0) {
            return null;
        }
        const rects = nodes.map((node) => node.getClientRect());
        const minX = Math.min(...rects.map(({ x }) => x));
        const minY = Math.min(...rects.map(({ y }) => y));
        const maxX = Math.max(...rects.map(({ x, width }) => x + width));
        const maxY = Math.max(...rects.map(({ y, height }) => y + height));
        return Object.freeze({
            x: minX,
            y: minY,
            width: Math.max(0, maxX - minX),
            height: Math.max(0, maxY - minY),
        });
    }

    getSelectionBounds() {
        const nodes = this._getSelectedNodes();
        if (nodes.length === 0) {
            return null;
        }
        const rects = nodes.map((node) => node.getClientRect({ relativeTo: this.contentLayer }));
        const minX = Math.min(...rects.map(({ x }) => x));
        const minY = Math.min(...rects.map(({ y }) => y));
        const maxX = Math.max(...rects.map(({ x, width }) => x + width));
        const maxY = Math.max(...rects.map(({ y, height }) => y + height));
        return Object.freeze({
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
        });
    }

    getSelectionDimensions() {
        const nodes = this._getSelectedNodes();
        if (nodes.length === 0) {
            return null;
        }
        if (nodes.length > 1) {
            const bounds = this.getSelectionBounds();
            return bounds ? Object.freeze({
                count: nodes.length,
                width: bounds.width,
                height: bounds.height,
            }) : null;
        }

        const [node] = nodes;
        return Object.freeze({
            count: 1,
            width: Math.max(1, Math.abs(node.width() * node.scaleX())),
            height: Math.max(1, Math.abs(node.height() * node.scaleY())),
        });
    }

    setInteractionEnabled(enabled) {
        this.interactionEnabled = Boolean(enabled);
        if (!this.interactionEnabled) {
            this._cancelSelectionMarquee();
        }
        const selectedNodes = this._getSelectedNodes();
        this._syncNodeDraggability(selectedNodes);
        const selectedNode = this.selectedElementIds.length === 1
            ? this.nodesById.get(String(this.selectedElementIds[0]))
            : null;
        const groupDraggable = this.interactionEnabled
            && selectedNodes.length > 1
            && selectedNodes.every((node) => !node.getAttr('locked'));
        this.transformer.shouldOverdrawWholeArea(groupDraggable);
        this.transformer.listening(
            this.interactionEnabled && (
                (Boolean(selectedNode) && !selectedNode.getAttr('locked'))
                || groupDraggable
            ),
        );
        for (const handle of this.arrowControlHandles) {
            handle.draggable(this.interactionEnabled);
            handle.listening(this.interactionEnabled);
        }
        const groupRotatable = this.interactionEnabled
            && selectedNodes.length > 1
            && selectedNodes.every((node) => (
                !node.getAttr('locked') && node.getAttr('elementType') !== 'frame'
            ));
        this._renderRotationQuickControls(
            this.interactionEnabled && (selectedNodes.length === 1 || groupRotatable)
                ? selectedNodes[0]
                : null,
        );
        this.uiLayer.batchDraw();
    }

    setSnapEnabled(enabled) {
        this.snapEnabled = Boolean(enabled);
    }

    setBindingGuidesEnabled(enabled) {
        this.bindingGuidesEnabled = Boolean(enabled);
        if (!this.bindingGuidesEnabled) {
            this._hideElementBindingGuides();
        }
    }

    setCanvasSheetVisible(visible) {
        this.canvasSheetVisible = Boolean(visible);
        this.backgroundRect.visible(this.canvasSheetVisible);
        this.backgroundLayer.batchDraw();
    }

    setBrushEnabled(enabled) {
        this.brushEnabled = Boolean(enabled);
        if (!this.brushEnabled) {
            this._cancelBrushStroke();
        }
    }

    setImageEraser(options = null) {
        const elementId = String(options?.elementId || '');
        const size = Math.min(256, Math.max(8, Number(options?.size) || 64));
        const element = this.document?.elements?.find(({ id }) => String(id) === elementId);
        const enabled = Boolean(
            elementId
            && element?.type === 'image'
            && element.locked !== true
            && this.interactionEnabled
        );

        if (!enabled) {
            this.imageEraser = null;
            this._cancelImageEraseStroke();
            this._hideImageEraserCursor();
        } else {
            this.imageEraser = { elementId, size };
        }
        this.setSelections(this.selectedElementIds);
        this._syncNodeDraggability();
        return enabled;
    }

    setImageEraserSize(size) {
        if (!this.imageEraser) {
            return false;
        }
        this.imageEraser.size = Math.min(256, Math.max(8, Number(size) || 64));
        if (this.imageEraserCursor) {
            this.imageEraserCursor.radius(this.imageEraser.size / 2);
            this.uiLayer.batchDraw();
        }
        return true;
    }

    setArrowToolEnabled(enabled) {
        this.arrowToolEnabled = Boolean(enabled);
        if (!this.arrowToolEnabled) {
            this._cancelArrowDraft();
            return;
        }
        this._syncArrowToolBindingAnchors();
    }

    setArrowOptions({ stroke, strokeWidth, startCap, endCap } = {}) {
        if (typeof stroke === 'string' && /^#[0-9a-f]{6}$/i.test(stroke)) {
            this.arrowOptions.stroke = stroke.toLowerCase();
        }
        if (ARROW_STROKE_WIDTHS.includes(Number(strokeWidth))) {
            this.arrowOptions.strokeWidth = Number(strokeWidth);
        }
        if (ARROW_CAP_TYPES.includes(startCap)) {
            this.arrowOptions.startCap = startCap;
        }
        if (ARROW_CAP_TYPES.includes(endCap)) {
            this.arrowOptions.endCap = endCap;
        }
    }

    setFrameToolEnabled(enabled) {
        this.frameToolEnabled = Boolean(enabled);
        if (!this.frameToolEnabled) {
            this._cancelFrameDraft();
        }
    }

    setPlacementTool(options = null) {
        this._cancelObjectPlacementDraft();
        if (!options || !['shape', 'text', 'sticker'].includes(options.kind)) {
            this.placementTool = null;
            return;
        }
        this.placementTool = {
            ...options,
            minWidth: Math.max(24, Number(options.minWidth) || 24),
            minHeight: Math.max(24, Number(options.minHeight) || 24),
            aspectRatio: Number.isFinite(Number(options.aspectRatio)) && Number(options.aspectRatio) > 0
                ? Number(options.aspectRatio)
                : null,
        };
    }

    setBrushSuspended(suspended) {
        this.brushSuspended = Boolean(suspended);
        if (this.brushSuspended) {
            this._cancelBrushStroke();
            this._cancelImageEraseStroke();
            this._cancelArrowDraft();
            this._cancelFrameDraft();
            this._cancelObjectPlacementDraft();
            return;
        }
        this._syncArrowToolBindingAnchors();
    }

    setBrushOptions({ type, stroke, strokeWidth, opacity } = {}) {
        if (['brush', 'highlighter'].includes(type)) {
            this.brushOptions.type = type;
        }
        if (typeof stroke === 'string' && /^#[0-9a-f]{6}$/i.test(stroke)) {
            this.brushOptions.stroke = stroke.toLowerCase();
        }
        const normalizedWidth = Number(strokeWidth);
        const allowedWidths = this.brushOptions.type === 'highlighter'
            ? [16, 28, 40, 56]
            : [2, 5, 10, 18];
        if (allowedWidths.includes(normalizedWidth)) {
            this.brushOptions.strokeWidth = normalizedWidth;
        }
        const normalizedOpacity = Number(opacity);
        if (Number.isFinite(normalizedOpacity) && normalizedOpacity >= 0.1 && normalizedOpacity <= 1) {
            this.brushOptions.opacity = normalizedOpacity;
        }
    }

    getStage() {
        return this.stage;
    }

    getContentRects() {
        if (!this.contentLayer) {
            return [];
        }
        if (this.contentRectsCache) {
            return this.contentRectsCache;
        }
        this.contentRectsCache = Object.freeze([...this.nodesById.values()]
            .map((node) => {
                const rect = this._getNodeContentRect(node);
                return Object.freeze({
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                });
            }));
        return this.contentRectsCache;
    }

    getContentBounds() {
        const rects = this.getContentRects();
        if (rects.length === 0) {
            return null;
        }
        const minX = Math.min(...rects.map(({ x }) => x));
        const minY = Math.min(...rects.map(({ y }) => y));
        const maxX = Math.max(...rects.map(({ x, width }) => x + width));
        const maxY = Math.max(...rects.map(({ y, height }) => y + height));
        return Object.freeze({
            x: minX,
            y: minY,
            width: Math.max(0, maxX - minX),
            height: Math.max(0, maxY - minY),
        });
    }

    getSceneBounds() {
        const canvas = {
            x: 0,
            y: 0,
            width: positiveNumber(this.document?.canvas?.width, 1),
            height: positiveNumber(this.document?.canvas?.height, 1),
        };
        const content = this.getContentBounds();
        if (!content) {
            return Object.freeze(canvas);
        }
        const minX = Math.min(canvas.x, content.x);
        const minY = Math.min(canvas.y, content.y);
        const maxX = Math.max(canvas.x + canvas.width, content.x + content.width);
        const maxY = Math.max(canvas.y + canvas.height, content.y + content.height);
        return Object.freeze({
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
        });
    }

    exportAsBlob(options = {}) {
        const operation = this.exportChain.then(() => this._exportAsBlob(options));
        this.exportChain = operation.catch(() => {});
        return operation;
    }

    exportElementAsBlob(elementId, options = {}) {
        return this.exportElementsAsBlob([elementId], options);
    }

    exportElementsAsBlob(elementIds, options = {}) {
        const operation = this.exportChain.then(() => this._exportElementsAsBlob(elementIds, options));
        this.exportChain = operation.catch(() => {});
        return operation;
    }

    async _exportElementsAsBlob(elementIds, {
        pixelRatio = 2,
        mimeType = 'image/png',
        quality = 0.94,
    } = {}) {
        const normalizedPixelRatio = Number(pixelRatio);
        if (!Number.isFinite(normalizedPixelRatio) || normalizedPixelRatio <= 0 || normalizedPixelRatio > 4) {
            throw new Error('Некорректный масштаб экспорта объекта.');
        }
        if (!['image/png', 'image/jpeg'].includes(mimeType)) {
            throw new Error('Неподдерживаемый формат экспорта объекта.');
        }
        await this._waitForFonts();
        await Promise.allSettled([...this.pendingImageLoads]);
        const requestedIds = [...new Set(elementIds.map(String))];
        const nodes = requestedIds.map((elementId) => this.nodesById.get(elementId)).filter(Boolean);
        if (nodes.length === 0 || nodes.length !== requestedIds.length) {
            throw new Error('Часть выбранных объектов не найдена на холсте.');
        }

        const layerState = {
            x: this.contentLayer.x(),
            y: this.contentLayer.y(),
            scaleX: this.contentLayer.scaleX(),
            scaleY: this.contentLayer.scaleY(),
        };
        const visibility = this.document.elements.map(({ id }) => this.nodesById.get(String(id)))
            .filter(Boolean)
            .map((candidate) => this._getElementRenderRoot(candidate))
            .filter((candidate, index, roots) => roots.indexOf(candidate) === index)
            .map((candidate) => ({
                node: candidate,
                visible: candidate.visible(),
            }));
        const uiVisible = this.uiLayer.visible();
        const rects = nodes.map((node) => this._getNodeContentRect(node));
        const minX = Math.min(...rects.map(({ x }) => x));
        const minY = Math.min(...rects.map(({ y }) => y));
        const maxX = Math.max(...rects.map(({ x, width }) => x + width));
        const maxY = Math.max(...rects.map(({ y, height }) => y + height));
        const padding = 4;
        const exportRect = {
            x: minX - padding,
            y: minY - padding,
            width: Math.max(1, maxX - minX + padding * 2),
            height: Math.max(1, maxY - minY + padding * 2),
        };
        const selectedRoots = new Set(nodes.map((node) => this._getElementRenderRoot(node)));
        const frameLayoutGridStates = this._hideFrameLayoutGridsForExport();
        let canvas;
        try {
            this.contentLayer.position({ x: 0, y: 0 });
            this.contentLayer.scale({ x: 1, y: 1 });
            for (const state of visibility) {
                state.node.visible(selectedRoots.has(state.node));
            }
            this.uiLayer.visible(false);
            this.stage.draw();
            canvas = this.contentLayer.toCanvas({
                ...exportRect,
                pixelRatio: normalizedPixelRatio,
            });
        } finally {
            this.contentLayer.position({ x: layerState.x, y: layerState.y });
            this.contentLayer.scale({ x: layerState.scaleX, y: layerState.scaleY });
            for (const state of visibility) {
                state.node.visible(state.visible);
            }
            this._restoreFrameLayoutGrids(frameLayoutGridStates);
            this.uiLayer.visible(uiVisible);
            this.stage.draw();
        }

        if (mimeType === 'image/jpeg') {
            const flattened = document.createElement('canvas');
            flattened.width = canvas.width;
            flattened.height = canvas.height;
            const context = flattened.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, flattened.width, flattened.height);
            context.drawImage(canvas, 0, 0);
            canvas = flattened;
        }
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error('Браузер не смог подготовить объект для экспорта.'));
                }
            }, mimeType, quality);
        });
        return Object.freeze({ blob, width: canvas.width, height: canvas.height });
    }

    async _exportAsBlob({
        pixelRatio = 1,
        waitForFonts = true,
        mimeType = 'image/png',
        quality,
        includeMetadata = false,
        includeBackground = null,
        targetAspectRatio = null,
        maxWidth = null,
        maxHeight = null,
    } = {}) {
        if (!this.document) {
            throw new Error('Документ ещё не загружен.');
        }
        const normalizedPixelRatio = Number(pixelRatio);
        if (!Number.isFinite(normalizedPixelRatio) || normalizedPixelRatio <= 0 || normalizedPixelRatio > 4) {
            throw new Error('Некорректный масштаб экспорта. Допустимо значение от 0 до 4.');
        }
        if (!['image/png', 'image/jpeg'].includes(mimeType)) {
            throw new Error('Неподдерживаемый формат изображения для экспорта.');
        }
        if (waitForFonts) {
            await this._waitForFonts();
        }
        await Promise.allSettled([...this.pendingImageLoads]);

        const elementNodes = this.document.elements.map((element) => this.nodesById.get(String(element.id)));
        if (elementNodes.some((node) => !node)) {
            throw new Error('Не все элементы активного листа готовы к экспорту. Повторите попытку.');
        }
        const elementRects = elementNodes.map((node) => this._getNodeContentRect(node));
        const contentRect = calculateCanvasExportBounds(this.document.canvas, elementRects);
        const exportRect = fitExportBoundsToAspectRatio(contentRect, targetAspectRatio);
        const exportPixelRatio = constrainExportPixelRatio(
            normalizedPixelRatio,
            exportRect,
            maxWidth,
            maxHeight,
        );
        const renderBackground = shouldRenderExportBackground(mimeType, includeBackground);

        const stageSize = this.stage.size();
        const layerState = [this.backgroundLayer, this.contentLayer, this.uiLayer].map((layer) => ({
            layer,
            x: layer.x(),
            y: layer.y(),
            scaleX: layer.scaleX(),
            scaleY: layer.scaleY(),
            visible: layer.visible(),
        }));
        const backgroundRectVisible = this.backgroundRect.visible();
        const backgroundRectState = {
            x: this.backgroundRect.x(),
            y: this.backgroundRect.y(),
            width: this.backgroundRect.width(),
            height: this.backgroundRect.height(),
            shadowEnabled: this.backgroundRect.shadowEnabled(),
        };

        const frameLayoutGridStates = this._hideFrameLayoutGridsForExport();
        let canvas;
        try {
            this.stage.size({
                width: exportRect.width,
                height: exportRect.height,
            });
            for (const layer of [this.backgroundLayer, this.contentLayer]) {
                layer.position({ x: -exportRect.x, y: -exportRect.y });
                layer.scale({ x: 1, y: 1 });
            }
            this.backgroundLayer.visible(renderBackground);
            this.contentLayer.visible(true);
            this.backgroundRect.setAttrs({
                x: exportRect.x,
                y: exportRect.y,
                width: exportRect.width,
                height: exportRect.height,
                shadowEnabled: false,
            });
            this.backgroundRect.visible(renderBackground);
            this.uiLayer.visible(false);
            this.stage.draw();

            canvas = this.stage.toCanvas({
                x: 0,
                y: 0,
                width: exportRect.width,
                height: exportRect.height,
                pixelRatio: exportPixelRatio,
            });
        } finally {
            this.stage.size(stageSize);
            for (const state of layerState) {
                state.layer.position({ x: state.x, y: state.y });
                state.layer.scale({ x: state.scaleX, y: state.scaleY });
                state.layer.visible(state.visible);
            }
            this.backgroundRect.setAttrs(backgroundRectState);
            this.backgroundRect.visible(backgroundRectVisible);
            this._restoreFrameLayoutGrids(frameLayoutGridStates);
            this.stage.draw();
        }
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Браузер не смог подготовить изображение для экспорта.'));
                }
            }, mimeType, quality);
        });
        if (!includeMetadata) {
            return blob;
        }
        return Object.freeze({
            blob,
            width: canvas.width,
            height: canvas.height,
            bounds: exportRect,
        });
    }

    async _waitForFonts() {
        const fontSet = globalThis.document?.fonts;
        if (!fontSet?.ready) {
            return;
        }
        await fontSet.ready;
        const textElements = this.document?.elements?.filter(({ type }) => ['text', 'sticker'].includes(type)) || [];
        if (typeof fontSet.load !== 'function' || textElements.length === 0) {
            return;
        }
        await Promise.allSettled(textElements.map((element) => {
            const fontSize = positiveNumber(element.fontSize, 48);
            const fontFamily = String(element.fontFamily || 'Roboto').replace(/["\\]/g, '');
            const fontStyle = element.fontStyle === 'bold' ? 'bold' : 'normal';
            return fontSet.load(`${fontStyle} ${fontSize}px "${fontFamily}"`, String(element.text || ''));
        }));
    }

    _startBrushStroke(event) {
        if (!this.brushEnabled || this.brushSuspended || this.activeBrushStroke) {
            return;
        }
        const nativeEvent = event.evt;
        const isTouch = nativeEvent?.type?.startsWith('touch');
        if (!isTouch && nativeEvent?.button !== 0) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        nativeEvent?.preventDefault?.();
        event.cancelBubble = true;
        this.onSelect(null);
        const options = { ...this.brushOptions };
        const preview = new this.Konva.Line({
            points: [point.x, point.y, point.x, point.y],
            stroke: options.stroke,
            strokeWidth: options.strokeWidth,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.28,
            opacity: options.opacity,
            listening: false,
        });
        this.activeBrushStroke = {
            options,
            points: [point.x, point.y],
            preview,
        };
        this.contentLayer.add(preview);
        this.contentLayer.batchDraw();
    }

    _extendBrushStroke(event) {
        if (!this.activeBrushStroke || this.brushSuspended) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        event.evt?.preventDefault?.();
        event.cancelBubble = true;
        const points = this.activeBrushStroke.points;
        const lastX = points[points.length - 2];
        const lastY = points[points.length - 1];
        const scale = Math.max(Math.abs(this.contentLayer.scaleX()), 0.1);
        const minimumDistance = Math.max(0.75, 2 / scale);
        if (Math.hypot(point.x - lastX, point.y - lastY) < minimumDistance) {
            return;
        }
        points.push(point.x, point.y);
        this.activeBrushStroke.preview.points(points);
        this.contentLayer.batchDraw();
    }

    _finishBrushStroke() {
        if (!this.activeBrushStroke) {
            return;
        }
        const stroke = this.activeBrushStroke;
        this.activeBrushStroke = null;
        stroke.preview.destroy();
        this.contentLayer.batchDraw();

        const rawPoints = stroke.points;
        const xValues = rawPoints.filter((_, index) => index % 2 === 0);
        const yValues = rawPoints.filter((_, index) => index % 2 === 1);
        const padding = Math.max(1, stroke.options.strokeWidth / 2);
        const minX = Math.min(...xValues) - padding;
        const minY = Math.min(...yValues) - padding;
        const maxX = Math.max(...xValues) + padding;
        const maxY = Math.max(...yValues) + padding;
        const width = Math.max(stroke.options.strokeWidth, maxX - minX);
        const height = Math.max(stroke.options.strokeWidth, maxY - minY);
        const points = rawPoints.map((value, index) => {
            const normalized = index % 2 === 0
                ? (value - minX) / width
                : (value - minY) / height;
            return Math.round(Math.min(1, Math.max(0, normalized)) * 100000) / 100000;
        });
        this.onBrushComplete({
            type: stroke.options.type,
            x: minX,
            y: minY,
            width,
            height,
            rotation: 0,
            opacity: stroke.options.opacity,
            points,
            stroke: stroke.options.stroke,
            strokeWidth: stroke.options.strokeWidth,
        });
    }

    _cancelBrushStroke() {
        if (!this.activeBrushStroke) {
            return;
        }
        this.activeBrushStroke.preview.destroy();
        this.activeBrushStroke = null;
        this.contentLayer.batchDraw();
    }

    _startImageEraseStroke(event) {
        if (!this.imageEraser || this.activeImageEraseStroke || this.brushSuspended) {
            return;
        }
        const nativeEvent = event.evt || {};
        const isTouch = nativeEvent.type?.startsWith('touch');
        if (!isTouch && nativeEvent.button !== 0) {
            return;
        }
        const node = this.nodesById.get(this.imageEraser.elementId);
        if (
            !node
            || node.getAttr('elementType') !== 'image'
            || node.getAttr('locked') === true
            || !node.image?.()
        ) {
            return;
        }
        const localPoint = this._getImageEraserLocalPoint(node);
        if (!localPoint || !this._isPointInsideImageNode(localPoint, node)) {
            return;
        }

        try {
            const originalImage = node.image();
            const workingCanvas = createMaskedImageCanvas(originalImage, null);
            const context = workingCanvas.getContext('2d');
            if (!context) {
                return;
            }
            const normalizedPoint = this._normalizeImageEraserPoint(localPoint, node);
            const normalizedSize = Math.min(4, Math.max(
                0.0001,
                this.imageEraser.size / Math.max(1, node.width()),
            ));
            const stroke = {
                size: Math.round(normalizedSize * 100000) / 100000,
                points: [normalizedPoint.x, normalizedPoint.y],
            };
            this.activeImageEraseStroke = {
                elementId: this.imageEraser.elementId,
                node,
                originalImage,
                workingCanvas,
                context,
                stroke,
            };
            this._drawImageErasePreviewSegment(stroke.points, context, workingCanvas, stroke.size);
            node.image(workingCanvas);
            nativeEvent.preventDefault?.();
            event.cancelBubble = true;
            this.contentLayer.batchDraw();
        } catch (error) {
            this._cancelImageEraseStroke();
            this.onAssetError(error);
        }
    }

    _moveImageEraser(event) {
        if (!this.imageEraser) {
            return;
        }
        this._updateImageEraserCursor();
        const active = this.activeImageEraseStroke;
        if (!active || this.brushSuspended) {
            return;
        }
        const localPoint = this._getImageEraserLocalPoint(active.node);
        if (!localPoint) {
            return;
        }
        const normalizedPoint = this._normalizeImageEraserPoint(localPoint, active.node, { clamp: true });
        const points = active.stroke.points;
        const lastX = points[points.length - 2];
        const lastY = points[points.length - 1];
        const minimumDistance = Math.max(0.0005, active.stroke.size * 0.06);
        if (Math.hypot(normalizedPoint.x - lastX, normalizedPoint.y - lastY) < minimumDistance) {
            return;
        }
        if (points.length >= MAX_IMAGE_ERASE_COORDINATES_PER_STROKE) {
            return;
        }
        points.push(normalizedPoint.x, normalizedPoint.y);
        this._drawImageErasePreviewSegment(points, active.context, active.workingCanvas, active.stroke.size);
        event.evt?.preventDefault?.();
        event.cancelBubble = true;
        this.contentLayer.batchDraw();
    }

    _finishImageEraseStroke() {
        const active = this.activeImageEraseStroke;
        if (!active) {
            return false;
        }
        this.activeImageEraseStroke = null;
        const stroke = {
            size: active.stroke.size,
            points: active.stroke.points.map((coordinate) => (
                Math.round(Math.min(1, Math.max(0, coordinate)) * 100000) / 100000
            )),
        };
        try {
            const committed = this.onImageEraseStroke(active.elementId, stroke);
            if (committed === false) {
                throw new Error('Не удалось сохранить штрих ручного ластика.');
            }
            const currentElement = this.document?.elements?.find(
                ({ id }) => String(id) === active.elementId,
            );
            if (currentElement && hasImageEraseMask(currentElement.eraseMask)) {
                this.maskedImageCache.set(createImageRenderCacheKey(currentElement), Object.freeze({
                    image: active.workingCanvas,
                    width: active.workingCanvas.width,
                    height: active.workingCanvas.height,
                }));
            }
        } catch (error) {
            if (active.node?.getLayer()) {
                active.node.image(active.originalImage);
                this.contentLayer.batchDraw();
            }
            this.onAssetError(error);
            return false;
        }
        return true;
    }

    _cancelImageEraseStroke() {
        const active = this.activeImageEraseStroke;
        this.activeImageEraseStroke = null;
        if (active?.node?.getLayer()) {
            active.node.image(active.originalImage);
            this.contentLayer.batchDraw();
        }
    }

    _drawImageErasePreviewSegment(points, context, canvas, normalizedSize) {
        const pointCount = points.length / 2;
        const currentIndex = Math.max(0, pointCount - 1) * 2;
        const previousIndex = Math.max(0, pointCount - 2) * 2;
        const currentX = points[currentIndex] * canvas.width;
        const currentY = points[currentIndex + 1] * canvas.height;
        const previousX = points[previousIndex] * canvas.width;
        const previousY = points[previousIndex + 1] * canvas.height;
        const lineWidth = Math.max(1, normalizedSize * canvas.width);
        context.save();
        context.globalCompositeOperation = 'destination-out';
        context.fillStyle = '#000000';
        context.strokeStyle = '#000000';
        context.lineWidth = lineWidth;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        if (pointCount === 1) {
            context.beginPath();
            context.arc(currentX, currentY, lineWidth / 2, 0, Math.PI * 2);
            context.fill();
        } else {
            context.beginPath();
            context.moveTo(previousX, previousY);
            context.lineTo(currentX, currentY);
            context.stroke();
        }
        context.restore();
    }

    _getImageEraserLocalPoint(node) {
        const pointer = this.stage.getPointerPosition();
        if (!pointer || !node?.getAbsoluteTransform) {
            return null;
        }
        return node.getAbsoluteTransform().copy().invert().point(pointer);
    }

    _normalizeImageEraserPoint(point, node, { clamp = false } = {}) {
        let x = point.x / Math.max(1, node.width());
        let y = point.y / Math.max(1, node.height());
        if (clamp) {
            x = Math.min(1, Math.max(0, x));
            y = Math.min(1, Math.max(0, y));
        }
        return {
            x: Math.round(x * 100000) / 100000,
            y: Math.round(y * 100000) / 100000,
        };
    }

    _isPointInsideImageNode(point, node) {
        return point.x >= 0 && point.y >= 0 && point.x <= node.width() && point.y <= node.height();
    }

    _updateImageEraserCursor() {
        const eraser = this.imageEraser;
        const node = eraser ? this.nodesById.get(eraser.elementId) : null;
        const localPoint = node ? this._getImageEraserLocalPoint(node) : null;
        const scenePoint = this._getBrushPointerPosition();
        const visible = Boolean(
            node
            && localPoint
            && scenePoint
            && (this.activeImageEraseStroke || this._isPointInsideImageNode(localPoint, node))
        );
        if (!visible) {
            this._hideImageEraserCursor();
            return;
        }
        if (!this.imageEraserCursor) {
            this.imageEraserCursor = new this.Konva.Circle({
                listening: false,
                fill: 'rgba(255, 255, 255, 0.24)',
                stroke: '#282828',
                strokeWidth: 1.5,
                strokeScaleEnabled: false,
            });
            this.uiLayer.add(this.imageEraserCursor);
        }
        this.imageEraserCursor.setAttrs({
            x: scenePoint.x,
            y: scenePoint.y,
            radius: eraser.size / 2,
            visible: true,
        });
        this.imageEraserCursor.moveToTop();
        this.stage.container().style.cursor = 'none';
        this.uiLayer.batchDraw();
    }

    _hideImageEraserCursor() {
        if (this.imageEraserCursor) {
            this.imageEraserCursor.visible(false);
            this.uiLayer.batchDraw();
        }
        if (this.stage?.container()?.style.cursor === 'none') {
            this.stage.container().style.cursor = 'default';
        }
    }

    _startArrowDraft(event) {
        if (!this.arrowToolEnabled || this.brushSuspended || this.activeArrowDraft) {
            return;
        }
        const nativeEvent = event.evt;
        const isTouch = nativeEvent?.type?.startsWith('touch');
        if (!isTouch && nativeEvent?.button !== 0) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        const snap = this._findArrowBindingSnap(point);
        const startPoint = snap?.point || point;
        nativeEvent?.preventDefault?.();
        event.cancelBubble = true;
        this.onSelect(null);
        this._showArrowBindingAnchors();
        const options = { ...this.arrowOptions };
        const preview = new this.Konva.Shape({
            x: startPoint.x,
            y: startPoint.y,
            width: 1,
            height: 1,
            points: [0, 0, 0.5, 0, 1, 0],
            stroke: options.stroke,
            fill: options.stroke,
            strokeWidth: options.strokeWidth,
            lineCap: 'round',
            lineJoin: 'round',
            startCap: options.startCap,
            endCap: options.endCap,
            listening: false,
            sceneFunc: (context, shape) => drawArrowConnector(context, shape),
        });
        this.activeArrowDraft = {
            start: { x: startPoint.x, y: startPoint.y },
            current: { x: startPoint.x, y: startPoint.y },
            bindings: snap ? { start: snap.binding } : {},
            options,
            preview,
        };
        this._showArrowBindingSnap(snap, point);
        this.contentLayer.add(preview);
        this.contentLayer.batchDraw();
    }

    _extendArrowDraft(event) {
        if (!this.activeArrowDraft || this.brushSuspended) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        event.evt?.preventDefault?.();
        event.cancelBubble = true;
        const snap = this._findArrowBindingSnap(point);
        const currentPoint = snap?.point || point;
        this.activeArrowDraft.current = { x: currentPoint.x, y: currentPoint.y };
        if (snap) {
            this.activeArrowDraft.bindings.end = snap.binding;
        } else {
            delete this.activeArrowDraft.bindings.end;
        }
        this._showArrowBindingSnap(snap, point);
        const geometry = this._getArrowDraftGeometry();
        if (geometry) {
            this.activeArrowDraft.preview.setAttrs(geometry);
            this.contentLayer.batchDraw();
        }
    }

    _finishArrowDraft() {
        if (!this.activeArrowDraft) {
            return;
        }
        const draft = this.activeArrowDraft;
        this.activeArrowDraft = null;
        this._hideArrowBindingAnchors();
        this._hideArrowBindingSnap();
        draft.preview.destroy();
        this.contentLayer.batchDraw();
        if (Math.hypot(draft.current.x - draft.start.x, draft.current.y - draft.start.y) < 24) {
            return;
        }
        this.onArrowComplete({
            points: [
                draft.start,
                {
                    x: (draft.start.x + draft.current.x) / 2,
                    y: (draft.start.y + draft.current.y) / 2,
                },
                draft.current,
            ],
            ...(Object.keys(draft.bindings).length > 0
                ? { bindings: normalizeArrowBindings(draft.bindings) }
                : {}),
            ...draft.options,
        });
        this._syncArrowToolBindingAnchors();
        this._scheduleSelectedArrowControlRefresh();
    }

    _cancelArrowDraft() {
        if (this.activeArrowDraft) {
            this.activeArrowDraft.preview.destroy();
            this.activeArrowDraft = null;
            this.contentLayer.batchDraw();
        }
        this._hideArrowBindingAnchors();
        this._hideArrowBindingSnap();
        this._syncArrowToolBindingAnchors();
    }

    _getArrowDraftGeometry() {
        const draft = this.activeArrowDraft;
        if (!draft) {
            return null;
        }
        return normalizeArrowPoints([
            draft.start,
            {
                x: (draft.start.x + draft.current.x) / 2,
                y: (draft.start.y + draft.current.y) / 2,
            },
            draft.current,
        ]);
    }

    _findArrowBindingSnap(point, arrowId = null) {
        const scale = Math.max(0.1, Math.abs(this.contentLayer.scaleX()));
        return findNearestArrowBinding(
            this.document?.elements || [],
            point,
            ARROW_BINDING_SNAP_RADIUS / scale,
            arrowId,
        );
    }

    _showArrowBindingSnap(snap, sourcePoint = null) {
        if (!snap?.point) {
            this._hideArrowBindingSnap();
            return;
        }
        const scale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
        if (!this.arrowSnapIndicator) {
            this.arrowSnapIndicator = new this.Konva.Circle({
                listening: false,
                fill: '#ffffff',
                stroke: '#3183ff',
                strokeWidth: 3,
                strokeScaleEnabled: false,
                shadowColor: '#3183ff',
                shadowBlur: 10,
                shadowOpacity: 0.38,
            });
            this.uiLayer.add(this.arrowSnapIndicator);
        }
        this.arrowSnapIndicator.setAttrs({
            x: snap.point.x,
            y: snap.point.y,
            radius: 7 / scale,
            visible: true,
        });
        if (!this.arrowSnapGuide) {
            this.arrowSnapGuide = new this.Konva.Line({
                stroke: '#3183ff',
                strokeWidth: 1.5,
                strokeScaleEnabled: false,
                dash: [5, 4],
                listening: false,
            });
            this.uiLayer.add(this.arrowSnapGuide);
        }
        const source = sourcePoint && Number.isFinite(sourcePoint.x) && Number.isFinite(sourcePoint.y)
            ? sourcePoint
            : snap.point;
        const distance = Math.hypot(source.x - snap.point.x, source.y - snap.point.y);
        this.arrowSnapGuide.setAttrs({
            points: [source.x, source.y, snap.point.x, snap.point.y],
            visible: distance > 0.5,
        });
        this.arrowSnapGuide.moveToTop();
        this.arrowSnapIndicator.moveToTop();
        this.uiLayer.batchDraw();
    }

    _showArrowBindingAnchors(arrowId = null) {
        this._hideArrowBindingAnchors();
        const scale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
        const elements = (this.document?.elements || []).filter((element) => (
            element.id !== arrowId
            && ['image', 'text', 'shape', 'rectangle', 'sticker', 'frame'].includes(element.type)
        ));
        this.arrowBindingAnchors = elements.flatMap((element) => (
            ARROW_BINDING_ANCHORS.map((anchor) => {
                const point = resolveElementAnchor(element, anchor);
                const indicator = new this.Konva.Circle({
                    x: point.x,
                    y: point.y,
                    radius: 5 / scale,
                    fill: '#ffffff',
                    stroke: '#3183ff',
                    strokeWidth: 1.5,
                    strokeScaleEnabled: false,
                    listening: false,
                    name: 'arrow-binding-anchor',
                });
                this.uiLayer.add(indicator);
                return indicator;
            })
        ));
        this.arrowBindingAnchors.forEach((indicator) => indicator.moveToTop());
        this.arrowSnapIndicator?.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncArrowToolBindingAnchors() {
        if (this.arrowToolEnabled && !this.brushSuspended && !this.destroyed) {
            this._showArrowBindingAnchors();
            return;
        }
        this._hideArrowBindingAnchors();
    }

    _hideArrowBindingAnchors() {
        for (const indicator of this.arrowBindingAnchors || []) {
            indicator.destroy();
        }
        this.arrowBindingAnchors = [];
        this.uiLayer?.batchDraw();
    }

    _getMovingElementIds(sourceElementId) {
        const movingIds = new Set([String(sourceElementId)]);
        for (const state of [this.groupDragState, this.frameDragState]) {
            for (const elementId of state?.positions?.keys?.() || []) {
                movingIds.add(String(elementId));
            }
        }
        return movingIds;
    }

    _showElementBindingGuides(node, movingElementIds = new Set(), options = {}) {
        this._syncElementBindingGuides(node, movingElementIds, options);
    }

    _getBindingGuideNodeMap() {
        return this.nodesById;
    }

    _getBindingGuideNodeElement(node, fallback = {}) {
        const scaleX = Math.max(0.0001, Math.abs(finiteNumber(node?.scaleX?.(), 1)));
        const scaleY = Math.max(0.0001, Math.abs(finiteNumber(node?.scaleY?.(), 1)));
        return {
            ...fallback,
            id: String(node?.getAttr?.('elementId') || fallback.id || ''),
            type: node?.getAttr?.('elementType') || fallback.type || 'shape',
            x: finiteNumber(node?.x?.(), finiteNumber(fallback.x, 0)),
            y: finiteNumber(node?.y?.(), finiteNumber(fallback.y, 0)),
            width: positiveNumber(node?.width?.(), positiveNumber(fallback.width, 1)) * scaleX,
            height: positiveNumber(node?.height?.(), positiveNumber(fallback.height, 1)) * scaleY,
            rotation: finiteNumber(node?.rotation?.(), finiteNumber(fallback.rotation, 0)),
        };
    }

    _getBindingGuideSourceElement(node, movingIds, nodeMap) {
        const movingNodes = [...movingIds].map((elementId) => nodeMap.get(elementId)).filter(Boolean);
        if (movingNodes.length <= 1) {
            return this._getBindingGuideNodeElement(node);
        }
        const rects = movingNodes.map((movingNode) => (
            movingNode.getClientRect({ relativeTo: this.contentLayer })
        ));
        const minX = Math.min(...rects.map(({ x }) => x));
        const minY = Math.min(...rects.map(({ y }) => y));
        const maxX = Math.max(...rects.map(({ x, width }) => x + width));
        const maxY = Math.max(...rects.map(({ y, height }) => y + height));
        return {
            id: '__moving-selection__',
            type: 'shape',
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
            rotation: 0,
        };
    }

    _translateBindingGuideSource(node, movingIds, nodeMap, delta) {
        const deltaX = finiteNumber(delta?.x, 0);
        const deltaY = finiteNumber(delta?.y, 0);
        if (Math.hypot(deltaX, deltaY) < 0.0001) {
            return;
        }
        const sourceId = String(node.getAttr('elementId'));
        const ids = movingIds.size > 1 ? movingIds : new Set([sourceId]);
        for (const elementId of ids) {
            const movingNode = nodeMap.get(elementId);
            if (!movingNode) {
                continue;
            }
            movingNode.position({
                x: movingNode.x() + deltaX,
                y: movingNode.y() + deltaY,
            });
            this._syncHyperlinkIndicator(movingNode);
        }
        this.transformer.forceUpdate();
        this._renderSelectionOutlines(this._getSelectedNodes());
    }

    _renderElementBindingGuides(guides) {
        const visibleGuides = this.bindingGuidesEnabled ? guides : [];
        this.elementBindingGuides ||= [];
        while (this.elementBindingGuides.length < visibleGuides.length) {
            const guide = new this.Konva.Line({
                stroke: '#3183ff',
                strokeWidth: 1.5,
                strokeScaleEnabled: false,
                dash: [5, 4],
                listening: false,
                name: 'element-binding-guide',
            });
            this.elementBindingGuides.push(guide);
            this.uiLayer.add(guide);
        }
        this.elementBindingGuides.forEach((guide, index) => {
            const geometry = visibleGuides[index];
            if (!geometry) {
                guide.visible(false);
                return;
            }
            guide.setAttrs({
                points: [geometry.from.x, geometry.from.y, geometry.to.x, geometry.to.y],
                visible: true,
            });
            guide.moveToTop();
        });
        this.transformer.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncElementBindingGuides(
        node,
        movingElementIds = new Set(),
        { allowSnap = true } = {},
    ) {
        if (!node || !this.document?.elements || (!this.bindingGuidesEnabled && !this.snapEnabled)) {
            this._hideElementBindingGuides();
            return Object.freeze({ x: 0, y: 0 });
        }
        const scale = Math.max(0.1, Math.abs(this.contentLayer.scaleX()));
        const movingIds = new Set([...movingElementIds].map(String));
        movingIds.add(String(node.getAttr('elementId')));
        const nodeMap = this._getBindingGuideNodeMap();
        const sourceElement = this._getBindingGuideSourceElement(node, movingIds, nodeMap);
        const targetElements = this.document.elements
            .filter((element) => !movingIds.has(String(element.id)))
            .filter((element) => BINDING_GUIDE_TARGET_TYPES.includes(element.type))
            .map((element) => {
                const targetNode = nodeMap.get(String(element.id));
                return targetNode ? this._getBindingGuideNodeElement(targetNode, element) : element;
            });
        const shouldSnap = allowSnap && this.snapEnabled;
        const result = calculatePerpendicularBindingGuides(sourceElement, targetElements, {
            maxDistance: calculateBindingGuideSearchRadius(scale),
            snapTolerance: calculateBindingGuideTolerance(shouldSnap, scale),
        });
        if (shouldSnap) {
            this._translateBindingGuideSource(node, movingIds, nodeMap, result.delta);
        }
        this._renderElementBindingGuides(result.guides);
        return result.delta;
    }

    _hideElementBindingGuides() {
        let changed = false;
        for (const guide of this.elementBindingGuides || []) {
            if (guide.visible()) {
                guide.visible(false);
                changed = true;
            }
        }
        if (changed) {
            this.uiLayer?.batchDraw();
        }
    }

    _hideArrowBindingSnap() {
        const indicatorVisible = this.arrowSnapIndicator?.visible() === true;
        const guideVisible = this.arrowSnapGuide?.visible() === true;
        if (indicatorVisible) {
            this.arrowSnapIndicator.visible(false);
        }
        if (guideVisible) {
            this.arrowSnapGuide.visible(false);
        }
        if (indicatorVisible || guideVisible) {
            this.uiLayer.batchDraw();
        }
    }

    _clearArrowControlHandles() {
        this.activeArrowBindingEdit = null;
        this._hideArrowBindingAnchors();
        this._hideArrowBindingSnap();
        for (const handle of this.arrowControlHandles) {
            handle.destroy();
        }
        this.arrowControlHandles = [];
    }

    _refreshSelectedArrowControls() {
        if (this.destroyed || this.selectedElementIds.length !== 1) {
            return false;
        }
        const elementId = String(this.selectedElementIds[0]);
        const node = this.nodesById.get(elementId);
        if (node?.getAttr('elementType') !== 'arrow') {
            return false;
        }
        this.setSelections([elementId]);
        return this.arrowControlHandles.length === 3;
    }

    _scheduleSelectedArrowControlRefresh() {
        const refresh = () => this._refreshSelectedArrowControls();
        if (typeof globalThis.requestAnimationFrame === 'function') {
            globalThis.requestAnimationFrame(refresh);
        } else {
            refresh();
        }
    }

    _renderArrowControlHandles(node) {
        this._clearArrowControlHandles();
        if (!node || !this.interactionEnabled || node.getAttr('locked')) {
            return;
        }
        const labels = ['Начальная точка', 'Точка изгиба', 'Конечная точка'];
        const points = this._getArrowLayerPoints(node);
        if (points.length !== 3) {
            return;
        }
        const arrow = this.document?.elements.find(
            ({ id }) => id === node.getAttr('elementId'),
        );
        const bindings = normalizeArrowBindings(arrow?.bindings);
        this.arrowControlHandles = points.map((point, index) => {
            const isControl = index === 1;
            const endpoint = index === 0 ? 'start' : (index === 2 ? 'end' : null);
            const bound = Boolean(endpoint && bindings[endpoint]);
            const handle = new this.Konva.Circle({
                x: point.x,
                y: point.y,
                radius: isControl ? 7 : 6,
                fill: isControl ? '#3183ff' : (bound ? '#c5fcd5' : '#ffffff'),
                stroke: '#3183ff',
                strokeWidth: 2,
                strokeScaleEnabled: false,
                draggable: true,
                elementId: node.getAttr('elementId'),
                arrowPointIndex: index,
                arrowControlHandle: true,
                name: `${labels[index]}${bound ? ', привязана к объекту' : ''}`,
            });
            handle.on('mouseenter.arrowHandle', () => {
                this.stage.container().style.cursor = 'move';
            });
            handle.on('mouseleave.arrowHandle', () => {
                if (this.stage.container().style.cursor === 'move') {
                    this.stage.container().style.cursor = 'default';
                }
            });
            handle.on('dragstart.arrowHandle', (event) => {
                event.cancelBubble = true;
                const arrow = this.document?.elements.find(
                    ({ id }) => id === node.getAttr('elementId'),
                );
                this.activeArrowBindingEdit = normalizeArrowBindings(arrow?.bindings);
                this._showArrowBindingAnchors(node.getAttr('elementId'));
                this.stage.container().style.cursor = 'grabbing';
            });
            handle.on('dragmove.arrowHandle', (event) => {
                event.cancelBubble = true;
                this._updateArrowFromControlHandles(node, index, false);
            });
            handle.on('dragend.arrowHandle', (event) => {
                event.cancelBubble = true;
                this.stage.container().style.cursor = 'move';
                const patch = this._updateArrowFromControlHandles(node, index, true);
                this.activeArrowBindingEdit = null;
                this._hideArrowBindingAnchors();
                this._hideArrowBindingSnap();
                if (patch) {
                    this.onCommit(
                        node.getAttr('elementId'),
                        patch,
                        index === 1 ? 'Изменение изгиба линии' : 'Изменение точки линии',
                    );
                }
            });
            this.uiLayer.add(handle);
            handle.moveToTop();
            return handle;
        });
        this.uiLayer.batchDraw();
    }

    _getArrowLayerPoints(node) {
        const points = node?.getAttr('points');
        if (!Array.isArray(points) || points.length !== 6) {
            return [];
        }
        const transform = node.getTransform();
        return [0, 2, 4].map((index) => transform.point({
            x: points[index] * node.width(),
            y: points[index + 1] * node.height(),
        }));
    }

    _syncArrowControlHandles(node) {
        if (
            this.arrowControlHandles.length !== 3
            || node?.getAttr('elementType') !== 'arrow'
            || node.getAttr('elementId') !== this.selectedElementId
        ) {
            return;
        }
        const points = this._getArrowLayerPoints(node);
        points.forEach((point, index) => this.arrowControlHandles[index]?.position(point));
        this.uiLayer.batchDraw();
    }

    _updateArrowFromControlHandles(node, changedIndex, final) {
        if (this.arrowControlHandles.length !== 3) {
            return null;
        }
        const points = this.arrowControlHandles.map((handle) => ({ x: handle.x(), y: handle.y() }));
        if (changedIndex === 0 || changedIndex === 2) {
            const endpoint = changedIndex === 0 ? 'start' : 'end';
            const sourcePoint = points[changedIndex];
            const snap = this._findArrowBindingSnap(
                sourcePoint,
                node.getAttr('elementId'),
            );
            if (snap) {
                points[changedIndex] = { ...snap.point };
                this.arrowControlHandles[changedIndex].position(points[changedIndex]);
                if (this.activeArrowBindingEdit) {
                    this.activeArrowBindingEdit[endpoint] = snap.binding;
                }
            } else if (this.activeArrowBindingEdit) {
                delete this.activeArrowBindingEdit[endpoint];
            }
            this._showArrowBindingSnap(snap, sourcePoint);
        }
        if (changedIndex === 1) {
            const scale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
            const snapped = snapArrowControlPoint(points[0], points[1], points[2], 10 / scale);
            points[1] = { x: snapped.x, y: snapped.y };
            this.arrowControlHandles[1].position(points[1]);
        }
        const geometry = normalizeArrowPoints(points);
        if (!geometry) {
            return null;
        }
        const patch = {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
            rotation: 0,
            points: [...geometry.points],
        };
        if (final && (changedIndex === 0 || changedIndex === 2)) {
            patch.bindings = normalizeArrowBindings(this.activeArrowBindingEdit);
        }
        node.setAttrs({
            ...patch,
            scaleX: 1,
            scaleY: 1,
            offsetX: 0,
            offsetY: 0,
        });
        this.transformer.forceUpdate();
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
        this._notifySelectionBoundsChange();
        return final ? patch : null;
    }

    _clearRotationQuickControls() {
        this._setRotationInteractionActive(false);
        this.rotationQuickControls?.connector.destroy();
        this.rotationQuickControls?.group.destroy();
        this.rotationQuickControls = null;
    }

    _canShowRotationQuickControls(node) {
        const selectedNodes = this._getSelectedNodes();
        return Boolean(
            node
            && this.interactionEnabled
            && !this.resizeInteractionActive
            && selectedNodes.length > 0
            && this.selectedElementIds.includes(node.getAttr('elementId'))
            && selectedNodes.every((selectedNode) => (
                selectedNode.getAttr('locked') !== true
                && selectedNode.getAttr('elementType') !== 'frame'
            ))
            && !this.activeTextEditor,
        );
    }

    _renderRotationQuickControls(node) {
        this._clearRotationQuickControls();
        if (
            !this._canShowRotationQuickControls(node)
            || typeof this.Konva?.Line !== 'function'
            || typeof this.Konva?.Group !== 'function'
        ) {
            return;
        }

        const connector = new this.Konva.Line({
            name: 'rotation-drag-connector',
            points: [],
            stroke: '#c8c8c8',
            strokeWidth: 1.5,
            strokeScaleEnabled: false,
            listening: false,
            visible: false,
        });
        const group = new this.Konva.Group({
            name: 'rotation-drag-control',
            draggable: true,
            listening: true,
        });
        group.dragBoundFunc((position) => {
            const orbit = this.rotationQuickControls?.orbit;
            return orbit
                ? constrainPointToCircle(
                    orbit.center,
                    position,
                    orbit.radius,
                    group.getAbsolutePosition(),
                )
                : position;
        });
        const background = new this.Konva.Circle({
            radius: ROTATION_CONTROL_SIZE / 2,
            fill: '#ffffff',
            stroke: '#3183ff',
            strokeWidth: 1.5,
            strokeScaleEnabled: false,
            shadowColor: '#282828',
            shadowBlur: 8,
            shadowOffsetY: 2,
            shadowOpacity: 0.14,
        });
        const icon = new this.Konva.Text({
            x: -ROTATION_CONTROL_SIZE / 2,
            y: -ROTATION_CONTROL_SIZE / 2,
            width: ROTATION_CONTROL_SIZE,
            height: ROTATION_CONTROL_SIZE,
            text: '\u21BB',
            fill: '#707070',
            fontFamily: 'Roboto, sans-serif',
            fontSize: 21,
            align: 'center',
            verticalAlign: 'middle',
            listening: false,
        });
        group.add(background, icon);

        this.rotationQuickControls = {
            elementId: node.getAttr('elementId'),
            elementIds: [...this.selectedElementIds],
            connector,
            group,
            background,
            dragState: null,
            orbit: null,
        };
        const tooltip = 'Потяните для поворота с привязкой к ключевым углам';
        group.on('mouseenter.rotationDragControl', () => {
            background.fill('#f3f3f3');
            this.stage.container().style.cursor = 'grab';
            this.stage.container().title = tooltip;
            this.uiLayer.batchDraw();
        });
        group.on('mouseleave.rotationDragControl', () => {
            if (!this.rotationQuickControls?.dragState) {
                background.fill('#ffffff');
            }
            if (this.stage.container().style.cursor === 'grab') {
                this.stage.container().style.cursor = 'default';
            }
            if (this.stage.container().title === tooltip) {
                this.stage.container().removeAttribute('title');
            }
            this.uiLayer.batchDraw();
        });
        group.on('mousedown.rotationDragControl touchstart.rotationDragControl', (event) => {
            event.evt?.preventDefault?.();
            event.cancelBubble = true;
        });
        group.on('dragstart.rotationDragControl', (event) => {
            event.cancelBubble = true;
            background.fill('#ececec');
            this.stage.container().style.cursor = 'grabbing';
            const selectedNodes = this._getSelectedNodes();
            const elements = selectedNodes.map((selectedNode) => ({
                id: String(selectedNode.getAttr('elementId')),
                x: selectedNode.x(),
                y: selectedNode.y(),
                width: selectedNode.width(),
                height: selectedNode.height(),
                rotation: selectedNode.rotation(),
            }));
            const element = elements[0];
            const selectionBounds = this.getSelectionBounds();
            const center = elements.length > 1 && selectionBounds
                ? {
                    x: selectionBounds.x + selectionBounds.width / 2,
                    y: selectionBounds.y + selectionBounds.height / 2,
                }
                : getElementCenter(element);
            this._syncRotationQuickControlOrbit(node);
            this.rotationQuickControls.dragState = {
                element,
                elements,
                center,
                lastPointerAngle: angleFromPoint(
                    center,
                    { x: group.x(), y: group.y() },
                ),
                accumulatedDelta: 0,
            };
            this._setRotationInteractionActive(true);
            this.uiLayer.batchDraw();
        });
        group.on('dragmove.rotationDragControl', (event) => {
            event.cancelBubble = true;
            this._updateRotationFromQuickControl(node, event, false);
        });
        group.on('dragend.rotationDragControl', (event) => {
            event.cancelBubble = true;
            this._updateRotationFromQuickControl(node, event, true);
            background.fill('#f3f3f3');
            this.stage.container().style.cursor = 'grab';
            this.uiLayer.batchDraw();
        });

        this.uiLayer.add(connector, group);
        group.moveToTop();
        this._syncRotationQuickControls(node);
        this.uiLayer.batchDraw();
    }

    _syncRotationQuickControls(node = null) {
        const controls = this.rotationQuickControls;
        if (!controls) {
            return;
        }
        const targetNode = node?.getAttr('elementId') === controls.elementId
            ? node
            : this.nodesById.get(String(controls.elementId));
        const selectedNodes = (controls.elementIds || [controls.elementId])
            .map((elementId) => this.nodesById.get(String(elementId)))
            .filter(Boolean);
        if (
            !targetNode
            || !targetNode.getStage()
            || selectedNodes.length !== (controls.elementIds || [controls.elementId]).length
        ) {
            this._clearRotationQuickControls();
            return;
        }
        if (controls.dragState) {
            this._syncRotationQuickControlConnector(targetNode);
            return;
        }
        const scale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
        const inverseScale = 1 / scale;
        const selectionBounds = selectedNodes.length > 1 ? this.getSelectionBounds() : null;
        const element = selectionBounds
            ? { ...selectionBounds, rotation: 0 }
            : {
                x: targetNode.x(),
                y: targetNode.y(),
                width: targetNode.width(),
                height: targetNode.height(),
                rotation: targetNode.rotation(),
            };
        const center = getElementCenter(element);
        const handleAngle = (element.rotation + 90) * Math.PI / 180;
        const orbitRadius = element.height / 2
            + (ROTATION_CONTROL_OFFSET + ROTATION_CONTROL_SIZE / 2) * inverseScale;
        controls.group.scale({ x: inverseScale, y: inverseScale });
        controls.group.position({
            x: center.x + Math.cos(handleAngle) * orbitRadius,
            y: center.y + Math.sin(handleAngle) * orbitRadius,
        });
        this._syncRotationQuickControlOrbit(targetNode);
        this._syncRotationQuickControlConnector(targetNode);
        controls.group.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncRotationQuickControlConnector(node) {
        const controls = this.rotationQuickControls;
        if (!controls || !node) {
            return;
        }
        const scale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
        const selectedBounds = (controls.elementIds || []).length > 1
            ? this.getSelectionBounds()
            : null;
        const geometry = selectedBounds
            ? { ...selectedBounds, rotation: 0 }
            : {
                x: node.x(),
                y: node.y(),
                width: node.width(),
                height: node.height(),
                rotation: node.rotation(),
            };
        const center = controls.dragState?.center || getElementCenter(geometry);
        const handle = { x: controls.group.x(), y: controls.group.y() };
        const deltaX = handle.x - center.x;
        const deltaY = handle.y - center.y;
        const distance = Math.max(0.0001, Math.hypot(deltaX, deltaY));
        const boundaryDistance = positiveNumber(geometry.height, 1) / 2;
        const handleRadius = ROTATION_CONTROL_SIZE / 2 / scale;
        controls.connector.points([
            center.x + deltaX / distance * boundaryDistance,
            center.y + deltaY / distance * boundaryDistance,
            handle.x - deltaX / distance * handleRadius,
            handle.y - deltaY / distance * handleRadius,
        ]);
        controls.connector.moveToTop();
        controls.group.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncRotationQuickControlOrbit(node) {
        const controls = this.rotationQuickControls;
        if (!controls || !node) {
            return;
        }
        const selectedBounds = (controls.elementIds || []).length > 1
            ? this.getSelectionBounds()
            : null;
        const localCenter = controls.dragState?.center || getElementCenter(selectedBounds
            ? { ...selectedBounds, rotation: 0 }
            : {
                x: node.x(),
                y: node.y(),
                width: node.width(),
                height: node.height(),
                rotation: node.rotation(),
            });
        const center = this.uiLayer.getAbsoluteTransform().point(localCenter);
        const handle = controls.group.getAbsolutePosition();
        controls.orbit = {
            center,
            radius: Math.max(1, Math.hypot(handle.x - center.x, handle.y - center.y)),
        };
    }

    _updateRotationFromQuickControl(node, event, final) {
        const controls = this.rotationQuickControls;
        const dragState = controls?.dragState;
        if (!dragState || controls.elementId !== node?.getAttr('elementId')) {
            return null;
        }
        const snapStep = event?.evt?.shiftKey ? ROTATION_SNAP_STEP : 0;
        const currentPoint = { x: controls.group.x(), y: controls.group.y() };
        const center = dragState.center || getElementCenter(dragState.element);
        const currentPointerAngle = angleFromPoint(center, currentPoint);
        dragState.accumulatedDelta = accumulateRotationDelta(
            dragState.accumulatedDelta,
            dragState.lastPointerAngle,
            currentPointerAngle,
        );
        dragState.lastPointerAngle = currentPointerAngle;
        const rotationElements = Array.isArray(dragState.elements)
            ? dragState.elements
            : [dragState.element];
        const isGroupRotation = rotationElements.length > 1;
        const baseRotation = isGroupRotation ? 0 : finiteNumber(dragState.element.rotation, 0);
        let nextRotation = baseRotation + dragState.accumulatedDelta;
        if (snapStep > 0) {
            nextRotation = Math.round(nextRotation / snapStep) * snapStep;
        } else {
            nextRotation = snapRotationToKeyAngle(nextRotation);
        }
        const rotationDelta = normalizeAngleDelta(nextRotation - baseRotation);
        const updates = isGroupRotation
            ? createGroupRotationUpdates(rotationElements, rotationDelta, center)
            : [{
                elementId: String(dragState.element.id || controls.elementId),
                patch: createRotationPatch(dragState.element, rotationDelta),
            }];
        for (const update of updates) {
            const targetNode = this.nodesById.get(String(update.elementId));
            targetNode?.position({ x: update.patch.x, y: update.patch.y });
            targetNode?.rotation(update.patch.rotation);
            if (targetNode) {
                this._syncHyperlinkIndicator(targetNode);
            }
        }
        const patch = updates[0]?.patch || null;
        this._syncElementBindingGuides(
            node,
            controls.elementIds || [controls.elementId],
            { allowSnap: false },
        );
        this.transformer.forceUpdate();
        if (Array.isArray(this.selectedElementIds)) {
            this._renderSelectionOutlines(this._getSelectedNodes());
        }
        this._syncArrowControlHandles(node);
        this._syncRotationQuickControlConnector(node);
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
        this._notifySelectionBoundsChange();
        if (!final) {
            return patch;
        }

        this._hideElementBindingGuides();
        controls.dragState = null;
        this._setRotationInteractionActive(false);
        if (Math.abs(rotationDelta) < 0.01) {
            this._syncRotationQuickControls(node);
            return null;
        }
        this._syncRotationQuickControls(node);
        if (isGroupRotation) {
            this.onCommitMany(updates, 'Общий поворот группы объектов');
        } else {
            this.onCommit(node.getAttr('elementId'), patch, 'Поворот объекта');
        }
        return isGroupRotation ? updates : patch;
    }

    _finishActiveRotation(nativeEvent = null) {
        const controls = this.rotationQuickControls;
        if (!controls?.dragState) {
            return false;
        }
        const node = this.nodesById.get(String(controls.elementId));
        if (!node) {
            controls.dragState = null;
            this._setRotationInteractionActive(false);
            return false;
        }
        controls.group.stopDrag?.();
        return Boolean(this._updateRotationFromQuickControl(
            node,
            { evt: nativeEvent, cancelBubble: true },
            true,
        ));
    }

    _setRotationInteractionActive(active) {
        const nextActive = active === true;
        if (this.rotationInteractionActive === nextActive) {
            return;
        }
        this.rotationInteractionActive = nextActive;
        this.onRotationStateChange?.(nextActive);
    }

    _setResizeInteractionActive(active) {
        const nextActive = active === true;
        if (this.resizeInteractionActive === nextActive) {
            return;
        }
        this.resizeInteractionActive = nextActive;
        this.rotationQuickControls?.connector.visible(false);
        this.rotationQuickControls?.group.visible(!nextActive);
        this.uiLayer.batchDraw();
    }

    _setRotationQuickControlsVisible(visible) {
        const isVisible = visible === true && !this.resizeInteractionActive;
        this.rotationQuickControls?.connector.visible(false);
        this.rotationQuickControls?.group.visible(isVisible);
        this.uiLayer.batchDraw();
    }

    _startFrameDraft(event) {
        if (!this.frameToolEnabled || this.brushSuspended || this.activeFrameDraft) {
            return;
        }
        const nativeEvent = event.evt;
        const isTouch = nativeEvent?.type?.startsWith('touch');
        if (!isTouch && nativeEvent?.button !== 0) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        nativeEvent?.preventDefault?.();
        event.cancelBubble = true;
        this.onSelect(null);
        const preview = new this.Konva.Rect({
            x: point.x,
            y: point.y,
            width: 1,
            height: 1,
            fill: 'rgba(49, 131, 255, 0.08)',
            stroke: '#3183ff',
            strokeWidth: 2,
            strokeScaleEnabled: false,
            dash: [9, 6],
            cornerRadius: 6,
            listening: false,
        });
        this.activeFrameDraft = {
            start: { x: point.x, y: point.y },
            current: { x: point.x, y: point.y },
            preview,
        };
        this.uiLayer.add(preview);
        preview.moveToTop();
        this.transformer.moveToTop();
        this.uiLayer.batchDraw();
    }

    _extendFrameDraft(event) {
        if (!this.activeFrameDraft || this.brushSuspended) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        event.evt?.preventDefault?.();
        event.cancelBubble = true;
        this.activeFrameDraft.current = { x: point.x, y: point.y };
        const bounds = this._getFrameDraftBounds();
        this.activeFrameDraft.preview.setAttrs(bounds);
        this.uiLayer.batchDraw();
    }

    _finishFrameDraft() {
        if (!this.activeFrameDraft) {
            return;
        }
        const bounds = this._getFrameDraftBounds();
        const draft = this.activeFrameDraft;
        this.activeFrameDraft = null;
        draft.preview.destroy();
        this.uiLayer.batchDraw();
        if (bounds.width < 24 || bounds.height < 24) {
            return;
        }
        this.onFrameCreate(bounds);
    }

    _cancelFrameDraft() {
        if (!this.activeFrameDraft) {
            return;
        }
        this.activeFrameDraft.preview.destroy();
        this.activeFrameDraft = null;
        this.uiLayer.batchDraw();
    }

    _getFrameDraftBounds() {
        const start = this.activeFrameDraft?.start || { x: 0, y: 0 };
        const current = this.activeFrameDraft?.current || start;
        return {
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            width: Math.abs(current.x - start.x),
            height: Math.abs(current.y - start.y),
        };
    }

    _startObjectPlacement(event) {
        if (!this.placementTool || this.brushSuspended || this.activePlacementDraft) {
            return;
        }
        const nativeEvent = event.evt || {};
        const isTouch = nativeEvent.type?.startsWith('touch');
        if (!isTouch && nativeEvent.button !== 0) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        nativeEvent.preventDefault?.();
        event.cancelBubble = true;
        this.onSelect(null);
        const preview = new this.Konva.Rect({
            x: point.x,
            y: point.y,
            width: 1,
            height: 1,
            fill: this.placementTool.previewFill || 'rgba(49, 131, 255, 0.10)',
            stroke: '#3183ff',
            strokeWidth: 2,
            strokeScaleEnabled: false,
            dash: [8, 5],
            cornerRadius: Number(this.placementTool.cornerRadius) || 6,
            listening: false,
        });
        this.activePlacementDraft = {
            start: point,
            current: point,
            options: { ...this.placementTool },
            preview,
        };
        this.uiLayer.add(preview);
        preview.moveToTop();
        this.transformer.moveToTop();
        this.uiLayer.batchDraw();
    }

    _extendObjectPlacement(event) {
        if (!this.activePlacementDraft) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        event.evt?.preventDefault?.();
        event.cancelBubble = true;
        this.activePlacementDraft.current = point;
        this.activePlacementDraft.preview.setAttrs(normalizePlacementBounds(
            this.activePlacementDraft.start,
            point,
            this.activePlacementDraft.options.aspectRatio,
        ));
        this.uiLayer.batchDraw();
    }

    _finishObjectPlacement() {
        const draft = this.activePlacementDraft;
        if (!draft) {
            return;
        }
        const bounds = resolvePlacementBounds(
            draft.start,
            draft.current,
            draft.options,
        );
        this.activePlacementDraft = null;
        draft.preview.destroy();
        this.uiLayer.batchDraw();
        this.onObjectPlace({ ...draft.options, bounds });
    }

    _cancelObjectPlacementDraft() {
        this.activePlacementDraft?.preview.destroy();
        this.activePlacementDraft = null;
        this.uiLayer?.batchDraw();
    }

    _getBrushPointerPosition() {
        const pointer = this.stage.getPointerPosition();
        if (!pointer) {
            return null;
        }
        return this.contentLayer.getAbsoluteTransform().copy().invert().point(pointer);
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this._finishTextEditing({ commit: false });
        this._cancelSelectionMarquee();
        this._cancelBrushStroke();
        this._cancelArrowDraft();
        this._clearArrowControlHandles();
        this._clearRotationQuickControls();
        this._cancelFrameDraft();
        this._cancelObjectPlacementDraft();
        window.removeEventListener('mouseup', this.handleWindowBrushEnd);
        window.removeEventListener('touchend', this.handleWindowBrushEnd);
        window.removeEventListener('mouseup', this.handleWindowRotationEnd);
        window.removeEventListener('touchend', this.handleWindowRotationEnd);
        window.removeEventListener('pointerup', this.handleWindowRotationEnd);
        window.removeEventListener('blur', this.handleWindowBrushCancel);
        window.removeEventListener('resize', this.handlePixelRatioChange);
        window.clearInterval(this.pixelRatioPollTimer);
        this.pixelRatioPollTimer = null;
        this.pixelRatioMediaQuery?.removeEventListener?.('change', this.handlePixelRatioChange);
        this.pixelRatioMediaQuery?.removeListener?.(this.handlePixelRatioChange);
        this.pixelRatioMediaQuery = null;
        if (this.contentDrawFrame !== null) {
            cancelAnimationFrame(this.contentDrawFrame);
            this.contentDrawFrame = null;
        }
        this.imageLoadQueue.destroy();
        this.imageCache.clear();
        this.imageLoadPromises.clear();
        this.maskedImageCache.clear();
        this.maskedImageLoadPromises.clear();
        this.pendingImageLoads.clear();
        this.activeAssetIds.clear();
        this.activeImageRenderKeys.clear();
        this.nodesById.clear();
        this.frameClipWrappers.clear();
        this.elementFingerprints.clear();
        this.contentRectsCache = null;
        this.stage.destroy();
    }

    _createNode(element) {
        const elementType = element.type === 'rectangle' ? 'shape' : element.type;
        const shapeType = element.type === 'rectangle'
            ? 'rectangle'
            : (element.shapeType || 'rectangle');
        const flipX = elementType === 'image' && element.flipX === true;
        const flipY = elementType === 'image' && element.flipY === true;
        const width = positiveNumber(element.width, 240);
        const height = positiveNumber(element.height, 160);
        const shared = {
            x: finiteNumber(element.x, 0),
            y: finiteNumber(element.y, 0),
            width,
            height,
            rotation: finiteNumber(element.rotation, 0),
            scaleX: flipX ? -1 : 1,
            scaleY: flipY ? -1 : 1,
            offsetX: flipX ? width : 0,
            offsetY: flipY ? height : 0,
            opacity: Math.min(Math.max(finiteNumber(element.opacity, 1), 0), 1),
            draggable: this.interactionEnabled && element.locked !== true,
            elementId: element.id,
            elementType,
            locked: element.locked === true,
            frameId: typeof element.frameId === 'string' ? element.frameId : null,
            groupId: typeof element.groupId === 'string' ? element.groupId : null,
            assetId: elementType === 'image' ? element.assetId : null,
            flipX,
            flipY,
            shapeType,
            keepProportions: elementType === 'image' || PROPORTIONAL_SHAPE_TYPES.has(shapeType),
            aspectRatio: positiveNumber(element.aspectRatio, element.width / element.height),
        };

        if (elementType === 'arrow') {
            const stroke = /^#[0-9a-f]{6}$/i.test(element.stroke) ? element.stroke : '#282828';
            return new this.Konva.Shape({
                ...shared,
                points: Array.isArray(element.points) && element.points.length === 6
                    ? [...element.points]
                    : [0, 0.5, 0.5, 0.5, 1, 0.5],
                stroke,
                fill: stroke,
                strokeWidth: positiveNumber(element.strokeWidth, 5),
                hitStrokeWidth: Math.max(18, positiveNumber(element.strokeWidth, 5) + 12),
                lineCap: 'round',
                lineJoin: 'round',
                startCap: ARROW_CAP_TYPES.includes(element.startCap) ? element.startCap : 'none',
                endCap: ARROW_CAP_TYPES.includes(element.endCap) ? element.endCap : 'arrow1',
                sceneFunc: (context, shape) => drawArrowConnector(context, shape),
            });
        }

        if (['brush', 'highlighter'].includes(elementType)) {
            return new this.Konva.Shape({
                ...shared,
                points: Array.isArray(element.points) ? [...element.points] : [0.5, 0.5],
                stroke: element.stroke || '#282828',
                strokeWidth: positiveNumber(element.strokeWidth, 5),
                hitStrokeWidth: Math.max(12, positiveNumber(element.strokeWidth, 5)),
                lineCap: 'round',
                lineJoin: 'round',
                sceneFunc: (context, shape) => drawBrushStroke(context, shape),
            });
        }

        if (elementType === 'frame') {
            const group = new this.Konva.Group(shared);
            const backgroundColor = /^#[0-9a-f]{6}$/i.test(element.backgroundColor)
                ? element.backgroundColor
                : '#ffffff';
            const backgroundOpacity = Math.min(1, Math.max(0, finiteNumber(element.backgroundOpacity, 0)));
            group.add(new this.Konva.Rect({
                name: 'frame-background',
                width,
                height,
                fill: backgroundColor,
                opacity: backgroundOpacity,
                cornerRadius: 6,
                listening: false,
            }));
            group.add(new this.Konva.Rect({
                width,
                height,
                fill: 'rgba(0, 0, 0, 0)',
                stroke: element.stroke || '#3183ff',
                strokeWidth: 2,
                strokeScaleEnabled: false,
                dash: [9, 6],
                cornerRadius: 6,
            }));
            const layoutColumns = Math.max(0, Math.min(12, Number.parseInt(element.layoutGridColumns, 10) || 0));
            const layoutPadding = Math.max(0, Math.min(200, finiteNumber(element.layoutGridPadding, 16)));
            const layoutGap = Math.max(0, Math.min(200, finiteNumber(element.layoutGridGap, 16)));
            const availableWidth = width - layoutPadding * 2 - layoutGap * Math.max(0, layoutColumns - 1);
            if (layoutColumns > 0 && availableWidth > layoutColumns) {
                const columnWidth = availableWidth / layoutColumns;
                const grid = new this.Konva.Group({
                    name: 'frame-layout-grid',
                    listening: false,
                });
                for (let column = 0; column < layoutColumns; column += 1) {
                    grid.add(new this.Konva.Rect({
                        x: layoutPadding + column * (columnWidth + layoutGap),
                        y: layoutPadding,
                        width: columnWidth,
                        height: Math.max(1, height - layoutPadding * 2),
                        fill: 'rgba(49, 131, 255, 0.075)',
                        stroke: 'rgba(49, 131, 255, 0.28)',
                        strokeWidth: 1,
                        strokeScaleEnabled: false,
                        dash: [5, 5],
                    }));
                }
                group.add(grid);
            }
            group.add(
                new this.Konva.Rect({
                    x: 10,
                    y: 10,
                    width: Math.min(Math.max(width - 20, 60), 220),
                    height: 30,
                    fill: '#ffffff',
                    stroke: '#c8d9f4',
                    strokeWidth: 1,
                    cornerRadius: 7,
                    shadowColor: '#282828',
                    shadowBlur: 5,
                    shadowOpacity: 0.08,
                }),
                new this.Konva.Text({
                    x: 20,
                    y: 10,
                    width: Math.min(Math.max(width - 40, 40), 200),
                    height: 30,
                    text: typeof element.name === 'string' ? element.name : 'Фрейм',
                    fill: '#285f9f',
                    fontFamily: 'Inter',
                    fontSize: 13,
                    fontStyle: 'bold',
                    verticalAlign: 'middle',
                    ellipsis: true,
                }),
            );
            return group;
        }

        if (elementType === 'sticker') {
            const group = new this.Konva.Group(shared);
            group.add(
                new this.Konva.Rect({
                    width,
                    height,
                    fill: element.fill || '#ffdf6b',
                    stroke: element.stroke || 'rgba(40, 40, 40, 0.12)',
                    strokeWidth: Math.max(0, finiteNumber(element.strokeWidth, 1)),
                    cornerRadius: 14,
                    shadowColor: '#282828',
                    shadowBlur: 12,
                    shadowOffsetY: 5,
                    shadowOpacity: 0.12,
                }),
                new this.Konva.Text({
                    width,
                    height,
                    padding: 22,
                    text: typeof element.text === 'string' ? element.text : 'Новая заметка',
                    fill: element.textColor || '#282828',
                    fontFamily: element.fontFamily || 'Roboto',
                    fontSize: positiveNumber(element.fontSize, 28),
                    fontStyle: element.fontStyle || 'normal',
                    lineHeight: 1.25,
                    align: element.align || 'left',
                    verticalAlign: 'top',
                    wrap: 'word',
                    ellipsis: true,
                }),
                new this.Konva.Line({
                    points: [width - 38, 0, width, 0, width, 38],
                    closed: true,
                    fill: '#ffffff',
                    opacity: 0.42,
                }),
            );
            return group;
        }

        if (element.type === 'text') {
            return new this.Konva.Text({
                ...shared,
                text: typeof element.text === 'string' ? element.text : 'Текст',
                fill: element.fill || '#282828',
                fontFamily: element.fontFamily || 'Roboto',
                fontSize: positiveNumber(element.fontSize, 48),
                fontStyle: element.fontStyle || 'normal',
                align: element.align || 'left',
                verticalAlign: 'middle',
                padding: 4,
                hitFunc: (context, shape) => {
                    context.beginPath();
                    context.rect(0, 0, shape.width(), shape.height());
                    context.closePath();
                    context.fillStrokeShape(shape);
                },
            });
        }

        if (elementType === 'shape' && CUSTOM_SHAPE_TYPES.has(shapeType)) {
            return new this.Konva.Shape({
                ...shared,
                fill: element.fill || '#8094b1',
                stroke: element.stroke || '#707070',
                strokeWidth: Math.max(0, finiteNumber(element.strokeWidth, 1)),
                lineCap: 'round',
                lineJoin: 'round',
                sceneFunc: (context, shape) => drawCustomShape(context, shape, shapeType),
            });
        }

        if (elementType === 'image') {
            const cached = this._getCachedRenderableImage(element);
            if (cached?.image) {
                return new this.Konva.Image({
                    ...shared,
                    image: cached.image,
                    imageHydrated: true,
                    cornerRadius: normalizeImageCornerRadius(element.cornerRadius, width, height),
                    sceneFunc: drawRoundedImage,
                    aspectRatio: positiveNumber(
                        element.aspectRatio,
                        cached.width / cached.height,
                    ),
                });
            }
        }

        const isCircle = elementType === 'shape' && shapeType === 'circle';
        return new this.Konva.Rect({
            ...shared,
            fill: elementType === 'image' ? 'rgba(0, 0, 0, 0)' : (element.fill || '#8094b1'),
            stroke: elementType === 'image' ? undefined : element.stroke,
            strokeWidth: Math.max(0, finiteNumber(element.strokeWidth, 1)),
            ...(elementType === 'image' ? { imageHydrated: false } : {}),
            cornerRadius: isCircle
                ? Math.min(shared.width, shared.height) / 2
                : (elementType === 'image'
                    ? normalizeImageCornerRadius(element.cornerRadius, width, height)
                    : positiveNumber(element.cornerRadius, 12)),
        });
    }

    _bindNode(node, elementId) {
        node.on('mousedown.groupSelection touchstart.groupSelection', (event) => {
            if (
                !this.interactionEnabled
                || !node.getAttr('groupId')
                || this.selectedElementIds.includes(elementId)
                || event.evt?.ctrlKey
                || event.evt?.metaKey
                || (!event.evt?.type?.startsWith('touch') && event.evt?.button !== 0)
            ) {
                return;
            }
            this.onSelect(elementId);
        });

        node.on('mouseenter.canvasAdapter mousemove.canvasAdapter', () => {
            const cursor = this.stage.container().style.cursor;
            if (
                this.interactionEnabled
                && !this.selectionMarqueeState
                && cursor !== 'grab'
                && cursor !== 'grabbing'
            ) {
                this.stage.container().style.cursor = this._canDragNode(node) ? 'move' : 'not-allowed';
            }
        });

        node.on('mouseleave.canvasAdapter', () => {
            if (['move', 'not-allowed'].includes(this.stage.container().style.cursor)) {
                this.stage.container().style.cursor = 'default';
            }
        });

        node.on('click.canvasAdapter tap.canvasAdapter', (event) => {
            if (!this.interactionEnabled) {
                return;
            }
            event.cancelBubble = true;
            const toggle = Boolean(event.evt?.ctrlKey || event.evt?.metaKey);
            if (toggle) {
                event.evt?.preventDefault?.();
                this.onSelectMany([elementId], { mode: 'toggle' });
            } else {
                this.onSelect(elementId);
            }
        });

        node.on('dblclick.canvasAdapter dbltap.canvasAdapter', (event) => {
            if (
                !this.interactionEnabled
                || !['text', 'sticker'].includes(node.getAttr('elementType'))
                || node.getAttr('locked') === true
            ) {
                return;
            }
            event.evt?.preventDefault?.();
            event.cancelBubble = true;
            this.beginTextEditing(elementId, { selectAll: true });
        });

        node.on('dragstart.canvasAdapter', () => {
            this.stage.container().style.cursor = 'grabbing';
            this._setRotationQuickControlsVisible(false);
            this.onElementDragStateChange(true);
            const selectedNodes = this._getSelectedNodes();
            const groupDragStarted = this._startGroupDrag(node, elementId, selectedNodes);
            if (!groupDragStarted && node.getAttr('elementType') === 'frame') {
                const childNodes = this._getFrameChildNodes(elementId);
                this.frameDragState = {
                    frameId: elementId,
                    sourceStart: { x: node.x(), y: node.y() },
                    positions: new Map(childNodes.map((childNode) => [
                        childNode.getAttr('elementId'),
                        { x: childNode.x(), y: childNode.y() },
                    ])),
                };
                this.groupDragState = null;
            } else if (!groupDragStarted) {
                this.groupDragState = null;
                this.frameDragState = null;
            }
            if (groupDragStarted && this.groupDragState) {
                const movingNodes = [...this.groupDragState.positions.keys()]
                    .map((id) => this.nodesById.get(String(id)))
                    .filter(Boolean);
                this._setNodesFrameClipSuspended(movingNodes, true);
            } else if (node.getAttr('elementType') !== 'frame') {
                this._setNodeFrameClipSuspended(node, true);
            }
            if (!this._shouldIgnoreGroupNodeDragEvent(node)) {
                this._showElementBindingGuides(node, this._getMovingElementIds(elementId));
            }
        });

        node.on('dragmove.canvasAdapter', () => {
            if (this._shouldIgnoreGroupNodeDragEvent(node)) {
                return;
            }
            if (this.snapEnabled) {
                node.position({ x: this._snap(node.x()), y: this._snap(node.y()) });
            }
            this._moveSelectedNodesWith(node, elementId);
            this._moveFrameChildrenWith(node, elementId);
            this._syncElementBindingGuides(node, this._getMovingElementIds(elementId));
            this._moveSelectedNodesWith(node, elementId);
            this._moveFrameChildrenWith(node, elementId);
            this._syncBoundArrows(elementId);
            this._syncHyperlinkIndicator(node);
            this._syncArrowControlHandles(node);
            this._syncRotationQuickControls(node);
            this._notifySelectionBoundsChange();
        });

        node.on('transform.canvasAdapter', () => {
            if (node.getAttr('elementType') === 'frame') {
                this._updateFrameClipGeometry(elementId, {
                    x: node.x(),
                    y: node.y(),
                    width: node.width() * Math.abs(node.scaleX()),
                    height: node.height() * Math.abs(node.scaleY()),
                    rotation: node.rotation(),
                });
            }
            this._syncElementBindingGuides(node, this._getMovingElementIds(elementId));
            this._syncHyperlinkIndicator(node);
            this._syncArrowControlHandles(node);
            this._syncRotationQuickControls(node);
            this._notifySelectionBoundsChange();
        });

        node.on('transformstart.canvasAdapter', () => {
            this._setResizeInteractionActive(true);
            this._startSelectionTransform();
            this._showElementBindingGuides(node, this._getMovingElementIds(elementId));
        });

        node.on('dragend.canvasAdapter', () => {
            if (this._shouldIgnoreGroupNodeDragEvent(node)) {
                return;
            }
            this.stage.container().style.cursor = 'move';
            this._setRotationQuickControlsVisible(true);
            this.onElementDragStateChange(false);
            node.position({ x: this._snap(node.x()), y: this._snap(node.y()) });
            this._moveSelectedNodesWith(node, elementId);
            this._moveFrameChildrenWith(node, elementId);
            this._syncElementBindingGuides(node, this._getMovingElementIds(elementId));
            this._moveSelectedNodesWith(node, elementId);
            this._moveFrameChildrenWith(node, elementId);
            const x = node.x();
            const y = node.y();
            this._hideElementBindingGuides();
            if (this._finishGroupDragForNode(node, elementId)) {
                return;
            }
            if (this.frameDragState?.frameId === elementId) {
                const childUpdates = this._getFrameChildNodes(elementId).map((childNode) => ({
                    elementId: childNode.getAttr('elementId'),
                    patch: { x: childNode.x(), y: childNode.y() },
                }));
                this.frameDragState = null;
                this.onFrameCommit(
                    elementId,
                    { x, y },
                    childUpdates,
                    'Перемещение фрейма с содержимым',
                );
                return;
            }
            this._setNodeFrameClipSuspended(node, false);
            this.onCommit(elementId, {
                x,
                y,
            }, 'Перемещение объекта');
        });

        node.on('transformend.canvasAdapter', () => {
            this._setResizeInteractionActive(false);
            if (this._queueSelectionTransformEnd(node)) {
                return;
            }
            const elementType = node.getAttr('elementType');
            const minimumSize = elementType === 'image'
                ? MIN_IMAGE_SIZE
                : (elementType === 'frame' ? MIN_FRAME_SIZE : MIN_ELEMENT_SIZE);
            const initialHeight = positiveNumber(node.height(), 1);
            let width;
            let height;
            if (elementType === 'image') {
                const appliedScale = Math.max(
                    Math.abs(node.scaleX()),
                    Math.abs(node.scaleY()),
                    minimumSize / node.width(),
                    minimumSize / node.height(),
                );
                width = node.width() * appliedScale;
                height = node.height() * appliedScale;
            } else {
                width = Math.max(minimumSize, node.width() * Math.abs(node.scaleX()));
                height = Math.max(minimumSize, node.height() * Math.abs(node.scaleY()));
            }
            const x = this._snap(node.x());
            const y = this._snap(node.y());
            if (this.snapEnabled) {
                const isProportional = node.getAttr('keepProportions');
                if (isProportional) {
                    const aspectRatio = positiveNumber(node.getAttr('aspectRatio'), width / height);
                    width = Math.max(minimumSize, minimumSize * aspectRatio, this._snap(width));
                    height = elementType === 'image'
                        ? Math.max(minimumSize, width / aspectRatio)
                        : width;
                } else {
                    width = Math.max(minimumSize, this._snap(width));
                    height = Math.max(minimumSize, this._snap(height));
                }
            }
            const sourceElement = this.document?.elements.find(({ id }) => id === elementId);
            const scaledFontSize = ['text', 'sticker'].includes(elementType)
                ? calculateScaledTextFontSize(sourceElement?.fontSize, initialHeight, height)
                : null;
            const flipX = node.getAttr('flipX') === true;
            const flipY = node.getAttr('flipY') === true;
            node.scale({ x: flipX ? -1 : 1, y: flipY ? -1 : 1 });
            node.position({ x, y });
            node.size({ width, height });
            node.offset({ x: flipX ? width : 0, y: flipY ? height : 0 });
            if (scaledFontSize !== null) {
                if (elementType === 'text' && typeof node.fontSize === 'function') {
                    node.fontSize(scaledFontSize);
                } else if (elementType === 'sticker') {
                    const textNode = Array.from(node.getChildren?.() || []).find(
                        (child) => child.getClassName?.() === 'Text',
                    );
                    textNode?.fontSize?.(scaledFontSize);
                }
            }
            this._syncElementBindingGuides(node, this._getMovingElementIds(elementId));
            this._hideElementBindingGuides();
            const patch = {
                x: node.x(),
                y: node.y(),
                width,
                height,
                rotation: node.rotation(),
            };
            if (scaledFontSize !== null) {
                patch.fontSize = scaledFontSize;
            }
            if (elementType === 'frame') {
                this.onFrameCommit(elementId, patch, [], 'Изменение размера фрейма');
            } else {
                this.onCommit(elementId, patch, 'Трансформация объекта');
            }
        });
    }

    _startSelectionTransform() {
        if (this.selectionTransformState) {
            return true;
        }
        const nodes = this._getSelectedNodes();
        if (
            nodes.length < 2
            || nodes.some((node) => (
                node.getAttr('locked')
                || node.getAttr('elementType') === 'frame'
            ))
        ) {
            return false;
        }
        this.selectionTransformState = {
            elementIds: nodes.map((node) => String(node.getAttr('elementId'))),
            scheduled: false,
        };
        return true;
    }

    _queueSelectionTransformEnd(node) {
        const state = this.selectionTransformState;
        const elementId = String(node?.getAttr?.('elementId') || '');
        if (!state || !state.elementIds.includes(elementId)) {
            return false;
        }
        if (!state.scheduled) {
            state.scheduled = true;
            const finalize = () => {
                if (this.selectionTransformState === state && !this.destroyed) {
                    this._finishSelectionTransform(state);
                }
            };
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(finalize);
            } else {
                Promise.resolve().then(finalize);
            }
        }
        return true;
    }

    _finishSelectionTransform(state) {
        if (this.selectionTransformState !== state) {
            return false;
        }
        const updates = state.elementIds.flatMap((elementId) => {
            const node = this.nodesById.get(elementId);
            if (!node) {
                return [];
            }
            const elementType = node.getAttr('elementType');
            const minimumSize = elementType === 'image' ? MIN_IMAGE_SIZE : MIN_ELEMENT_SIZE;
            const initialHeight = positiveNumber(node.height(), 1);
            let width;
            let height;
            if (elementType === 'image') {
                const appliedScale = Math.max(
                    Math.abs(node.scaleX()),
                    Math.abs(node.scaleY()),
                    minimumSize / positiveNumber(node.width(), 1),
                    minimumSize / positiveNumber(node.height(), 1),
                );
                width = node.width() * appliedScale;
                height = node.height() * appliedScale;
            } else {
                width = Math.max(minimumSize, node.width() * Math.abs(node.scaleX()));
                height = Math.max(minimumSize, node.height() * Math.abs(node.scaleY()));
            }
            const sourceElement = this.document?.elements.find(({ id }) => String(id) === elementId);
            const scaledFontSize = ['text', 'sticker'].includes(elementType)
                ? calculateScaledTextFontSize(sourceElement?.fontSize, initialHeight, height)
                : null;
            const flipX = node.getAttr('flipX') === true;
            const flipY = node.getAttr('flipY') === true;
            node.scale({ x: flipX ? -1 : 1, y: flipY ? -1 : 1 });
            node.size({ width, height });
            node.offset({ x: flipX ? width : 0, y: flipY ? height : 0 });
            if (scaledFontSize !== null) {
                if (elementType === 'text' && typeof node.fontSize === 'function') {
                    node.fontSize(scaledFontSize);
                } else if (elementType === 'sticker') {
                    const textNode = Array.from(node.getChildren?.() || []).find(
                        (child) => child.getClassName?.() === 'Text',
                    );
                    textNode?.fontSize?.(scaledFontSize);
                }
            }
            const patch = {
                x: node.x(),
                y: node.y(),
                width,
                height,
                rotation: node.rotation(),
            };
            if (scaledFontSize !== null) {
                patch.fontSize = scaledFontSize;
            }
            return [{ elementId, patch }];
        });
        this.selectionTransformState = null;
        this._hideElementBindingGuides();
        this._renderSelectionOutlines(this._getSelectedNodes());
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
        this._notifySelectionBoundsChange();
        if (updates.length > 0) {
            this.onCommitMany(updates, 'Общая трансформация группы объектов');
            return true;
        }
        return false;
    }

    async _hydrateImageNode(placeholder, element) {
        try {
            const cached = await this._loadRenderableImage(element);
            if (
                this.destroyed
                || this.nodesById.get(String(element.id)) !== placeholder
                || !placeholder.getStage()
            ) {
                return;
            }

            const imageNode = new this.Konva.Image({
                ...placeholder.getAttrs(),
                image: cached.image,
                imageHydrated: true,
                cornerRadius: normalizeImageCornerRadius(element.cornerRadius, element.width, element.height),
                sceneFunc: drawRoundedImage,
                aspectRatio: positiveNumber(element.aspectRatio, cached.width / cached.height),
            });
            this._bindNode(imageNode, element.id);
            this._disableSceneNodeBuffering(imageNode);
            const clipWrapper = this.frameClipWrappers?.get(String(element.id));
            placeholder.destroy();
            if (clipWrapper) {
                clipWrapper.add(imageNode);
            } else {
                this.contentLayer.add(imageNode);
            }
            this.nodesById.set(String(element.id), imageNode);
            this.contentRectsCache = null;
            // Индекс берётся только из document.elements; отдельного zIndex в документе нет.
            const liveIndex = this.document?.elements.findIndex(({ id }) => id === element.id) ?? -1;
            if (liveIndex >= 0) {
                this._getElementRenderRoot(imageNode)?.zIndex(liveIndex);
            }
            if (this.selectedElementIds.includes(element.id)) {
                this.setSelections(this.selectedElementIds);
            }
            // Несколько параллельно загруженных изображений объединяются в одну
            // синхронную отрисовку ближайшего animation frame.
            this._scheduleContentDraw();
        } catch (error) {
            if (
                this.destroyed
                || this.nodesById.get(String(element.id)) !== placeholder
                || !placeholder.getStage()
            ) {
                return;
            }
            placeholder.setAttrs({ fill: '#fbe3e3', stroke: '#f14545' });
            this.contentLayer.batchDraw();
            try {
                this.onAssetError(error, element);
            } catch (_) {
                // Ошибка пользовательского callback не должна ломать отрисовку остальных элементов.
            }
        }
    }

    _loadCachedImage(assetId) {
        const cached = this.imageCache.get(assetId);
        if (cached) {
            return Promise.resolve(cached);
        }
        const pending = this.imageLoadPromises.get(assetId);
        if (pending) {
            return pending;
        }

        const operation = this.imageLoadQueue.enqueue(async () => {
            const asset = await this.assetLoader(assetId);
            if (!asset?.blob) {
                throw new Error(`Изображение «${assetId}» отсутствует в локальном хранилище.`);
            }
            const image = await this._loadImage(asset.blob);
            const result = Object.freeze({
                image,
                width: positiveNumber(asset.width, image.naturalWidth || image.width),
                height: positiveNumber(asset.height, image.naturalHeight || image.height),
            });
            if (!this.destroyed && this.activeAssetIds.has(String(assetId))) {
                this.imageCache.set(assetId, result);
            }
            return result;
        });
        this.imageLoadPromises.set(assetId, operation);
        operation.then(
            () => {
                if (this.imageLoadPromises.get(assetId) === operation) {
                    this.imageLoadPromises.delete(assetId);
                }
            },
            () => {
                if (this.imageLoadPromises.get(assetId) === operation) {
                    this.imageLoadPromises.delete(assetId);
                }
            },
        );
        return operation;
    }

    _getCachedRenderableImage(element) {
        if (!hasImageEraseMask(element?.eraseMask)) {
            return this.imageCache.get(element?.assetId);
        }
        return this.maskedImageCache.get(createImageRenderCacheKey(element));
    }

    _loadRenderableImage(element) {
        if (!hasImageEraseMask(element?.eraseMask)) {
            return this._loadCachedImage(element.assetId);
        }
        const renderKey = createImageRenderCacheKey(element);
        const cached = this.maskedImageCache.get(renderKey);
        if (cached) {
            return Promise.resolve(cached);
        }
        const pending = this.maskedImageLoadPromises.get(renderKey);
        if (pending) {
            return pending;
        }

        const operation = this._loadCachedImage(element.assetId).then((source) => {
            const committedPreview = this.maskedImageCache.get(renderKey);
            if (committedPreview) {
                return committedPreview;
            }
            const image = createMaskedImageCanvas(source.image, element.eraseMask);
            const result = Object.freeze({
                image,
                width: source.width,
                height: source.height,
            });
            if (!this.destroyed && this.activeImageRenderKeys.has(renderKey)) {
                this.maskedImageCache.set(renderKey, result);
            }
            return result;
        });
        this.maskedImageLoadPromises.set(renderKey, operation);
        operation.finally(() => {
            if (this.maskedImageLoadPromises.get(renderKey) === operation) {
                this.maskedImageLoadPromises.delete(renderKey);
            }
        }).catch(() => {});
        return operation;
    }

    _pruneImageCache() {
        for (const assetId of this.imageCache.keys()) {
            if (!this.activeAssetIds.has(String(assetId))) {
                this.imageCache.delete(assetId);
            }
        }
        for (const renderKey of this.maskedImageCache.keys()) {
            if (!this.activeImageRenderKeys.has(renderKey)) {
                this.maskedImageCache.delete(renderKey);
            }
        }
    }

    _scheduleContentDraw() {
        if (this.contentDrawFrame !== null || this.destroyed) {
            return;
        }
        this.contentDrawFrame = requestAnimationFrame(() => {
            this.contentDrawFrame = null;
            if (!this.destroyed) {
                this.contentLayer.draw();
            }
        });
    }

    _loadImage(blob) {
        const objectUrl = URL.createObjectURL(blob);
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Не удалось загрузить изображение из IndexedDB.'));
            };
            image.src = objectUrl;
        });
    }

    _getMinimumSize() {
        const node = this.transformer?.nodes()[0];
        if (node?.getAttr('elementType') === 'image') {
            return MIN_IMAGE_SIZE;
        }
        return node?.getAttr('elementType') === 'frame' ? MIN_FRAME_SIZE : MIN_ELEMENT_SIZE;
    }

    _getSelectedNodes() {
        return this.selectedElementIds
            .map((elementId) => this.nodesById.get(String(elementId)))
            .filter(Boolean);
    }

    _startSelectionMarquee(event) {
        const nativeEvent = event.evt || {};
        const isTouch = nativeEvent.type?.startsWith('touch');
        const isPrimaryPointer = isTouch || nativeEvent.button === undefined || nativeEvent.button === 0;
        if (
            !this.interactionEnabled
            || !isPrimaryPointer
            || event.target !== this.stage
            || this.selectionMarqueeState
        ) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        nativeEvent.preventDefault?.();
        const additive = Boolean(nativeEvent.ctrlKey || nativeEvent.metaKey);
        this.selectionMarqueeState = {
            start: point,
            current: point,
            additive,
            moved: false,
        };
        if (!additive) {
            this.onSelect(null);
        }
        this.selectionMarquee = new this.Konva.Rect({
            x: point.x,
            y: point.y,
            width: 0,
            height: 0,
            fill: 'rgba(49, 131, 255, 0.10)',
            stroke: '#3183ff',
            strokeWidth: 1.5,
            strokeScaleEnabled: false,
            dash: [7, 5],
            listening: false,
            visible: false,
        });
        this.uiLayer.add(this.selectionMarquee);
        this.transformer.moveToTop();
        this.stage.container().style.cursor = 'crosshair';
        this.uiLayer.batchDraw();
    }

    _extendSelectionMarquee(event) {
        if (!this.selectionMarqueeState || !this.selectionMarquee) {
            return;
        }
        const point = this._getBrushPointerPosition();
        if (!point) {
            return;
        }
        event.evt?.preventDefault?.();
        this.selectionMarqueeState.current = point;
        const rect = normalizeSelectionRect(this.selectionMarqueeState.start, point);
        const scale = Math.max(0.1, Math.abs(this.contentLayer.scaleX()));
        this.selectionMarqueeState.moved = rect.width >= 4 / scale || rect.height >= 4 / scale;
        this.selectionMarquee.setAttrs({ ...rect, visible: this.selectionMarqueeState.moved });
        this.stage.container().style.cursor = 'crosshair';
        this.uiLayer.batchDraw();
    }

    _finishSelectionMarquee() {
        const state = this.selectionMarqueeState;
        if (!state) {
            return;
        }
        const rect = normalizeSelectionRect(state.start, state.current);
        const selectedIds = state.moved
            ? [...this.nodesById.values()]
                .filter((node) => selectionRectIntersects(
                    rect,
                    this._getNodeContentRect(node),
                ))
                .map((node) => node.getAttr('elementId'))
            : [];
        this._cancelSelectionMarquee();
        if (state.moved) {
            this.onSelectMany(selectedIds, { mode: state.additive ? 'add' : 'replace' });
        }
    }

    _cancelSelectionMarquee() {
        this.selectionMarquee?.destroy();
        this.selectionMarquee = null;
        this.selectionMarqueeState = null;
        if (this.interactionEnabled && this.stage?.container()) {
            this.stage.container().style.cursor = 'default';
        }
        this.uiLayer?.batchDraw();
    }

    _notifySelectionBoundsChange() {
        try {
            this.onSelectionBoundsChange(this.getSelectionClientRect());
        } catch (_) {
            // UI positioning must not interrupt canvas interactions.
        }
    }

    _syncNodeDraggability(selectedNodes = this._getSelectedNodes()) {
        for (const node of this.nodesById.values()) {
            node.draggable(this._canDragNode(node, selectedNodes));
        }
    }

    _canDragNode(node, selectedNodes = this._getSelectedNodes()) {
        if (!this.interactionEnabled || node.getAttr('locked')) {
            return false;
        }
        if (
            this.imageEraser
            && String(node.getAttr('elementId')) === this.imageEraser.elementId
        ) {
            return false;
        }
        if (selectedNodes.length <= 1) {
            return true;
        }
        return selectedNodes.every((selectedNode) => !selectedNode.getAttr('locked'))
            && selectedNodes.includes(node);
    }

    _moveSelectedNodesWith(sourceNode, sourceElementId) {
        const state = this.groupDragState;
        if (!state || state.sourceElementId !== sourceElementId) {
            return;
        }
        const deltaX = sourceNode.x() - state.sourceStart.x;
        const deltaY = sourceNode.y() - state.sourceStart.y;
        for (const [elementId, start] of state.positions) {
            const selectedNode = this.nodesById.get(String(elementId));
            if (!selectedNode) {
                continue;
            }
            if (
                Number.isFinite(Number(start?.rotation))
                && typeof selectedNode.rotation === 'function'
            ) {
                selectedNode.rotation(finiteNumber(start.rotation, 0));
            }
            const positionHandledByKonva = (
                elementId === sourceElementId
                || (
                    state.initiator !== 'selection'
                    && state.transformerElementIds.has(elementId)
                )
            );
            if (!positionHandledByKonva) {
                selectedNode.position({ x: start.x + deltaX, y: start.y + deltaY });
            }
            this._syncHyperlinkIndicator(selectedNode);
        }
        this.transformer.forceUpdate();
        this._renderSelectionOutlines(this._getSelectedNodes());
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
    }

    _bindTransformerSelectionDrag() {
        const selectionArea = this.transformer.findOne('.back');
        if (!selectionArea) {
            return;
        }
        selectionArea.on('mouseenter.canvasAdapterSelectionDrag', () => {
            if (this.interactionEnabled && this._getSelectedNodes().length > 1) {
                this.stage.container().style.cursor = 'move';
            }
        });
        selectionArea.on('mouseleave.canvasAdapterSelectionDrag', () => {
            if (this.stage.container().style.cursor === 'move') {
                this.stage.container().style.cursor = 'default';
            }
        });
        selectionArea.on('dragstart.canvasAdapterSelectionDrag', () => {
            if (this._startTransformerSelectionDrag()) {
                const movingNodes = [...this.groupDragState.positions.keys()]
                    .map((id) => this.nodesById.get(String(id)))
                    .filter(Boolean);
                this._setNodesFrameClipSuspended(movingNodes, true);
                this._setRotationQuickControlsVisible(false);
                this.onElementDragStateChange(true);
                this.stage.container().style.cursor = 'grabbing';
                this._showElementBindingGuides(
                    this.groupDragSourceNode,
                    this._getMovingElementIds(this.groupDragState.sourceElementId),
                );
            }
        });
        selectionArea.on('dragmove.canvasAdapterSelectionDrag', () => {
            if (this.groupDragInitiator !== 'selection') {
                return;
            }
            const sourceNode = this.groupDragSourceNode;
            const sourceElementId = this.groupDragState?.sourceElementId;
            if (sourceNode && sourceElementId) {
                if (this.snapEnabled) {
                    sourceNode.position({
                        x: this._snap(sourceNode.x()),
                        y: this._snap(sourceNode.y()),
                    });
                }
                this._moveSelectedNodesWith(sourceNode, sourceElementId);
                this._syncElementBindingGuides(
                    sourceNode,
                    this._getMovingElementIds(sourceElementId),
                );
                this._moveSelectedNodesWith(sourceNode, sourceElementId);
            }
            this.transformer.forceUpdate();
            this._renderSelectionOutlines(this._getSelectedNodes());
            this.contentLayer.batchDraw();
            this.uiLayer.batchDraw();
            this._notifySelectionBoundsChange();
        });
        selectionArea.on('dragend.canvasAdapterSelectionDrag', () => {
            this._setRotationQuickControlsVisible(true);
            this.onElementDragStateChange(false);
            if (this._finishTransformerSelectionDrag()) {
                this.stage.container().style.cursor = 'move';
            }
            this._hideElementBindingGuides();
        });
    }

    _startTransformerSelectionDrag() {
        const selectedNodes = this._getSelectedNodes();
        const sourceNode = selectedNodes[0];
        if (!sourceNode) {
            return false;
        }
        return this._startGroupDrag(
            sourceNode,
            sourceNode.getAttr('elementId'),
            selectedNodes,
            { initiator: 'selection' },
        );
    }

    _finishTransformerSelectionDrag() {
        const state = this.groupDragState;
        const sourceNode = this.groupDragSourceNode;
        if (!state || state.initiator !== 'selection' || !sourceNode) {
            return false;
        }
        sourceNode.position({
            x: this._snap(sourceNode.x()),
            y: this._snap(sourceNode.y()),
        });
        this._moveSelectedNodesWith(sourceNode, state.sourceElementId);
        this._syncElementBindingGuides(
            sourceNode,
            this._getMovingElementIds(state.sourceElementId),
        );
        this._moveSelectedNodesWith(sourceNode, state.sourceElementId);
        return this._commitGroupDrag(sourceNode, state.sourceElementId);
    }

    _startGroupDrag(node, elementId, selectedNodes, { initiator = 'object' } = {}) {
        // Konva.Transformer запускает proxy dragstart для остальных выделенных
        // узлов. Они относятся к уже активному жесту и не должны подменять его
        // исходный объект или начальные координаты.
        if (this.groupDragState && this.groupDragNodes.has(node)) {
            // При drag за общую область Transformer node dragstart иногда
            // приходит первым. Повышаем уже созданную сессию до selection-drag,
            // иначе общий обработчик не будет пересчитывать направляющие группы.
            if (initiator === 'selection') {
                this.groupDragState.initiator = 'selection';
                this.groupDragInitiator = 'selection';
            }
            return true;
        }

        this.groupDragState = null;
        this.groupDragNodes = new WeakSet();
        this.groupDragSourceNode = null;
        this.groupDragInitiator = null;
        if (
            selectedNodes.length <= 1
            || !this.selectedElementIds.includes(elementId)
            || selectedNodes.some((selectedNode) => selectedNode.getAttr('locked'))
        ) {
            return false;
        }

        const movementNodes = this._getGroupMovementNodes(selectedNodes);
        this.groupDragState = {
            sourceElementId: elementId,
            sourceStart: { x: node.x(), y: node.y() },
            initiator,
            transformerElementIds: new Set(selectedNodes.map(
                (selectedNode) => selectedNode.getAttr('elementId'),
            )),
            positions: new Map(movementNodes.map((selectedNode) => [
                selectedNode.getAttr('elementId'),
                {
                    x: selectedNode.x(),
                    y: selectedNode.y(),
                    rotation: typeof selectedNode.rotation === 'function'
                        ? finiteNumber(selectedNode.rotation(), 0)
                        : 0,
                },
            ])),
        };
        this.groupDragNodes = new WeakSet(selectedNodes);
        this.groupDragSourceNode = node;
        this.groupDragInitiator = initiator;
        this.frameDragState = null;
        return true;
    }

    _isGroupDragProxyNode(node) {
        return this.groupDragNodes.has(node) && node !== this.groupDragSourceNode;
    }

    _shouldIgnoreGroupNodeDragEvent(node) {
        return this.groupDragNodes.has(node)
            && (
                this.groupDragInitiator === 'selection'
                || node !== this.groupDragSourceNode
            );
    }

    _getGroupMovementNodes(selectedNodes) {
        const nodesById = new Map(
            selectedNodes.map((node) => [node.getAttr('elementId'), node]),
        );
        for (const node of selectedNodes) {
            if (node.getAttr('elementType') !== 'frame') {
                continue;
            }
            for (const childNode of this._getFrameChildNodes(node.getAttr('elementId'))) {
                nodesById.set(childNode.getAttr('elementId'), childNode);
            }
        }
        return [...nodesById.values()];
    }

    _commitGroupDrag(sourceNode, sourceElementId) {
        const state = this.groupDragState;
        if (!state || state.sourceElementId !== sourceElementId) {
            return false;
        }
        for (const [elementId, start] of state.positions) {
            const node = this.nodesById.get(String(elementId));
            if (
                node
                && Number.isFinite(Number(start?.rotation))
                && typeof node.rotation === 'function'
            ) {
                node.rotation(finiteNumber(start.rotation, 0));
            }
        }
        const updates = createGroupDragUpdates(
            state.positions,
            state.sourceStart,
            { x: sourceNode.x(), y: sourceNode.y() },
        );
        const movedNodes = [...state.positions.keys()]
            .map((id) => this.nodesById.get(String(id)))
            .filter(Boolean);
        this._setNodesFrameClipSuspended(movedNodes, false);
        this.groupDragState = null;
        this.onCommitMany(updates, 'Перемещение группы объектов');
        return true;
    }

    _finishGroupDragForNode(node, elementId) {
        if (!this.groupDragNodes.has(node)) {
            return false;
        }
        if (
            node === this.groupDragSourceNode
            && this.groupDragState?.sourceElementId === elementId
        ) {
            this._commitGroupDrag(node, elementId);
        }
        // Proxy-узлы Transformer также получают dragend. Их координаты уже
        // входят в групповую команду, отдельный onCommit здесь недопустим.
        return true;
    }

    _getFrameChildNodes(frameId) {
        const childIds = new Set(
            (this.document?.elements || [])
                .filter((element) => element.frameId === frameId)
                .map(({ id }) => id),
        );
        if (childIds.size === 0) {
            return [];
        }
        return [...this.nodesById.values()].filter(
            (node) => childIds.has(node.getAttr('elementId')),
        );
    }

    _moveFrameChildrenWith(frameNode, frameId) {
        const state = this.frameDragState;
        if (!state || state.frameId !== frameId) {
            return;
        }
        const deltaX = frameNode.x() - state.sourceStart.x;
        const deltaY = frameNode.y() - state.sourceStart.y;
        this._updateFrameClipGeometry(frameId, {
            x: frameNode.x(),
            y: frameNode.y(),
            rotation: frameNode.rotation(),
        });
        for (const childNode of this._getFrameChildNodes(frameId)) {
            const start = state.positions.get(childNode.getAttr('elementId'));
            if (!start) {
                continue;
            }
            childNode.position({ x: start.x + deltaX, y: start.y + deltaY });
            this._syncHyperlinkIndicator(childNode);
        }
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
    }

    _renderSelectionOutlines(nodes) {
        const outlinedNodes = nodes.length > 1 || (
            nodes.length === 1
            && this.imageEraser
            && String(nodes[0].getAttr('elementId')) === this.imageEraser.elementId
        ) ? nodes : [];
        const selectedIds = new Set(outlinedNodes.map((node) => node.getAttr('elementId')));
        for (const [elementId, outline] of this.selectionOutlines) {
            if (!selectedIds.has(elementId)) {
                outline.destroy();
                this.selectionOutlines.delete(elementId);
            }
        }
        for (const node of outlinedNodes) {
            const elementId = node.getAttr('elementId');
            let outline = this.selectionOutlines.get(elementId);
            if (!outline) {
                outline = new this.Konva.Rect({
                    listening: false,
                    fillEnabled: false,
                    stroke: '#3183ff',
                    strokeWidth: 1.5,
                    strokeScaleEnabled: false,
                    dash: [6, 4],
                });
                this.selectionOutlines.set(elementId, outline);
                this.uiLayer.add(outline);
            }
            const rect = node.getClientRect({ relativeTo: this.contentLayer });
            outline.setAttrs({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            });
        }
        this.transformer.moveToTop();
    }

    _renderHyperlinkIndicators(elements) {
        for (const { indicator, tooltip } of this.hyperlinkIndicators.values()) {
            indicator.destroy();
            tooltip.destroy();
        }
        this.hyperlinkIndicators.clear();
        for (const element of elements) {
            const elementType = element.type === 'rectangle' ? 'shape' : element.type;
            if (!element.hyperlink || !['shape', 'image', 'sticker'].includes(elementType)) {
                continue;
            }
            const node = this.nodesById.get(String(element.id));
            if (!node) {
                continue;
            }
            const indicator = new this.Konva.Group({
                listening: true,
                visible: false,
                elementId: element.id,
                hyperlink: element.hyperlink,
            });
            const hyperlink = normalizeObjectHyperlink(element.hyperlink) || element.hyperlink;
            const tooltipWidth = Math.min(320, Math.max(140, hyperlink.length * 6.5 + 18));
            const tooltipHeight = hyperlink.length > 58 ? 52 : 34;
            const tooltip = new this.Konva.Group({
                width: tooltipWidth,
                height: tooltipHeight,
                visible: false,
                listening: false,
            });
            tooltip.add(
                new this.Konva.Rect({
                    width: tooltipWidth,
                    height: tooltipHeight,
                    fill: '#282828',
                    cornerRadius: 7,
                    shadowColor: '#282828',
                    shadowBlur: 8,
                    shadowOpacity: 0.2,
                }),
                new this.Konva.Text({
                    width: tooltipWidth,
                    height: tooltipHeight,
                    padding: 9,
                    text: hyperlink,
                    fill: '#ffffff',
                    fontFamily: 'Roboto',
                    fontSize: 12,
                    lineHeight: 1.35,
                    wrap: 'char',
                    ellipsis: true,
                    verticalAlign: 'middle',
                }),
            );
            indicator.add(
                new this.Konva.Circle({
                    radius: 10,
                    fill: '#ffffff',
                    stroke: '#3183ff',
                    strokeWidth: 1.5,
                    shadowColor: '#282828',
                    shadowBlur: 5,
                    shadowOpacity: 0.16,
                }),
                new this.Konva.Text({
                    x: -7,
                    y: -7,
                    width: 14,
                    height: 14,
                    text: '↗',
                    fill: '#3183ff',
                    fontFamily: 'Inter',
                    fontSize: 12,
                    fontStyle: 'bold',
                    align: 'center',
                    verticalAlign: 'middle',
                }),
            );
            indicator.on('mouseenter.hyperlink', () => {
                this.stage.container().style.cursor = 'pointer';
                tooltip.visible(true);
                tooltip.moveToTop();
                this.uiLayer.batchDraw();
            });
            indicator.on('mouseleave.hyperlink', () => {
                if (this.stage.container().style.cursor === 'pointer') {
                    this.stage.container().style.cursor = 'default';
                }
                tooltip.visible(false);
                this.uiLayer.batchDraw();
            });
            indicator.on('click.hyperlink tap.hyperlink', (event) => {
                event.evt?.preventDefault?.();
                event.cancelBubble = true;
                this.onHyperlinkOpen(indicator.getAttr('hyperlink'), {
                    elementId: indicator.getAttr('elementId'),
                });
            });
            this.hyperlinkIndicators.set(element.id, { indicator, tooltip });
            this.uiLayer.add(indicator, tooltip);
            this._syncHyperlinkIndicator(node);
        }
        this.transformer.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncHyperlinkIndicatorVisibility() {
        if (!(this.hyperlinkIndicators instanceof Map)) {
            return;
        }
        const selectedIds = new Set(this.selectedElementIds);
        for (const [elementId, { indicator, tooltip }] of this.hyperlinkIndicators) {
            const visible = selectedIds.has(elementId) && !this.imageEraser;
            indicator.visible(visible);
            if (!visible && tooltip.visible()) {
                tooltip.visible(false);
                if (this.stage.container().style.cursor === 'pointer') {
                    this.stage.container().style.cursor = 'default';
                }
            }
        }
    }

    _syncHyperlinkIndicator(node) {
        const entry = this.hyperlinkIndicators.get(node?.getAttr('elementId'));
        if (!entry) {
            return;
        }
        const { indicator, tooltip } = entry;
        const width = node.width() * Math.abs(node.scaleX());
        const localX = Math.max(12, width - 10);
        const localY = 10;
        const rotation = node.rotation();
        const radians = rotation * Math.PI / 180;
        const indicatorPosition = {
            x: node.x() + localX * Math.cos(radians) - localY * Math.sin(radians),
            y: node.y() + localX * Math.sin(radians) + localY * Math.cos(radians),
        };
        indicator.position(indicatorPosition);
        indicator.rotation(rotation);
        const viewportScale = Math.max(0.1, Math.abs(this.uiLayer.scaleX()));
        const inverseScale = 1 / viewportScale;
        indicator.scale({ x: inverseScale, y: inverseScale });
        tooltip.scale({ x: inverseScale, y: inverseScale });

        const visibleLeft = -this.uiLayer.x() / viewportScale;
        const visibleTop = -this.uiLayer.y() / viewportScale;
        const visibleRight = visibleLeft + this.stage.width() / viewportScale;
        const visibleBottom = visibleTop + this.stage.height() / viewportScale;
        const tooltipWidth = tooltip.width() * inverseScale;
        const tooltipHeight = tooltip.height() * inverseScale;
        const gap = 16 * inverseScale;
        const margin = 8 * inverseScale;
        const preferredRight = indicatorPosition.x + gap;
        const preferredLeft = indicatorPosition.x - gap - tooltipWidth;
        const tooltipX = preferredRight + tooltipWidth <= visibleRight - margin
            ? preferredRight
            : preferredLeft;
        tooltip.position({
            x: Math.max(
                visibleLeft + margin,
                Math.min(tooltipX, visibleRight - tooltipWidth - margin),
            ),
            y: Math.max(
                visibleTop + margin,
                Math.min(
                    indicatorPosition.y - tooltipHeight / 2,
                    visibleBottom - tooltipHeight - margin,
                ),
            ),
        });
        tooltip.rotation(0);
        indicator.moveToTop();
        this.transformer.moveToTop();
        this.uiLayer.batchDraw();
    }

    _syncHyperlinkIndicators() {
        if (!(this.hyperlinkIndicators instanceof Map)) {
            return;
        }
        for (const elementId of this.hyperlinkIndicators.keys()) {
            const node = this.nodesById.get(String(elementId));
            if (node) {
                this._syncHyperlinkIndicator(node);
            }
        }
    }

    _syncBoundArrows(movingElementId = null) {
        if (!this.document?.elements) {
            return;
        }
        const liveElements = this.document.elements.map((element) => {
            const node = this.nodesById.get(String(element.id));
            if (!node) {
                return element;
            }
            return {
                ...element,
                x: node.x(),
                y: node.y(),
                width: node.width(),
                height: node.height(),
                rotation: node.rotation(),
                ...(element.type === 'arrow'
                    ? { points: [...(node.getAttr('points') || [])] }
                    : {}),
            };
        });
        const movingId = movingElementId === null ? null : String(movingElementId);
        reconcileArrowBindings(liveElements, this.document.elements);
        for (const element of liveElements) {
            if (element.type !== 'arrow' || element.id === movingId) {
                continue;
            }
            const node = this.nodesById.get(String(element.id));
            if (!node || !Array.isArray(element.points) || element.points.length !== 6) {
                continue;
            }
            node.setAttrs({
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
                rotation: element.rotation,
                points: [...element.points],
            });
            this._syncHyperlinkIndicator(node);
            this._syncArrowControlHandles(node);
        }
        this.contentLayer.batchDraw();
        this.uiLayer.batchDraw();
    }

    _isPointerInsideSelection(nativeEvent = {}) {
        if (this.selectedElementIds.length === 0 || this.transformer.nodes().length === 0) {
            return false;
        }
        const pointer = this.stage.getPointerPosition?.() || {
            x: Number(nativeEvent.offsetX),
            y: Number(nativeEvent.offsetY),
        };
        if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) {
            return false;
        }
        const rect = this.transformer.getClientRect();
        const padding = 8;
        return pointer.x >= rect.x - padding
            && pointer.x <= rect.x + rect.width + padding
            && pointer.y >= rect.y - padding
            && pointer.y <= rect.y + rect.height + padding;
    }

    _snap(value) {
        const number = finiteNumber(value, 0);
        return this.snapEnabled ? Math.round(number / SNAP_GRID_SIZE) * SNAP_GRID_SIZE : number;
    }
}
