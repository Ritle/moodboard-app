import { MAX_GROUP_DEPTH } from '../models/moodboard-document.js';

export { MAX_GROUP_DEPTH };

function normalizedId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function pathKey(path) {
    return path.join('\u001f');
}

function startsWithPath(path, prefix) {
    return prefix.length <= path.length
        && prefix.every((groupId, index) => path[index] === groupId);
}

export function getElementGroupPath(element = {}) {
    if (Array.isArray(element.groupPath)) {
        return element.groupPath.map(normalizedId).filter(Boolean);
    }
    const legacyGroupId = normalizedId(element.groupId);
    return legacyGroupId ? [legacyGroupId] : [];
}

export function getElementGroupNames(element = {}) {
    const names = {};
    if (element.groupNames && typeof element.groupNames === 'object' && !Array.isArray(element.groupNames)) {
        for (const [groupId, name] of Object.entries(element.groupNames)) {
            const normalizedGroupId = normalizedId(groupId);
            const normalizedName = normalizedId(name);
            if (normalizedGroupId && normalizedName) {
                names[normalizedGroupId] = normalizedName;
            }
        }
    }
    const rootGroupId = getElementGroupPath(element)[0];
    const legacyName = normalizedId(element.groupName);
    if (rootGroupId && legacyName && !names[rootGroupId]) {
        names[rootGroupId] = legacyName;
    }
    return names;
}

export function getGroupName(element, groupId) {
    return getElementGroupNames(element)[normalizedId(groupId)] || '';
}

export function applyElementGroupPath(element, groupPath = [], groupNames = {}) {
    const normalizedPath = groupPath.map(normalizedId).filter(Boolean);
    if (normalizedPath.length === 0) {
        delete element.groupId;
        delete element.groupName;
        delete element.groupPath;
        delete element.groupNames;
        return element;
    }
    const allowedIds = new Set(normalizedPath);
    const normalizedNames = Object.fromEntries(
        Object.entries(groupNames)
            .map(([groupId, name]) => [normalizedId(groupId), normalizedId(name)])
            .filter(([groupId, name]) => groupId && name && allowedIds.has(groupId)),
    );
    element.groupId = normalizedPath[0];
    element.groupPath = normalizedPath;
    if (Object.keys(normalizedNames).length > 0) {
        element.groupNames = normalizedNames;
    } else {
        delete element.groupNames;
    }
    if (normalizedNames[normalizedPath[0]]) {
        element.groupName = normalizedNames[normalizedPath[0]];
    } else {
        delete element.groupName;
    }
    return element;
}

export function commonGroupPath(elements = []) {
    const source = Array.isArray(elements) ? elements.filter(Boolean) : [];
    if (source.length === 0) {
        return [];
    }
    const paths = source.map(getElementGroupPath);
    const limit = Math.min(...paths.map((path) => path.length));
    const common = [];
    for (let index = 0; index < limit; index += 1) {
        if (!paths.every((path) => path[index] === paths[0][index])) {
            break;
        }
        common.push(paths[0][index]);
    }
    return common;
}

function selectionContainsWholeDescendantGroups(elements, selectedIds, parentPath) {
    const selected = new Set(selectedIds.map(String));
    const touchedPrefixes = new Map();
    for (const element of elements) {
        if (!selected.has(String(element.id))) {
            continue;
        }
        const path = getElementGroupPath(element);
        for (let depth = parentPath.length; depth < path.length; depth += 1) {
            const prefix = path.slice(0, depth + 1);
            touchedPrefixes.set(pathKey(prefix), prefix);
        }
    }
    for (const prefix of touchedPrefixes.values()) {
        const members = elements.filter((element) => startsWithPath(getElementGroupPath(element), prefix));
        if (members.some((element) => !selected.has(String(element.id)))) {
            return false;
        }
    }
    return true;
}

