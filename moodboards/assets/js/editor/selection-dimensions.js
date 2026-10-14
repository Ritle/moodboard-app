function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function formatObjectCount(value) {
    const count = Math.max(0, Math.round(Number(value) || 0));
    const mod100 = count % 100;
    const mod10 = count % 10;
    const suffix = mod100 >= 11 && mod100 <= 14
        ? 'объектов'
        : (mod10 === 1 ? 'объект' : (mod10 >= 2 && mod10 <= 4 ? 'объекта' : 'объектов'));
    return `${count} ${suffix}`;
}

export function formatSelectionDimensions({ count = 1, width, height } = {}) {
    const normalizedWidth = Number(width);
    const normalizedHeight = Number(height);
    if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
        return '';
    }
    const size = `${Math.max(1, Math.round(normalizedWidth))} × ${Math.max(1, Math.round(normalizedHeight))} px`;
    return Number(count) > 1 ? `${formatObjectCount(count)} · ${size}` : size;
}

export function resolveSelectionDimensionsPosition({
    selectionRect,
    badgeWidth,
    badgeHeight,
    workspaceWidth,
    workspaceHeight,
    margin = 12,
    gap = 10,
    reservedBottom = 82,
    rotationClearance = 32,
} = {}) {
    if (!selectionRect) {
        return null;
    }

    const width = Math.max(1, Number(badgeWidth) || 1);
    const height = Math.max(1, Number(badgeHeight) || 1);
    const workspaceRight = Math.max(margin, (Number(workspaceWidth) || 0) - margin);
    const workspaceBottom = Math.max(margin, (Number(workspaceHeight) || 0) - reservedBottom);
    const maxLeft = Math.max(margin, workspaceRight - width);
    const maxTop = Math.max(margin, workspaceBottom - height);
    const selectionLeft = Number(selectionRect.x) || 0;
    const selectionTop = Number(selectionRect.y) || 0;
    const selectionWidth = Math.max(0, Number(selectionRect.width) || 0);
    const selectionHeight = Math.max(0, Number(selectionRect.height) || 0);
    const selectionRight = selectionLeft + selectionWidth;
    const selectionBottom = selectionTop + selectionHeight;
    const selectionCenter = selectionLeft + selectionWidth / 2;
    const belowTop = selectionBottom + gap;
    const belowLeft = selectionRight - width;
    const overlapsRotationHandle = (
        belowLeft < selectionCenter + rotationClearance
        && belowLeft + width > selectionCenter - rotationClearance
    );

    let left;
    let top;
    let placement;
    if (belowTop <= maxTop && !overlapsRotationHandle) {
        left = belowLeft;
        top = belowTop;
        placement = 'below';
    } else if (selectionRight + gap + width <= workspaceRight) {
        left = selectionRight + gap;
        top = selectionBottom - height;
        placement = 'right';
    } else if (selectionLeft - gap - width >= margin) {
        left = selectionLeft - gap - width;
        top = selectionBottom - height;
        placement = 'left';
    } else if (belowTop <= maxTop) {
        left = belowLeft;
        top = belowTop;
        placement = 'below';
    } else {
        left = belowLeft;
        top = selectionBottom - height - gap;
        placement = 'inside';
    }

    return Object.freeze({
        left: Math.round(clamp(left, margin, maxLeft)),
        top: Math.round(clamp(top, margin, maxTop)),
        placement,
    });
}
