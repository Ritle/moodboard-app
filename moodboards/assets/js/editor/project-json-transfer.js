import {
    cloneMoodboardDocument,
    validateMoodboardDocument,
} from '../models/moodboard-document.js';

export const PROJECT_JSON_FORMAT = 'roomplan-moodboard-project';
export const PROJECT_JSON_VERSION = 1;

export function collectDocumentAssetIds(document) {
    validateMoodboardDocument(document);
    return [...new Set(document.pages.flatMap(({ elements }) => (
        elements
            .map(({ assetId }) => typeof assetId === 'string' ? assetId.trim() : '')
            .filter(Boolean)
    )))];
}

export function createProjectJsonPackage({ title, document, assets = [], exportedAt = null }) {
    const documentCopy = cloneMoodboardDocument(document);
    const normalizedAssets = assets.map((asset) => ({
        sourceId: String(asset.sourceId || ''),
        mimeType: String(asset.mimeType || ''),
        width: Number(asset.width) || 0,
        height: Number(asset.height) || 0,
        dataUrl: String(asset.dataUrl || ''),
    }));
    return {
        format: PROJECT_JSON_FORMAT,
        version: PROJECT_JSON_VERSION,
        exportedAt: exportedAt || new Date().toISOString(),
        project: {
            title: String(title || 'Новый проект 1').trim().slice(0, 160) || 'Новый проект 1',
            document: documentCopy,
        },
        assets: normalizedAssets,
    };
}

export function parseProjectJson(serialized) {
    let payload;
    try {
        payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    } catch (_) {
        throw new Error('Файл не является корректным JSON.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('JSON проекта должен содержать объект.');
    }

    const packaged = payload.format === PROJECT_JSON_FORMAT;
    if (packaged && payload.version !== PROJECT_JSON_VERSION) {
        throw new Error(`Версия JSON-проекта ${String(payload.version)} не поддерживается.`);
    }
    const document = packaged ? payload.project?.document : payload;
    validateMoodboardDocument(document);
    const title = packaged
        ? String(payload.project?.title || '').trim().slice(0, 160)
        : '';
    const assets = packaged && Array.isArray(payload.assets) ? payload.assets : [];
    const assetIds = new Set();
    for (const asset of assets) {
        const sourceId = String(asset?.sourceId || '').trim();
        const mimeType = String(asset?.mimeType || '');
        const dataUrl = String(asset?.dataUrl || '');
        if (
            !sourceId
            || assetIds.has(sourceId)
            || !mimeType.startsWith('image/')
            || !dataUrl.startsWith(`data:${mimeType};base64,`)
        ) {
            throw new Error('JSON содержит некорректный или повторяющийся ассет изображения.');
        }
        assetIds.add(sourceId);
    }
    return {
        title,
        document: cloneMoodboardDocument(document),
        assets: assets.map((asset) => ({
            sourceId: String(asset.sourceId),
            mimeType: String(asset.mimeType),
            dataUrl: String(asset.dataUrl),
        })),
    };
}

export function replaceDocumentAssetIds(document, assetIdMap) {
    const copy = cloneMoodboardDocument(document);
    for (const page of copy.pages) {
        for (const element of page.elements) {
            if (typeof element.assetId === 'string' && assetIdMap.has(element.assetId)) {
                element.assetId = assetIdMap.get(element.assetId);
            }
        }
    }
    validateMoodboardDocument(copy);
    return copy;
}

export function blobToDataUrl(blob) {
    if (!(blob instanceof Blob)) {
        return Promise.reject(new TypeError('Для экспорта ассета требуется Blob.'));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true });
        reader.addEventListener('error', () => reject(reader.error || new Error('Не удалось прочитать ассет.')), { once: true });
        reader.readAsDataURL(blob);
    });
}

export function dataUrlToBlob(dataUrl) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
    if (!match) {
        throw new Error('Некорректные данные изображения в JSON-проекте.');
    }
    const binary = atob(match[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1] });
}