export function canGroupElements(elements = [], selectedIds = []) {
    const source = Array.isArray(elements) ? elements : [];
    const selected = new Set(selectedIds.map(String));
    const selection = source.filter(({ id }) => selected.has(String(id)));
    if (selection.length < 2 || selection.some(({ type }) => type === 'frame')) {
        return false;
    }
    const frameId = selection[0].frameId || null;
    if (!selection.every((element) => (element.frameId || null) === frameId)) {
        return false;
    }
    const parentPath = commonGroupPath(selection);
    if (parentPath.length >= MAX_GROUP_DEPTH) {
        return false;
    }
    const parentMembers = parentPath.length > 0
        ? source.filter((element) => startsWithPath(getElementGroupPath(element), parentPath))
        : [];
    if (
        parentMembers.length === selection.length
        && parentMembers.every(({ id }) => selected.has(String(id)))
    ) {
        return false;
    }
    return selectionContainsWholeDescendantGroups(source, [...selected], parentPath);
}

export function createGroupPatches(elements = [], selectedIds = [], groupId, groupName = '') {
    if (!canGroupElements(elements, selectedIds)) {
        return new Map();
    }
    const normalizedGroupId = normalizedId(groupId);
    if (!normalizedGroupId) {
        return new Map();
    }
    const selected = new Set(selectedIds.map(String));
    const selection = elements.filter(({ id }) => selected.has(String(id)));
    const parentPath = commonGroupPath(selection);
    const normalizedGroupName = normalizedId(groupName);
    const patches = new Map();
    for (const element of selection) {
        const path = getElementGroupPath(element);
        const nextPath = [
            ...parentPath,
            normalizedGroupId,
            ...path.slice(parentPath.length),
        ];
        const names = getElementGroupNames(element);
        if (normalizedGroupName) {
            names[normalizedGroupId] = normalizedGroupName;
        }
        const grouped = applyElementGroupPath({}, nextPath, names);
        patches.set(String(element.id), grouped);
    }
    return patches;
}

export function resolveUngroupPaths(elements = [], selectedIds = []) {
    const source = Array.isArray(elements) ? elements : [];
    const selected = new Set(selectedIds.map(String));
    const selection = source.filter(({ id }) => selected.has(String(id)));
    if (selection.length === 0) {
        return [];
    }
    const common = commonGroupPath(selection);
    if (common.length > 0) {
        const members = source.filter((element) => startsWithPath(getElementGroupPath(element), common));
        if (members.length > 0 && members.every(({ id }) => selected.has(String(id)))) {
            return [common];
        }
    }
    const rootIds = new Set(selection.map((element) => getElementGroupPath(element)[0]).filter(Boolean));
    return [...rootIds]
        .map((groupId) => [groupId])
        .filter((path) => {
            const members = source.filter((element) => startsWithPath(getElementGroupPath(element), path));
            return members.length > 0 && members.every(({ id }) => selected.has(String(id)));
        });
}

export function createUngroupPatches(elements = [], selectedIds = []) {
    const targetPaths = resolveUngroupPaths(elements, selectedIds);
    if (targetPaths.length === 0) {
        return new Map();
    }
    const patches = new Map();
    for (const element of elements) {
        const path = getElementGroupPath(element);
        const target = targetPaths.find((candidate) => startsWithPath(path, candidate));
        if (!target) {
            continue;
        }
        const removedGroupId = target.at(-1);
        const removeIndex = target.length - 1;
        const nextPath = path.filter((_, index) => index !== removeIndex);
        const names = getElementGroupNames(element);
        delete names[removedGroupId];
        patches.set(String(element.id), applyElementGroupPath({}, nextPath, names));
    }
    return patches;
}

export function remapElementGroups(element, groupIdMap) {
    const path = getElementGroupPath(element);
    if (path.length === 0) {
        return {};
    }
    const names = getElementGroupNames(element);
    const nextPath = path.map((groupId) => groupIdMap.get(groupId) || groupId);
    const nextNames = Object.fromEntries(path
        .filter((groupId) => names[groupId])
        .map((groupId) => [groupIdMap.get(groupId) || groupId, names[groupId]]));
    return applyElementGroupPath({}, nextPath, nextNames);
}

export function collectGroupIds(elements = []) {
    return new Set((Array.isArray(elements) ? elements : []).flatMap(getElementGroupPath));
}
