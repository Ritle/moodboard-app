import { parseProjectJson } from '../editor/project-json-transfer.js';

const TEMPLATE_ASSET_BASE = '/moodboards/assets/templates/';

const templates = Object.freeze([
    Object.freeze({
        id: 'bright-luxury',
        title: 'Bright luxury',
        description: 'Светлый интерьер с выразительными цветовыми акцентами',
        previewUrl: `${TEMPLATE_ASSET_BASE}bright-luxury.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}bright-luxury.project.json`,
    }),
    Object.freeze({
        id: 'emerald-bathroom',
        title: 'Emerald Bathroom',
        description: 'Изумрудная ванная с подборкой материалов и сантехники',
        previewUrl: `${TEMPLATE_ASSET_BASE}emerald-bathroom.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}emerald-bathroom.project.json`,
    }),
    Object.freeze({
        id: 'modern-scandi-shopping-list',
        title: 'Modern Scandi — Shopping list',
        description: 'Скандинавская подборка мебели, декора и материалов',
        previewUrl: `${TEMPLATE_ASSET_BASE}modern-scandi-shopping-list.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}modern-scandi-shopping-list.project.json`,
    }),
    Object.freeze({
        id: 'office-interior-yellow-sofa',
        title: 'Office interior — Yellow sofa',
        description: 'Концепция офиса с жёлтым диваном и рабочими зонами',
        previewUrl: `${TEMPLATE_ASSET_BASE}office-interior-yellow-sofa.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}office-interior-yellow-sofa.project.json`,
    }),
    Object.freeze({
        id: 'bright-luxury-variant-2',
        title: 'Bright luxury — вариант 2',
        description: 'Светлый интерьер с выразительными цветовыми акцентами',
        previewUrl: `${TEMPLATE_ASSET_BASE}bright-luxury.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}bright-luxury.project.json`,
    }),
    Object.freeze({
        id: 'emerald-bathroom-variant-2',
        title: 'Emerald Bathroom — вариант 2',
        description: 'Изумрудная ванная с подборкой материалов и сантехники',
        previewUrl: `${TEMPLATE_ASSET_BASE}emerald-bathroom.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}emerald-bathroom.project.json`,
    }),
    Object.freeze({
        id: 'modern-scandi-shopping-list-variant-2',
        title: 'Modern Scandi — Shopping list — вариант 2',
        description: 'Скандинавская подборка мебели, декора и материалов',
        previewUrl: `${TEMPLATE_ASSET_BASE}modern-scandi-shopping-list.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}modern-scandi-shopping-list.project.json`,
    }),
    Object.freeze({
        id: 'office-interior-yellow-sofa-variant-2',
        title: 'Office interior — Yellow sofa — вариант 2',
        description: 'Концепция офиса с жёлтым диваном и рабочими зонами',
        previewUrl: `${TEMPLATE_ASSET_BASE}office-interior-yellow-sofa.preview.jpg`,
        projectUrl: `${TEMPLATE_ASSET_BASE}office-interior-yellow-sofa.project.json`,
    }),
]);

export function getMoodboardTemplates() {
    return templates.map((template) => ({ ...template }));
}

export async function createMoodboardTemplate(templateId, { fetchImpl = globalThis.fetch } = {}) {
    const template = templates.find(({ id }) => id === templateId);
    if (!template) {
        throw new Error('Выбран неизвестный шаблон мудборда.');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('Браузер не поддерживает загрузку шаблонов.');
    }

    let response;
    try {
        response = await fetchImpl(template.projectUrl, {
            credentials: 'same-origin',
            cache: 'no-cache',
        });
    } catch (_) {
        throw new Error(`Не удалось загрузить шаблон «${template.title}».`);
    }
    if (!response?.ok || typeof response.text !== 'function') {
        throw new Error(`Файл шаблона «${template.title}» недоступен.`);
    }

    const payload = parseProjectJson(await response.text());
    return {
        ...template,
        title: template.title,
        document: payload.document,
        assets: payload.assets,
    };
}
