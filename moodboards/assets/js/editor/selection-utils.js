import { getElementGroupPath } from './group-utils.js';

function finitePoint(point = {}) {
    return {
        x: Number.isFinite(Number(point.x)) ? Number(point.x) : 0,
        y: Number.isFinite(Number(point.y)) ? Number(point.y) : 0,
    };
}

function uniqueIds(values = []) {
    return [...new Set((Array.isArray(values) ? values : [values])
        .map((value) => String(value || ''))
        .filter(Boolean))];
}

export function expandGroupedSelectionIds(elements, elementIds = []) {
    const source = Array.isArray(elements) ? elements : [];
    const requestedIds = new Set(uniqueIds(elementIds));
    if (requestedIds.size === 0) {
        return [];
    }
    const groupIds = new Set(
        source
            .filter(({ id }) => requestedIds.has(String(id)))
            .map((element) => getElementGroupPath(element)[0] || '')
            .filter(Boolean),
    );
    return source
        .filter((element) => (
            requestedIds.has(String(element.id))
            || groupIds.has(getElementGroupPath(element)[0])
        ))
        .map(({ id }) => String(id));
}

export function normalizeSelectionRect(start, end) {
    const from = finitePoint(start);
    const to = finitePoint(end);
    return Object.freeze({
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
    });
}

export function selectionRectIntersects(selectionRect, candidateRect) {
    const selection = normalizeSelectionRect(
        { x: selectionRect?.x, y: selectionRect?.y },
        {
            x: Number(selectionRect?.x) + Number(selectionRect?.width),
            y: Number(selectionRect?.y) + Number(selectionRect?.height),
        },
    );
    const candidate = normalizeSelectionRect(
        { x: candidateRect?.x, y: candidateRect?.y },
        {
            x: Number(candidateRect?.x) + Number(candidateRect?.width),
            y: Number(candidateRect?.y) + Number(candidateRect?.height),
        },
    );
    if (selection.width <= 0 || selection.height <= 0 || candidate.width <= 0 || candidate.height <= 0) {
        return false;
    }
    return selection.x <= candidate.x + candidate.width
        && selection.x + selection.width >= candidate.x
        && selection.y <= candidate.y + candidate.height
        && selection.y + selection.height >= candidate.y;
}

export function resolveSelectionIds(currentIds, incomingIds, mode = 'replace') {
    const current = uniqueIds(currentIds);
    const incoming = uniqueIds(incomingIds);
    if (mode === 'add') {
        return [...new Set([...current, ...incoming])];
    }
    if (mode === 'toggle') {
        const result = [...current];
        for (const elementId of incoming) {
            const index = result.indexOf(elementId);
            if (index >= 0) {
                result.splice(index, 1);
            } else {
                result.push(elementId);
            }
        }
        return result;
    }
    return incoming;
}
