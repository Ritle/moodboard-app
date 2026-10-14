export const BINDING_GUIDE_TARGET_TYPES = Object.freeze([
    'image',
    'text',
    'shape',
    'rectangle',
    'sticker',
    'frame',
    'brush',
    'highlighter',
    'arrow',
]);

export const BINDING_GUIDE_ANCHORS = Object.freeze([
    Object.freeze({ side: 'top', slot: 'start', x: 0, y: 0, axis: 'local-x', normalX: 0, normalY: -1 }),
    Object.freeze({ side: 'top', slot: 'center', x: 0.5, y: 0, axis: 'local-x', normalX: 0, normalY: -1 }),
    Object.freeze({ side: 'top', slot: 'end', x: 1, y: 0, axis: 'local-x', normalX: 0, normalY: -1 }),
    Object.freeze({ side: 'right', slot: 'start', x: 1, y: 0, axis: 'local-y', normalX: 1, normalY: 0 }),
    Object.freeze({ side: 'right', slot: 'center', x: 1, y: 0.5, axis: 'local-y', normalX: 1, normalY: 0 }),
    Object.freeze({ side: 'right', slot: 'end', x: 1, y: 1, axis: 'local-y', normalX: 1, normalY: 0 }),
    Object.freeze({ side: 'bottom', slot: 'start', x: 0, y: 1, axis: 'local-x', normalX: 0, normalY: 1 }),
    Object.freeze({ side: 'bottom', slot: 'center', x: 0.5, y: 1, axis: 'local-x', normalX: 0, normalY: 1 }),
    Object.freeze({ side: 'bottom', slot: 'end', x: 1, y: 1, axis: 'local-x', normalX: 0, normalY: 1 }),
    Object.freeze({ side: 'left', slot: 'start', x: 0, y: 0, axis: 'local-y', normalX: -1, normalY: 0 }),
    Object.freeze({ side: 'left', slot: 'center', x: 0, y: 0.5, axis: 'local-y', normalX: -1, normalY: 0 }),
    Object.freeze({ side: 'left', slot: 'end', x: 0, y: 1, axis: 'local-y', normalX: -1, normalY: 0 }),
]);

function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function rotateVector(x, y, radians) {
    return {
        x: x * Math.cos(radians) - y * Math.sin(radians),
        y: x * Math.sin(radians) + y * Math.cos(radians),
    };
}

function resolveElementBoundingCircle(element) {
    const width = Math.max(1, Math.abs(finite(element?.width, 1)));
    const height = Math.max(1, Math.abs(finite(element?.height, 1)));
    const radians = finite(element?.rotation, 0) * Math.PI / 180;
    const centerOffset = rotateVector(width / 2, height / 2, radians);
    return {
        x: finite(element?.x) + centerOffset.x,
        y: finite(element?.y) + centerOffset.y,
        radius: Math.hypot(width / 2, height / 2),
    };
}

function canContainGuideCandidate(sourceCircle, target, maximumDistance, maximumOffset) {
    const targetCircle = resolveElementBoundingCircle(target);
    const minimumAnchorDistance = Math.max(
        0,
        Math.hypot(targetCircle.x - sourceCircle.x, targetCircle.y - sourceCircle.y)
            - sourceCircle.radius
            - targetCircle.radius,
    );
    return minimumAnchorDistance <= Math.hypot(maximumDistance, maximumOffset) + 0.001;
}

export function resolveBindingGuideAnchor(element, anchor) {
    if (!element || !anchor) {
        return null;
    }
    const width = Math.max(1, Math.abs(finite(element.width, 1)));
    const height = Math.max(1, Math.abs(finite(element.height, 1)));
    const radians = finite(element.rotation, 0) * Math.PI / 180;
    const localX = Math.min(1, Math.max(0, finite(anchor.x, 0.5))) * width;
    const localY = Math.min(1, Math.max(0, finite(anchor.y, 0.5))) * height;
    const point = rotateVector(localX, localY, radians);
    const normal = rotateVector(
        finite(anchor.normalX, 0),
        finite(anchor.normalY, -1),
        radians,
    );
    return Object.freeze({
        side: anchor.side,
        slot: anchor.slot || 'center',
        axis: anchor.axis,
        point: Object.freeze({
            x: finite(element.x) + point.x,
            y: finite(element.y) + point.y,
        }),
        normal: Object.freeze(normal),
        tangent: Object.freeze({ x: -normal.y, y: normal.x }),
    });
}

function isGuideTarget(element) {
    return Boolean(
        element
        && typeof element.id === 'string'
        && BINDING_GUIDE_TARGET_TYPES.includes(element.type),
    );
}

function compareCandidates(left, right) {
    const offsetDifference = Math.abs(left.perpendicularOffset) - Math.abs(right.perpendicularOffset);
    if (Math.abs(offsetDifference) > 0.0001) {
        return offsetDifference;
    }
    const distanceDifference = left.distance - right.distance;
    if (Math.abs(distanceDifference) > 0.0001) {
        return distanceDifference;
    }
    const anchorPriority = (candidate) => (
        (candidate.sourceAnchor.slot === 'center' ? 0 : 1)
        + (candidate.targetAnchor.slot === 'center' ? 0 : 1)
    );
    const priorityDifference = anchorPriority(left) - anchorPriority(right);
    if (priorityDifference !== 0) {
        return priorityDifference;
    }
    const kindPriority = (candidate) => candidate.kind === 'edge-alignment' ? 0 : 1;
    const kindDifference = kindPriority(left) - kindPriority(right);
    if (kindDifference !== 0) {
        return kindDifference;
    }
    return String(left.targetElementId).localeCompare(String(right.targetElementId));
}

