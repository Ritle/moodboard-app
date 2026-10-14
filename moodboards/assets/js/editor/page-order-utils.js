export function reorderPages(pages, sourcePageId, targetPageId, position = 'before') {
    if (!Array.isArray(pages) || !['before', 'after'].includes(position)) {
        return null;
    }
    const sourceId = String(sourcePageId || '');
    const targetId = String(targetPageId || '');
    const sourceIndex = pages.findIndex(({ id }) => id === sourceId);
    const targetIndex = pages.findIndex(({ id }) => id === targetId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return null;
    }

    const reordered = [...pages];
    const [sourcePage] = reordered.splice(sourceIndex, 1);
    const remainingTargetIndex = reordered.findIndex(({ id }) => id === targetId);
    const insertionIndex = remainingTargetIndex + (position === 'after' ? 1 : 0);
    reordered.splice(insertionIndex, 0, sourcePage);

    return reordered.every((page, index) => page.id === pages[index].id)
        ? null
        : reordered;
}
