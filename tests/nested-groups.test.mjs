import assert from 'node:assert/strict';

import {
    createMoodboardDocument,
    validateMoodboardDocument,
} from '../assets/js/models/moodboard-document.js';
import { CommandManager } from '../assets/js/editor/command-manager.js';
import {
    EDITOR_COMMANDS,
    EditorCommandRegistry,
} from '../assets/js/editor/editor-command-registry.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';
import {
    canGroupElements,
    createGroupPatches,
    createUngroupPatches,
    getElementGroupPath,
} from '../assets/js/editor/group-utils.js';

function shape(id, groupPath = [], groupNames = {}) {
    const element = {
        id,
        type: 'shape',
        shapeType: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
        fill: '#8094b1',
        stroke: '#707070',
        strokeWidth: 1,
        opacity: 1,
    };
    if (groupPath.length > 0) {
        element.groupId = groupPath[0];
        element.groupPath = [...groupPath];
        element.groupNames = Object.fromEntries(
            groupPath.filter((groupId) => groupNames[groupId]).map((groupId) => [groupId, groupNames[groupId]]),
        );
        if (groupNames[groupPath[0]]) {
            element.groupName = groupNames[groupPath[0]];
        }
    }
    return element;
}

const outerNames = { outer: 'Внешняя группа', inner: 'Внутренняя группа' };
const nestedElements = [
    shape('a', ['outer', 'inner'], outerNames),
    shape('b', ['outer', 'inner'], outerNames),
    shape('c', ['outer'], outerNames),
    shape('d', ['outer'], outerNames),
];

assert.equal(canGroupElements(nestedElements, ['a', 'c']), false, 'Нельзя разрывать вложенную группу.');
assert.equal(canGroupElements(nestedElements, ['a', 'b', 'c']), true);
const groupPatches = createGroupPatches(
    nestedElements,
    ['a', 'b', 'c'],
    'middle',
    'Средняя группа',
);
assert.deepEqual(getElementGroupPath(groupPatches.get('a')), ['outer', 'middle', 'inner']);
assert.deepEqual(getElementGroupPath(groupPatches.get('b')), ['outer', 'middle', 'inner']);
assert.deepEqual(getElementGroupPath(groupPatches.get('c')), ['outer', 'middle']);

const groupedElements = nestedElements.map((element) => ({
    ...element,
    ...(groupPatches.get(element.id) || {}),
}));
const innerUngroupPatches = createUngroupPatches(groupedElements, ['a', 'b']);
assert.deepEqual(getElementGroupPath(innerUngroupPatches.get('a')), ['outer', 'middle']);
assert.deepEqual(getElementGroupPath(innerUngroupPatches.get('b')), ['outer', 'middle']);
assert.equal(innerUngroupPatches.has('c'), false);

const nestedDocument = createMoodboardDocument({ elements: groupedElements });
assert.equal(validateMoodboardDocument(nestedDocument), true);
const invalidDocument = structuredClone(nestedDocument);
invalidDocument.pages[0].elements[0].groupId = 'wrong-root';
assert.throws(
    () => validateMoodboardDocument(invalidDocument),
    /groupId должен совпадать с первой группой в groupPath/,
);

const store = new EditorStore();
store.loadMoodboard({
    id: 'nested-board',
    title: 'Вложенные группы',
    revision: 0,
    document: createMoodboardDocument({
        elements: [shape('one'), shape('two'), shape('three')],
    }),
});
const commandManager = new CommandManager(store);
const registry = new EditorCommandRegistry({
    store,
    commandManager,
    idFactory: () => 'generated',
});
store.setSelections(['one', 'two']);
assert.equal(registry.execute(EDITOR_COMMANDS.GROUP), true);
assert.deepEqual(getElementGroupPath(store.getElement('one')), ['group-generated']);
assert.deepEqual(getElementGroupPath(store.getElement('two')), ['group-generated']);
assert.equal(commandManager.undo(), true);
assert.deepEqual(getElementGroupPath(store.getElement('one')), []);
assert.equal(commandManager.redo(), true);
assert.deepEqual(getElementGroupPath(store.getElement('two')), ['group-generated']);
commandManager.destroy();

console.log('nested groups: PASS');
