export const BACKGROUND_REMOVAL_PRESET_DEFINITIONS = Object.freeze({
    preset_0: Object.freeze({
        name: 'Пресет по умолчанию',
        description: 'Сбалансированный вариант для большинства изображений.',
    }),
    preset_1: Object.freeze({
        name: 'Удаление маски',
        description: 'Удаляет ранее созданную маску изображения.',
    }),
    preset_01: Object.freeze({
        name: 'Универсальный',
        description: 'Подходит для предметов, людей и смешанных сцен.',
    }),
    preset_02: Object.freeze({
        name: 'Чёткий контур',
        description: 'Максимально сохраняет резкие границы объекта.',
    }),
    preset_03: Object.freeze({
        name: 'Мягкие края',
        description: 'Сглаживает волосы и другие сложные края.',
    }),
});

export const BACKGROUND_REMOVAL_PRESET_IDS = Object.freeze(
    Object.keys(BACKGROUND_REMOVAL_PRESET_DEFINITIONS),
);
