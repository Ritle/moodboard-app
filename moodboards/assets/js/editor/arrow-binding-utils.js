import { denormalizeArrowPoints, normalizeArrowPoints } from './arrow-utils.js';

export const ARROW_BINDING_TARGET_TYPES = Object.freeze([
    'image',
    'text',
    'shape',
    'rectangle',
    'sticker',
    'frame',
]);

export const ARROW_BINDING_ANCHORS = Object.freeze([
    Object.freeze({ x: 0, y: 0, side: 'top-left' }),
    Object.freeze({ x: 0.5, y: 0, side: 'top' }),
    Object.freeze({ x: 1, y: 0, side: 'top-right' }),
    Object.freeze({ x: 1, y: 0.5, side: 'right' }),
    Object.freeze({ x: 1, y: 1, side: 'bottom-right' }),
    Object.freeze({ x: 0.5, y: 1, side: 'bottom' }),
    Object.freeze({ x: 0, y: 1, side: 'bottom-left' }),
    Object.freeze({ x: 0, y: 0.5, side: 'left' }),
]);

function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value) {
    return Math.round(value * 100000) / 100000;
}

export function isArrowBindingTarget(element, arrowId = null) {
    return Boolean(
        element
        && typeof element.id === 'string'
        && element.id !== arrowId
        && ARROW_BINDING_TARGET_TYPES.includes(element.type),
    );
}

export function resolveElementAnchor(element, anchor) {
    if (!element || !anchor) {
        return null;
    }
    const width = Math.max(1, finite(element.width, 1));
    const height = Math.max(1, finite(element.height, 1));
    const normalizedX = Math.min(1, Math.max(0, finite(anchor.x, 0.5)));
    const normalizedY = Math.min(1, Math.max(0, finite(anchor.y, 0.5)));
    const localX = (element.flipX === true ? 1 - normalizedX : normalizedX) * width;
    const localY = (element.flipY === true ? 1 - normalizedY : normalizedY) * height;
    const radians = finite(element.rotation, 0) * Math.PI / 180;
    return Object.freeze({
        x: finite(element.x) + localX * Math.cos(radians) - localY * Math.sin(radians),
        y: finite(element.y) + localX * Math.sin(radians) + localY * Math.cos(radians),
    });
}

export function findNearestArrowBinding(elements, point, threshold, arrowId = null) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        return null;
    }
    const maximumDistance = Math.max(0, finite(threshold));
    let nearest = null;
    for (const element of Array.isArray(elements) ? elements : []) {
        if (!isArrowBindingTarget(element, arrowId)) {
            continue;
        }
        for (const anchor of ARROW_BINDING_ANCHORS) {
            const anchorPoint = resolveElementAnchor(element, anchor);
            const distance = Math.hypot(
                anchorPoint.x - Number(point.x),
                anchorPoint.y - Number(point.y),
            );
            if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) {
                nearest = Object.freeze({
                    point: anchorPoint,
                    distance,
                    binding: Object.freeze({
                        targetElementId: element.id,
                        anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
                    }),
                });
            }
        }
    }
    return nearest;
}

export function resolveArrowBinding(elements, binding) {
    const targetId = typeof binding?.targetElementId === 'string'
        ? binding.targetElementId
        : '';
    const target = (Array.isArray(elements) ? elements : []).find(({ id }) => id === targetId);
    return isArrowBindingTarget(target) ? resolveElementAnchor(target, binding.anchor) : null;
}

export function normalizeArrowBindings(bindings) {
    const normalized = {};
    for (const endpoint of ['start', 'end']) {
        const binding = bindings?.[endpoint];
        const targetElementId = typeof binding?.targetElementId === 'string'
            ? binding.targetElementId.trim()
            : '';
        if (!targetElementId || !binding?.anchor) {
            continue;
        }
        normalized[endpoint] = {
            targetElementId,
            anchor: {
                x: round(Math.min(1, Math.max(0, finite(binding.anchor.x, 0.5)))),
                y: round(Math.min(1, Math.max(0, finite(binding.anchor.y, 0.5)))),
            },
        };
    }
    return normalized;
}

