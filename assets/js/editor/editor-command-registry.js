import { cloneValue } from '../models/moodboard-document.js';
import {
    moveFrameBehindContents,
    syncElementFrameMembership,
    syncFrameMembership,
} from './frame-utils.js';
import {
    detachArrowBindingsForIndependentMove,
    remapArrowBindings,
} from './arrow-binding-utils.js';
import {
    applyElementGroupPath,
    canGroupElements,
    collectGroupIds,
    createGroupPatches,
    createUngroupPatches,
    getElementGroupPath,
    remapElementGroups,
    resolveUngroupPaths,
} from './group-utils.js';

export const EDITOR_COMMANDS = Object.freeze({
    BRING_FORWARD: 'bring-forward',
    BRING_TO_FRONT: 'bring-to-front',
    SEND_BACKWARD: 'send-backward',
    SEND_TO_BACK: 'send-to-back',
    DUPLICATE: 'duplicate',
    DELETE: 'delete',
    GROUP: 'group',
    UNGROUP: 'ungroup',
    ALIGN_TOP: 'align-top',
    ALIGN_VERTICAL: 'align-vertical',
    ALIGN_BOTTOM: 'align-bottom',
    ALIGN_LEFT: 'align-left',
    ALIGN_HORIZONTAL: 'align-horizontal',
    ALIGN_RIGHT: 'align-right',
});

const COMMAND_DEFINITIONS = Object.freeze({
    [EDITOR_COMMANDS.BRING_FORWARD]: Object.freeze({ label: 'Поднять на один слой' }),
    [EDITOR_COMMANDS.BRING_TO_FRONT]: Object.freeze({ label: 'На передний план' }),
    [EDITOR_COMMANDS.SEND_BACKWARD]: Object.freeze({ label: 'Опустить на один слой' }),
    [EDITOR_COMMANDS.SEND_TO_BACK]: Object.freeze({ label: 'На задний план' }),
    [EDITOR_COMMANDS.DUPLICATE]: Object.freeze({ label: 'Дублирование объекта' }),
    [EDITOR_COMMANDS.DELETE]: Object.freeze({ label: 'Удаление объекта' }),
    [EDITOR_COMMANDS.GROUP]: Object.freeze({ label: 'Группировка объектов' }),
    [EDITOR_COMMANDS.UNGROUP]: Object.freeze({ label: 'Разгруппировка объектов' }),
    [EDITOR_COMMANDS.ALIGN_TOP]: Object.freeze({ label: 'Выравнивание по верхнему краю' }),
    [EDITOR_COMMANDS.ALIGN_VERTICAL]: Object.freeze({ label: 'Выравнивание по вертикали' }),
    [EDITOR_COMMANDS.ALIGN_BOTTOM]: Object.freeze({ label: 'Выравнивание по нижнему краю' }),
    [EDITOR_COMMANDS.ALIGN_LEFT]: Object.freeze({ label: 'Выравнивание по левому краю' }),
    [EDITOR_COMMANDS.ALIGN_HORIZONTAL]: Object.freeze({ label: 'Выравнивание по горизонтали' }),
    [EDITOR_COMMANDS.ALIGN_RIGHT]: Object.freeze({ label: 'Выравнивание по правому краю' }),
});

const ALIGNMENT_COMMANDS = new Set([
    EDITOR_COMMANDS.ALIGN_TOP,
    EDITOR_COMMANDS.ALIGN_VERTICAL,
    EDITOR_COMMANDS.ALIGN_BOTTOM,
    EDITOR_COMMANDS.ALIGN_LEFT,
    EDITOR_COMMANDS.ALIGN_HORIZONTAL,
    EDITOR_COMMANDS.ALIGN_RIGHT,
]);

function findSelections(document, selectedElementIds) {
    if (!document || selectedElementIds.length === 0) {
        return [];
    }
    const selectedIds = new Set(selectedElementIds);
    return document.elements
        .map((element, index) => ({ index, element }))
        .filter(({ element }) => selectedIds.has(element.id));
}

function elementBounds(element) {
    const x = Number(element?.x) || 0;
    const y = Number(element?.y) || 0;
    const width = Math.max(0, Number(element?.width) || 0);
    const height = Math.max(0, Number(element?.height) || 0);
    return { x, y, width, height };
}

