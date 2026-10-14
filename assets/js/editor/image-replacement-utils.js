export function replaceImageAssetInPage(page, elementId, asset) {
    const assetId = String(asset?.id || '').trim();
    const assetWidth = Number(asset?.width);
    const assetHeight = Number(asset?.height);
    if (!page || !Array.isArray(page.elements) || !assetId) {
        return false;
    }
    if (
        !Number.isFinite(assetWidth)
        || !Number.isFinite(assetHeight)
        || assetWidth <= 0
        || assetHeight <= 0
    ) {
        throw new Error('Не удалось определить размеры нового изображения.');
    }

    const element = page.elements.find(({ id }) => id === elementId);
    if (!element || element.type !== 'image') {
        return false;
    }

    element.assetId = assetId;
    element.aspectRatio = assetWidth / assetHeight;
    delete element.backgroundRemoved;
    delete element.eraseMask;
    return true;
}