export function remapArrowBindings(bindings, elementIdMap, { keepUnmapped = false } = {}) {
    const normalized = normalizeArrowBindings(bindings);
    return Object.fromEntries(Object.entries(normalized).flatMap(([endpoint, binding]) => {
        const remappedId = elementIdMap?.get?.(binding.targetElementId);
        if (!remappedId && !keepUnmapped) {
            return [];
        }
        return [[endpoint, {
            ...binding,
            targetElementId: remappedId || binding.targetElementId,
        }]];
    }));
}

export function detachArrowBindingsForIndependentMove(element, patch, movingElementIds = []) {
    if (
        element?.type !== 'arrow'
        || !element.bindings
        || Object.prototype.hasOwnProperty.call(patch || {}, 'bindings')
        || Object.prototype.hasOwnProperty.call(patch || {}, 'points')
        || !['x', 'y', 'width', 'height', 'rotation'].some((property) => (
            Object.prototype.hasOwnProperty.call(patch || {}, property)
        ))
    ) {
        return false;
    }
    const movingIds = new Set(Array.from(movingElementIds || []).map(String));
    const nextBindings = Object.fromEntries(
        Object.entries(element.bindings).filter(([, binding]) => (
            movingIds.has(binding?.targetElementId)
        )),
    );
    if (Object.keys(nextBindings).length > 0) {
        element.bindings = nextBindings;
    } else {
        delete element.bindings;
    }
    return true;
}

export function reconcileArrowBindings(elements, previousElements = elements) {
    if (!Array.isArray(elements)) {
        return false;
    }
    const previousById = new Map(
        (Array.isArray(previousElements) ? previousElements : []).map((element) => [element.id, element]),
    );
    let changed = false;
    for (const arrow of elements) {
        if (arrow?.type !== 'arrow' || !arrow.bindings) {
            continue;
        }
        const bindings = normalizeArrowBindings(arrow.bindings);
        const previousArrow = previousById.get(arrow.id) || arrow;
        const previousPoints = denormalizeArrowPoints(previousArrow);
        const currentPoints = denormalizeArrowPoints(arrow);
        if (currentPoints.length !== 3 || previousPoints.length !== 3) {
            continue;
        }
        const nextPoints = currentPoints.map((point) => ({ ...point }));
        const endpointDeltas = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
        for (const [endpoint, pointIndex, deltaIndex] of [
            ['start', 0, 0],
            ['end', 2, 1],
        ]) {
            if (!bindings[endpoint]) {
                continue;
            }
            const resolved = resolveArrowBinding(elements, bindings[endpoint]);
            if (!resolved) {
                delete bindings[endpoint];
                changed = true;
                continue;
            }
            const endpointEdited = Math.hypot(
                currentPoints[pointIndex].x - previousPoints[pointIndex].x,
                currentPoints[pointIndex].y - previousPoints[pointIndex].y,
            ) > 0.001;
            endpointDeltas[deltaIndex] = endpointEdited
                ? { x: 0, y: 0 }
                : {
                    x: resolved.x - previousPoints[pointIndex].x,
                    y: resolved.y - previousPoints[pointIndex].y,
                };
            nextPoints[pointIndex] = { x: resolved.x, y: resolved.y };
        }
        nextPoints[1] = {
            x: currentPoints[1].x + (endpointDeltas[0].x + endpointDeltas[1].x) / 2,
            y: currentPoints[1].y + (endpointDeltas[0].y + endpointDeltas[1].y) / 2,
        };
        const geometry = normalizeArrowPoints(nextPoints);
        if (!geometry) {
            continue;
        }
        Object.assign(arrow, {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
            rotation: 0,
            points: [...geometry.points],
        });
        if (Object.keys(bindings).length > 0) {
            arrow.bindings = bindings;
        } else {
            delete arrow.bindings;
        }
        changed = true;
    }
    return changed;
}