function mergeBounds(elements) {
    const bounds = elements.map(elementBounds);
    const minX = Math.min(...bounds.map(({ x }) => x));
    const minY = Math.min(...bounds.map(({ y }) => y));
    const maxX = Math.max(...bounds.map(({ x, width }) => x + width));
    const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildAlignmentUnits(document, selectedElementIds) {
    const selectedIds = new Set(selectedElementIds);
    const handledIds = new Set();
    const units = [];
    const selected = document.elements.filter(({ id }) => selectedIds.has(id));

    for (const frame of selected.filter(({ type }) => type === 'frame')) {
        const members = [
            frame,
            ...document.elements.filter(({ frameId }) => frameId === frame.id),
        ];
        members.forEach(({ id }) => handledIds.add(id));
        units.push({ bounds: elementBounds(frame), members });
    }

    const completeGroups = new Map();
    for (const element of selected.filter(({ id }) => !handledIds.has(id))) {
        const path = getElementGroupPath(element);
        for (let depth = 0; depth < path.length; depth += 1) {
            const prefix = path.slice(0, depth + 1);
            const members = document.elements.filter((candidate) => {
                const candidatePath = getElementGroupPath(candidate);
                return prefix.every((groupId, index) => candidatePath[index] === groupId);
            });
            if (members.length > 0 && members.every(({ id }) => selectedIds.has(id))) {
                completeGroups.set(prefix.join('\u001f'), members);
                break;
            }
        }
    }
    for (const members of completeGroups.values()) {
        const availableMembers = members.filter(({ id }) => !handledIds.has(id));
        if (availableMembers.length === 0) {
            continue;
        }
        availableMembers.forEach(({ id }) => handledIds.add(id));
        units.push({ bounds: mergeBounds(availableMembers), members: availableMembers });
    }

    for (const element of selected) {
        if (handledIds.has(element.id)) {
            continue;
        }
        handledIds.add(element.id);
        units.push({ bounds: elementBounds(element), members: [element] });
    }
    return units;
}

export function createAlignmentPatches(document, selectedElementIds, commandName) {
    if (!document || !ALIGNMENT_COMMANDS.has(commandName)) {
        return new Map();
    }
    const units = buildAlignmentUnits(document, selectedElementIds);
    if (units.length < 2) {
        return new Map();
    }
    const selectionBounds = mergeBounds(units.map(({ bounds }) => bounds));
    const patches = new Map();
    for (const unit of units) {
        let deltaX = 0;
        let deltaY = 0;
        if (commandName === EDITOR_COMMANDS.ALIGN_TOP) {
            deltaY = selectionBounds.y - unit.bounds.y;
        } else if (commandName === EDITOR_COMMANDS.ALIGN_VERTICAL) {
            deltaY = selectionBounds.y + selectionBounds.height / 2
                - (unit.bounds.y + unit.bounds.height / 2);
        } else if (commandName === EDITOR_COMMANDS.ALIGN_BOTTOM) {
            deltaY = selectionBounds.y + selectionBounds.height
                - (unit.bounds.y + unit.bounds.height);
        } else if (commandName === EDITOR_COMMANDS.ALIGN_LEFT) {
            deltaX = selectionBounds.x - unit.bounds.x;
        } else if (commandName === EDITOR_COMMANDS.ALIGN_HORIZONTAL) {
            deltaX = selectionBounds.x + selectionBounds.width / 2
                - (unit.bounds.x + unit.bounds.width / 2);
        } else if (commandName === EDITOR_COMMANDS.ALIGN_RIGHT) {
            deltaX = selectionBounds.x + selectionBounds.width
                - (unit.bounds.x + unit.bounds.width);
        }
        if (Math.abs(deltaX) < 0.0001 && Math.abs(deltaY) < 0.0001) {
            continue;
        }
        for (const element of unit.members) {
            patches.set(element.id, {
                x: (Number(element.x) || 0) + deltaX,
                y: (Number(element.y) || 0) + deltaY,
            });
        }
    }
    return patches;
}

export class EditorCommandRegistry {
    constructor({ store, commandManager, idFactory = () => crypto.randomUUID() }) {
        this.store = store;
        this.commandManager = commandManager;
        this.idFactory = idFactory;
    }

    has(commandName) {
        return Object.prototype.hasOwnProperty.call(COMMAND_DEFINITIONS, commandName);
    }

    canExecute(commandName) {
        if (!this.has(commandName)) {
            return false;
        }
        const document = this.store.getActivePage();
        const selectedElementIds = this.store.getSelectedElementIds();
        const selections = findSelections(document, selectedElementIds);
        if (selections.length === 0 || selections.length !== selectedElementIds.length) {
            return false;
        }
        if (selections.some(({ element }) => element.locked === true)) {
            return false;
        }
        if (commandName === EDITOR_COMMANDS.GROUP) {
            return canGroupElements(document.elements, selectedElementIds);
        }
        if (commandName === EDITOR_COMMANDS.UNGROUP) {
            return resolveUngroupPaths(document.elements, selectedElementIds).length > 0;
        }
        if (ALIGNMENT_COMMANDS.has(commandName)) {
            const units = buildAlignmentUnits(document, selectedElementIds);
            return units.length >= 2
                && units.every(({ members }) => members.every(({ locked }) => locked !== true))
                && createAlignmentPatches(document, selectedElementIds, commandName).size > 0;
        }
        if (
            selections.some(({ element }) => element.type === 'frame')
            && [
                EDITOR_COMMANDS.BRING_FORWARD,
                EDITOR_COMMANDS.BRING_TO_FRONT,
                EDITOR_COMMANDS.SEND_BACKWARD,
                EDITOR_COMMANDS.SEND_TO_BACK,
            ].includes(commandName)
        ) {
            return false;
        }
        const selectedIds = new Set(selectedElementIds);
        if (commandName === EDITOR_COMMANDS.BRING_FORWARD) {
            return selections.some(({ index }) => (
                index < document.elements.length - 1
                && !selectedIds.has(document.elements[index + 1].id)
            ));
        }
        if (commandName === EDITOR_COMMANDS.BRING_TO_FRONT) {
            return document.elements.some((element, index) => (
                selectedIds.has(element.id)
                && document.elements.slice(index + 1).some((candidate) => !selectedIds.has(candidate.id))
            ));
        }
        if (commandName === EDITOR_COMMANDS.SEND_BACKWARD) {
            return selections.some(({ index }) => (
                index > 0 && !selectedIds.has(document.elements[index - 1].id)
            ));
        }
        if (commandName === EDITOR_COMMANDS.SEND_TO_BACK) {
            return document.elements.some((element, index) => (
                selectedIds.has(element.id)
                && document.elements.slice(0, index).some((candidate) => !selectedIds.has(candidate.id))
            ));
        }
        return true;
    }

    execute(commandName) {
        if (!this.canExecute(commandName)) {
            return false;
        }

        const selectedElementIds = this.store.getSelectedElementIds();
        const selectedIds = new Set(selectedElementIds);
        let nextSelectionIds = [...selectedElementIds];
        const changed = this.commandManager.execute(
            COMMAND_DEFINITIONS[commandName].label,
            (document) => {
                if (commandName === EDITOR_COMMANDS.BRING_FORWARD) {
                    for (let index = document.elements.length - 2; index >= 0; index -= 1) {
                        if (
                            selectedIds.has(document.elements[index].id)
                            && !selectedIds.has(document.elements[index + 1].id)
                        ) {
                            [document.elements[index], document.elements[index + 1]] = [
                                document.elements[index + 1],
                                document.elements[index],
                            ];
                        }
                    }
                } else if (commandName === EDITOR_COMMANDS.BRING_TO_FRONT) {
                    document.elements = [
                        ...document.elements.filter(({ id }) => !selectedIds.has(id)),
                        ...document.elements.filter(({ id }) => selectedIds.has(id)),
                    ];
                } else if (commandName === EDITOR_COMMANDS.SEND_BACKWARD) {
                    for (let index = 1; index < document.elements.length; index += 1) {
                        if (
                            selectedIds.has(document.elements[index].id)
                            && !selectedIds.has(document.elements[index - 1].id)
                        ) {
                            [document.elements[index - 1], document.elements[index]] = [
                                document.elements[index],
                                document.elements[index - 1],
                            ];
                        }
                    }
                } else if (commandName === EDITOR_COMMANDS.SEND_TO_BACK) {
                    document.elements = [
                        ...document.elements.filter(({ id }) => selectedIds.has(id)),
                        ...document.elements.filter(({ id }) => !selectedIds.has(id)),
                    ];
                } else if (commandName === EDITOR_COMMANDS.DUPLICATE) {
                    const reservedIds = new Set(document.elements.map(({ id }) => id));
                    const selectedFrameIds = new Set(
                        document.elements
                            .filter(({ id, type }) => selectedIds.has(id) && type === 'frame')
                            .map(({ id }) => id),
                    );
                    const sourceElements = document.elements.filter((element) => (
                        selectedIds.has(element.id) || selectedFrameIds.has(element.frameId)
                    ));
                    const idMap = new Map(sourceElements.map((element) => {
                        const id = this._createUniqueId(document, reservedIds);
                        reservedIds.add(id);
                        return [element.id, id];
                    }));
                    const reservedGroupIds = collectGroupIds(document.elements);
                    const groupIdMap = new Map(
                        [...collectGroupIds(sourceElements)]
                            .map((groupId) => {
                                const nextGroupId = this._createUniqueGroupId(document, reservedGroupIds);
                                reservedGroupIds.add(nextGroupId);
                                return [groupId, nextGroupId];
                            }),
                    );
                    const duplicates = sourceElements.map((element) => ({
                        ...cloneValue(element),
                        id: idMap.get(element.id),
                        x: Number(element.x || 0) + 28,
                        y: Number(element.y || 0) + 28,
                        ...(idMap.has(element.frameId) ? { frameId: idMap.get(element.frameId) } : {}),
                        ...remapElementGroups(element, groupIdMap),
                        ...(element.type === 'arrow' && element.bindings
                            ? { bindings: remapArrowBindings(element.bindings, idMap) }
                            : {}),
                        ...(element.type === 'frame' ? { name: `${element.name} — копия`.slice(0, 80) } : {}),
                    }));
                    const duplicateBySourceId = new Map(
                        sourceElements.map((element, index) => [element.id, duplicates[index]]),
                    );
                    document.elements = document.elements.flatMap((element) => {
                        const duplicate = duplicateBySourceId.get(element.id);
                        return duplicate ? [element, duplicate] : [element];
                    });
                    nextSelectionIds = selectedElementIds.map((id) => idMap.get(id)).filter(Boolean);
                } else if (commandName === EDITOR_COMMANDS.DELETE) {
                    const selectedFrameIds = new Set(
                        document.elements
                            .filter(({ id, type }) => selectedIds.has(id) && type === 'frame')
                            .map(({ id }) => id),
                    );
                    document.elements = document.elements.filter((element) => (
                        !selectedIds.has(element.id) && !selectedFrameIds.has(element.frameId)
                    ));
                    nextSelectionIds = [];
                } else if (commandName === EDITOR_COMMANDS.GROUP) {
                    const groupId = this._createUniqueGroupId(document);
                    const patches = createGroupPatches(
                        document.elements,
                        selectedElementIds,
                        groupId,
                        `Группа из ${selectedElementIds.length}`,
                    );
                    for (const element of document.elements) {
                        const patch = patches.get(String(element.id));
                        if (patch) {
                            applyElementGroupPath(
                                element,
                                getElementGroupPath(patch),
                                patch.groupNames,
                            );
                        }
                    }
                } else if (commandName === EDITOR_COMMANDS.UNGROUP) {
                    const patches = createUngroupPatches(document.elements, selectedElementIds);
                    for (const element of document.elements) {
                        const patch = patches.get(String(element.id));
                        if (patch) {
                            applyElementGroupPath(
                                element,
                                getElementGroupPath(patch),
                                patch.groupNames,
                            );
                        }
                    }
                } else if (ALIGNMENT_COMMANDS.has(commandName)) {
                    const patches = createAlignmentPatches(document, selectedElementIds, commandName);
                    const movedFrameIds = [];
                    for (const element of document.elements) {
                        const patch = patches.get(element.id);
                        if (!patch) {
                            continue;
                        }
                        detachArrowBindingsForIndependentMove(element, patch, selectedIds);
                        Object.assign(element, patch);
                        if (element.type === 'frame') {
                            movedFrameIds.push(element.id);
                        } else {
                            const frameId = syncElementFrameMembership(document.elements, element.id);
                            if (frameId) {
                                moveFrameBehindContents(document.elements, frameId);
                            }
                        }
                    }
                    movedFrameIds.forEach((frameId) => syncFrameMembership(document.elements, frameId));
                }
            },
        );

        if (changed) {
            this.store.setSelections(nextSelectionIds);
        }
        return changed;
    }

    _createUniqueId(document, reservedIds = null) {
        const existingIds = reservedIds || new Set(document.elements.map(({ id }) => id));
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const candidate = String(this.idFactory());
            if (candidate && !existingIds.has(candidate)) {
                return candidate;
            }
        }
        throw new Error('Не удалось создать уникальный идентификатор элемента.');
    }

    _createUniqueGroupId(document, reservedIds = null) {
        const existingIds = reservedIds || collectGroupIds(document.elements);
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const candidate = `group-${String(this.idFactory())}`;
            if (!existingIds.has(candidate)) {
                return candidate;
            }
        }
        throw new Error('Не удалось создать уникальный идентификатор группы.');
    }
}
