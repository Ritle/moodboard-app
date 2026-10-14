import { getElementGroupNames, getElementGroupPath, getGroupName } from './group-utils.js';

const SHAPE_LABELS = Object.freeze({
    rectangle: 'Прямоугольник',
    circle: 'Круг',
    diamond: 'Ромб',
    triangle: 'Треугольник',
    star: 'Звезда',
    oval: 'Овал',
    hexagon: 'Шестиугольник',
    cloud: 'Облако',
    'arrow-left': 'Стрелка влево',
    'arrow-up': 'Стрелка вверх',
    'arrow-down': 'Стрелка вниз',
    'arrow-right': 'Стрелка вправо',
    'checkbox-x': 'Чекбокс X',
    'checkbox-v': 'Чекбокс V',
});

export const LAYER_TYPE_LABELS = Object.freeze({
    image: 'Изображение',
    text: 'Текст',
    shape: 'Фигура',
    rectangle: 'Прямоугольник',
    brush: 'Кисть',
    highlighter: 'Выделитель',
    sticker: 'Стикер',
    frame: 'Фрейм',
    arrow: 'Стрелка / линия',
    group: 'Группа',
});

function trimmedLabel(value, maxLength = 46) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 1)}…`
        : normalized;
}

export function getLayerLabel(element = {}) {
    const explicitName = trimmedLabel(element.name || element.fileName || element.filename);
    if (explicitName) {
        return explicitName;
    }
    if (['text', 'sticker'].includes(element.type)) {
        return trimmedLabel(element.text) || LAYER_TYPE_LABELS[element.type];
    }
    if (element.type === 'shape') {
        return SHAPE_LABELS[element.shapeType] || LAYER_TYPE_LABELS.shape;
    }
    return LAYER_TYPE_LABELS[element.type] || 'Элемент';
}

export function buildLayerHierarchy(elements = []) {
    const source = Array.isArray(elements) ? elements.filter((element) => (
        element && typeof element.id === 'string'
    )) : [];
    const frameIds = new Set(source.filter(({ type }) => type === 'frame').map(({ id }) => id));
    const parentIdFor = (element) => (
        frameIds.has(element.frameId) && element.frameId !== element.id ? element.frameId : null
    );
    const createElementNode = (element, ancestors) => {
        const canDescend = element.type === 'frame' && !ancestors.has(element.id);
        return {
            id: element.id,
            kind: 'element',
            type: element.type,
            label: getLayerLabel(element),
            locked: element.locked === true,
            elementIds: [element.id],
            children: canDescend
                ? buildLevel(element.id, new Set([...ancestors, element.id]))
                : [],
        };
    };
    const buildGroups = (members, depth, parentKey, ancestors) => {
        const nodes = [];
        const renderedGroups = new Set();
        for (const element of members) {
            const path = getElementGroupPath(element);
            const groupId = path[depth];
            if (!groupId) {
                nodes.push(createElementNode(element, ancestors));
                continue;
            }
            if (renderedGroups.has(groupId)) {
                continue;
            }
            renderedGroups.add(groupId);
            const groupMembers = members.filter((candidate) => (
                getElementGroupPath(candidate)[depth] === groupId
            ));
            nodes.push({
                id: `group:${parentKey}:${groupId}`,
                groupId,
                groupPath: getElementGroupPath(element).slice(0, depth + 1),
                kind: 'group',
                type: 'group',
                label: trimmedLabel(getGroupName(element, groupId)) || `Группа из ${groupMembers.length}`,
                locked: groupMembers.every(({ locked }) => locked === true),
                elementIds: groupMembers.map(({ id }) => id),
                children: buildGroups(groupMembers, depth + 1, `${parentKey}:${groupId}`, ancestors),
            });
        }
        return nodes;
    };
    const buildLevel = (parentFrameId = null, ancestors = new Set()) => {
        const siblings = source
            .filter((element) => parentIdFor(element) === parentFrameId)
            .reverse();
        return buildGroups(siblings, 0, parentFrameId || 'root', ancestors);
    };
    return buildLevel();
}

function normalizeLayerType(type) {
    return type === 'rectangle' ? 'shape' : String(type || '');
}

function normalizeSearchValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
}

function elementSearchText(element, elementsById) {
    const frame = elementsById.get(element.frameId);
    return normalizeSearchValue([
        element.name,
        element.groupName,
        ...Object.values(getElementGroupNames(element)),
        element.fileName,
        element.filename,
        element.text,
        element.hyperlink,
        element.frameId,
        frame ? getLayerLabel(frame) : '',
        LAYER_TYPE_LABELS[normalizeLayerType(element.type)],
        element.type === 'shape' ? SHAPE_LABELS[element.shapeType] : '',
    ].filter(Boolean).join(' '));
}

function elementMatchesFilters(element, elementsById, { query, type, scope }) {
    if (type !== 'all' && normalizeLayerType(element.type) !== type) {
        return false;
    }
    if (scope === 'linked' && !normalizeSearchValue(element.hyperlink)) {
        return false;
    }
    if (scope === 'framed' && !normalizeSearchValue(element.frameId)) {
        return false;
    }
    if (scope === 'unframed' && normalizeSearchValue(element.frameId)) {
        return false;
    }
    return !query || elementSearchText(element, elementsById).includes(query);
}

export function filterLayerHierarchy(nodes, elements = [], filters = {}) {
    const sourceNodes = Array.isArray(nodes) ? nodes : [];
    const sourceElements = Array.isArray(elements) ? elements : [];
    const elementsById = new Map(sourceElements.map((element) => [element.id, element]));
    const normalized = {
        query: normalizeSearchValue(filters.query),
        type: normalizeLayerType(filters.type || 'all') || 'all',
        scope: ['all', 'linked', 'framed', 'unframed'].includes(filters.scope)
            ? filters.scope
            : 'all',
    };
    const filtersActive = normalized.query !== ''
        || normalized.type !== 'all'
        || normalized.scope !== 'all';
    if (!filtersActive) {
        return sourceNodes;
    }

    const filterNodes = (level) => level.flatMap((node) => {
        const filteredChildren = filterNodes(Array.isArray(node.children) ? node.children : []);
        const nodeElements = node.kind === 'group'
            ? []
            : (node.elementIds || []).map((id) => elementsById.get(id)).filter(Boolean);
        const labelMatches = !normalized.query
            || normalizeSearchValue(node.label).includes(normalized.query);
        const virtualGroupMatches = node.kind === 'group'
            && (normalized.type === 'all' || normalized.type === 'group')
            && normalized.scope === 'all'
            && labelMatches;
        const ownMatches = nodeElements.some((element) => (
            elementMatchesFilters(element, elementsById, normalized)
        ));
        if (!virtualGroupMatches && !ownMatches && filteredChildren.length === 0) {
            return [];
        }
        return [{
            ...node,
            children: normalized.scope === 'all' && (virtualGroupMatches || ownMatches)
                ? node.children
                : filteredChildren,
        }];
    });

    return filterNodes(sourceNodes);
}

export function getLayerMapStats(elements = [], selectedIds = []) {
    const source = Array.isArray(elements) ? elements : [];
    const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
    return {
        total: source.length,
        selected: source.filter(({ id }) => selected.has(String(id))).length,
        locked: source.filter(({ locked }) => locked === true).length,
    };
}

export function resolveLayerMapSelection(currentIds, targetIds, additive = false) {
    const current = [...new Set((Array.isArray(currentIds) ? currentIds : []).map(String))];
    const targets = [...new Set((Array.isArray(targetIds) ? targetIds : []).map(String))];
    if (!additive) {
        return targets;
    }
    const currentSet = new Set(current);
    const allSelected = targets.length > 0 && targets.every((id) => currentSet.has(id));
    return allSelected
        ? current.filter((id) => !targets.includes(id))
        : [...new Set([...current, ...targets])];
}

export function collectLayerNodeElementIds(node) {
    if (!node || typeof node !== 'object') {
        return [];
    }
    return [...new Set([
        ...(Array.isArray(node.elementIds) ? node.elementIds : []),
        ...(Array.isArray(node.children)
            ? node.children.flatMap((child) => collectLayerNodeElementIds(child))
            : []),
    ].map(String))];
}

function reorderElementSubset(elements, sourceIds, targetIds, position) {
    const sourceSet = new Set((Array.isArray(sourceIds) ? sourceIds : []).map(String));
    const targetSet = new Set((Array.isArray(targetIds) ? targetIds : []).map(String));
    const moving = elements.filter(({ id }) => sourceSet.has(String(id)));
    const remaining = elements.filter(({ id }) => !sourceSet.has(String(id)));
    const targetIndexes = remaining
        .map(({ id }, index) => targetSet.has(String(id)) ? index : -1)
        .filter((index) => index >= 0);
    if (moving.length === 0 || targetIndexes.length === 0) {
        return null;
    }
    const insertionIndex = position === 'before'
        ? Math.max(...targetIndexes) + 1
        : Math.min(...targetIndexes);
    return [
        ...remaining.slice(0, insertionIndex),
        ...moving,
        ...remaining.slice(insertionIndex),
    ];
}

export function reorderLayerElements(
    elements,
    sourceIds,
    targetIds,
    position = 'before',
    scopeIds = null,
) {
    if (!Array.isArray(elements) || !['before', 'after'].includes(position)) {
        return null;
    }
    const sourceSet = new Set((Array.isArray(sourceIds) ? sourceIds : []).map(String));
    const targetSet = new Set((Array.isArray(targetIds) ? targetIds : []).map(String));
    if (sourceSet.size === 0 || targetSet.size === 0) {
        return null;
    }
    if ([...sourceSet].some((id) => targetSet.has(id))) {
        return null;
    }

    const scopeSet = Array.isArray(scopeIds) && scopeIds.length > 0
        ? new Set(scopeIds.map(String))
        : null;
    const scopedElements = scopeSet
        ? elements.filter(({ id }) => scopeSet.has(String(id)))
        : elements;
    const reorderedScope = reorderElementSubset(
        scopedElements,
        sourceIds,
        targetIds,
        position,
    );
    if (!reorderedScope) {
        return null;
    }
    let scopedIndex = 0;
    const reordered = scopeSet
        ? elements.map((element) => (
            scopeSet.has(String(element.id)) ? reorderedScope[scopedIndex++] : element
        ))
        : reorderedScope;
    return reordered.every((element, index) => element === elements[index]) ? null : reordered;
}
