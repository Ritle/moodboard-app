import assert from 'node:assert/strict';

import { createMoodboardDocument } from '../assets/js/models/moodboard-document.js';
import { CommandManager } from '../assets/js/editor/command-manager.js';
import {
    EDITOR_COMMANDS,
    EditorCommandRegistry,
} from '../assets/js/editor/editor-command-registry.js';
import { EditorStore } from '../assets/js/editor/editor-store.js';

function shape(id, extra = {}) {
    return {
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
        ...extra,
    };
}

function createRegistry(elements, generatedIds) {
    const store = new EditorStore();
    store.loadMoodboard({
        id: 'board',
        title: 'Порядок слоёв',
        revision: 0,
        document: createMoodboardDocument({ elements }),
    });
    const commandManager = new CommandManager(store);
    const idQueue = [...generatedIds];
    const registry = new EditorCommandRegistry({
        store,
        commandManager,
        idFactory: () => idQueue.shift(),
    });
    return { store, commandManager, registry };
}

{
    const harness = createRegistry([
        shape('back'),
        shape('middle', { x: 120 }),
        shape('front', { x: 240 }),
    ], ['middle-copy']);
    harness.store.setSelections(['middle']);
    assert.equal(harness.registry.execute(EDITOR_COMMANDS.DUPLICATE), true);
    assert.deepEqual(
        harness.store.getActivePage().elements.map(({ id }) => id),
        ['back', 'middle', 'middle-copy', 'front'],
        'Копия среднего слоя должна остаться под верхним объектом.',
    );
    assert.deepEqual(harness.store.getSelectedElementIds(), ['middle-copy']);
    assert.equal(harness.commandManager.undo(), true);
    assert.deepEqual(
        harness.store.getActivePage().elements.map(({ id }) => id),
        ['back', 'middle', 'front'],
    );
    harness.commandManager.destroy();
}

{
    const harness = createRegistry([
        shape('group-back', { groupId: 'group-source' }),
        shape('between'),
        shape('group-front', { groupId: 'group-source' }),
        shape('top'),
    ], ['group-back-copy', 'group-front-copy', 'copy-group-id']);
    harness.store.setSelections(['group-back', 'group-front']);
    assert.equal(harness.registry.execute(EDITOR_COMMANDS.DUPLICATE), true);
    const elements = harness.store.getActivePage().elements;
    assert.deepEqual(
        elements.map(({ id }) => id),
        ['group-back', 'group-back-copy', 'between', 'group-front', 'group-front-copy', 'top'],
        'Участники копии группы должны сохранять позиции относительно внешних слоёв.',
    );
    assert.equal(elements[1].groupId, elements[4].groupId);
    assert.notEqual(elements[1].groupId, 'group-source');
    harness.commandManager.destroy();
}

{
    const frame = {
        ...shape('frame'),
        type: 'frame',
        name: 'Фрейм',
    };
    const harness = createRegistry([
        frame,
        shape('frame-child', { frameId: 'frame' }),
        shape('overlay'),
    ], ['frame-copy', 'frame-child-copy']);
    harness.store.setSelections(['frame']);
    assert.equal(harness.registry.execute(EDITOR_COMMANDS.DUPLICATE), true);
    const elements = harness.store.getActivePage().elements;
    assert.deepEqual(
        elements.map(({ id }) => id),
        ['frame', 'frame-copy', 'frame-child', 'frame-child-copy', 'overlay'],
        'Копия фрейма с содержимым не должна переноситься выше внешнего overlay.',
    );
    assert.equal(elements[3].frameId, 'frame-copy');
    harness.commandManager.destroy();
}

console.log('duplicate layer order: PASS');
