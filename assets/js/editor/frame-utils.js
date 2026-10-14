function finiteNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function getElementCenter(element) {
    const x = finiteNumber(element?.x);
    const y = finiteNumber(element?.y);
    const width = Math.max(0, finiteNumber(element?.width));
    const height = Math.max(0, finiteNumber(element?.height));
    const rotation = finiteNumber(element?.rotation) * Math.PI / 180;
    const localCenterX = width / 2;
    const localCenterY = height / 2;
    return Object.freeze({
        x: x + localCenterX * Math.cos(rotation) - localCenterY * Math.sin(rotation),
        y: y + localCenterX * Math.sin(rotation) + localCenterY * Math.cos(rotation),
    });
}

export function getFrameClipPolygon(frame) {
    const x = finiteNumber(frame?.x);
    const y = finiteNumber(frame?.y);
    const width = Math.max(0, finiteNumber(frame?.width));
    const height = Math.max(0, finiteNumber(frame?.height));
    const rotation = finiteNumber(frame?.rotation) * Math.PI / 180;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return Object.freeze([
        Object.freeze({ x, y }),
        Object.freeze({ x: x + width * cosine, y: y + width * sine }),
        Object.freeze({
            x: x + width * cosine - height * sine,
            y: y + width * sine + height * cosine,
        }),
        Object.freeze({ x: x - height * sine, y: y + height * cosine }),
    ]);
}

export function isFrameClippingEnabled(frame) {
    return frame?.type === 'frame' && frame.clipContent !== false;
}

export function isElementInsideFrame(element, frame) {
    if (!element || !frame || element.id === frame.id || element.type === 'frame') {
        return false;
    }
    const center = getElementCenter(element);
    const frameX = finiteNumber(frame.x);
    const frameY = finiteNumber(frame.y);
    const frameWidth = Math.max(0, finiteNumber(frame.width));
    const frameHeight = Math.max(0, finiteNumber(frame.height));
    const rotation = -finiteNumber(frame.rotation) * Math.PI / 180;
    const deltaX = center.x - frameX;
    const deltaY = center.y - frameY;
    const localX = deltaX * Math.cos(rotation) - deltaY * Math.sin(rotation);
    const localY = deltaX * Math.sin(rotation) + deltaY * Math.cos(rotation);
    return localX >= 0
        && localY >= 0
        && localX <= frameWidth
        && localY <= frameHeight;
}

export function findContainingFrame(elements, element) {
    if (!Array.isArray(elements) || !element || element.type === 'frame') {
        return null;
    }
    return [...elements]
        .reverse()
        .find((candidate) => candidate.type === 'frame' && isElementInsideFrame(element, candidate))
        || null;
}

export function syncFrameMembership(elements, frameId) {
    const frame = elements.find(({ id }) => id === frameId && typeof id === 'string');
    if (!frame || frame.type !== 'frame') {
        return [];
    }
    const capturedIds = [];
    for (const element of elements) {
        if (element.type === 'frame') {
            continue;
        }
        const containingFrame = findContainingFrame(elements, element);
        if (containingFrame?.id === frameId) {
            element.frameId = frameId;
            capturedIds.push(element.id);
        } else if (element.frameId === frameId) {
            if (containingFrame) {
                element.frameId = containingFrame.id;
            } else {
                delete element.frameId;
            }
        }
    }
    return capturedIds;
}

export function syncElementFrameMembership(elements, elementId) {
    const element = elements.find(({ id }) => id === elementId);
    if (!element || element.type === 'frame') {
        return null;
    }
    const containingFrame = findContainingFrame(elements, element);
    if (containingFrame) {
        element.frameId = containingFrame.id;
        return containingFrame.id;
    }
    delete element.frameId;
    return null;
}

export function moveFrameBehindContents(elements, frameId) {
    const frameIndex = elements.findIndex(({ id }) => id === frameId);
    if (frameIndex === -1) {
        return false;
    }
    const firstContentIndex = elements.findIndex(({ frameId: ownerId }) => ownerId === frameId);
    if (firstContentIndex === -1 || frameIndex < firstContentIndex) {
        return false;
    }
    const [frame] = elements.splice(frameIndex, 1);
    const insertionIndex = elements.findIndex(({ frameId: ownerId }) => ownerId === frameId);
    elements.splice(Math.max(0, insertionIndex), 0, frame);
    return true;
}