/**
 * Finds at most one guide for each local translation axis of the moving
 * bounds. Facing sides create a perpendicular connector; parallel sides
 * create an edge-alignment guide. The returned delta moves the
 * selected source anchor exactly onto the target axis.
 */
export function calculatePerpendicularBindingGuides(
    sourceElement,
    targetElements,
    {
        maxDistance = 360,
        snapTolerance = 8,
        normalAlignment = 0.999999,
    } = {},
) {
    if (!sourceElement) {
        return Object.freeze({ delta: Object.freeze({ x: 0, y: 0 }), guides: Object.freeze([]) });
    }
    const maximumDistance = Math.max(0, finite(maxDistance));
    const maximumOffset = Math.max(0, finite(snapTolerance));
    const minimumNormalAlignment = Math.min(1, Math.max(0, finite(normalAlignment, 0.999999)));
    const sourceAnchors = BINDING_GUIDE_ANCHORS.map((anchor) => (
        resolveBindingGuideAnchor(sourceElement, anchor)
    ));
    const sourceCircle = resolveElementBoundingCircle(sourceElement);
    const candidatesByAxis = new Map();

    for (const target of Array.isArray(targetElements) ? targetElements : []) {
        if (!isGuideTarget(target) || target.id === sourceElement.id) {
            continue;
        }
        // A conservative bounding-circle check avoids resolving 12x12 anchor pairs
        // for distant scene elements without excluding any valid guide candidate.
        if (!canContainGuideCandidate(sourceCircle, target, maximumDistance, maximumOffset)) {
            continue;
        }
        const targetAnchors = BINDING_GUIDE_ANCHORS.map((anchor) => (
            resolveBindingGuideAnchor(target, anchor)
        ));
        for (const sourceAnchor of sourceAnchors) {
            for (const targetAnchor of targetAnchors) {
                const normalAlignmentValue = (
                    sourceAnchor.normal.x * targetAnchor.normal.x
                    + sourceAnchor.normal.y * targetAnchor.normal.y
                );
                const vector = {
                    x: targetAnchor.point.x - sourceAnchor.point.x,
                    y: targetAnchor.point.y - sourceAnchor.point.y,
                };
                let candidate = null;
                if (normalAlignmentValue <= -minimumNormalAlignment) {
                    const forwardDistance = (
                        vector.x * sourceAnchor.normal.x
                        + vector.y * sourceAnchor.normal.y
                    );
                    const perpendicularOffset = (
                        vector.x * sourceAnchor.tangent.x
                        + vector.y * sourceAnchor.tangent.y
                    );
                    if (
                        forwardDistance > 0.5
                        && forwardDistance <= maximumDistance
                        && Math.abs(perpendicularOffset) <= maximumOffset
                    ) {
                        candidate = {
                            kind: 'facing',
                            axis: sourceAnchor.axis,
                            sourceAnchor,
                            targetAnchor,
                            targetElementId: target.id,
                            perpendicularOffset,
                            distance: Math.hypot(vector.x, vector.y),
                            correction: {
                                x: sourceAnchor.tangent.x * perpendicularOffset,
                                y: sourceAnchor.tangent.y * perpendicularOffset,
                            },
                        };
                    }
                } else if (
                    normalAlignmentValue >= minimumNormalAlignment
                ) {
                    const tangentDistance = (
                        vector.x * sourceAnchor.tangent.x
                        + vector.y * sourceAnchor.tangent.y
                    );
                    const normalOffset = (
                        vector.x * sourceAnchor.normal.x
                        + vector.y * sourceAnchor.normal.y
                    );
                    if (
                        Math.abs(tangentDistance) > 0.5
                        && Math.abs(tangentDistance) <= maximumDistance
                        && Math.abs(normalOffset) <= maximumOffset
                    ) {
                        candidate = {
                            kind: 'edge-alignment',
                            axis: sourceAnchor.axis === 'local-x' ? 'local-y' : 'local-x',
                            sourceAnchor,
                            targetAnchor,
                            targetElementId: target.id,
                            perpendicularOffset: normalOffset,
                            distance: Math.hypot(vector.x, vector.y),
                            correction: {
                                x: sourceAnchor.normal.x * normalOffset,
                                y: sourceAnchor.normal.y * normalOffset,
                            },
                        };
                    }
                }
                if (!candidate) {
                    continue;
                }
                const current = candidatesByAxis.get(candidate.axis);
                if (!current || compareCandidates(candidate, current) < 0) {
                    candidatesByAxis.set(candidate.axis, candidate);
                }
            }
        }
    }

    const candidates = [...candidatesByAxis.values()];
    const delta = candidates.reduce((result, candidate) => ({
        x: result.x + candidate.correction.x,
        y: result.y + candidate.correction.y,
    }), { x: 0, y: 0 });
    const guides = candidates.map((candidate) => Object.freeze({
        kind: candidate.kind,
        axis: candidate.axis,
        targetElementId: candidate.targetElementId,
        sourceSide: candidate.sourceAnchor.side,
        sourceSlot: candidate.sourceAnchor.slot,
        targetSide: candidate.targetAnchor.side,
        targetSlot: candidate.targetAnchor.slot,
        from: Object.freeze({
            x: candidate.sourceAnchor.point.x + delta.x,
            y: candidate.sourceAnchor.point.y + delta.y,
        }),
        to: candidate.targetAnchor.point,
    }));
    return Object.freeze({
        delta: Object.freeze(delta),
        guides: Object.freeze(guides),
    });
}
