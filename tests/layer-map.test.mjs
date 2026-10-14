import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateMoodboardDocument } from '../assets/js/models/moodboard-document.js';

import {
    buildLayerHierarchy,
    collectLayerNodeElementIds,
    filterLayerHierarchy,
    getLayerMapStats,
    getLayerLabel,
    reorderLayerElements,
    resolveLayerMapSelection,
} from '../assets/js/editor/layer-map-utils.js';

const tree = buildLayerHierarchy([
    { id: 'frame', type: 'frame', name: 'Композиция' },
    { id: 'image', type: 'image', frameId: 'frame', fileName: 'Фото интерьера.jpg' },
    { id: 'text-1', type: 'text', frameId: 'frame', groupId: 'group-1', groupName: 'Текстовый блок', text: 'Заголовок' },
    { id: 'text-2', type: 'text', frameId: 'frame', groupId: 'group-1', groupName: 'Текстовый блок', text: 'Описание' },
    { id: 'shape', type: 'shape', shapeType: 'circle', hyperlink: 'https://example.com/circle', locked: true },
]);

assert.deepEqual(tree.map(({ id }) => id), ['shape', 'frame']);
assert.equal(tree[0].label, 'Круг');
assert.equal(tree[1].label, 'Композиция');
assert.deepEqual(tree[1].children.map(({ kind }) => kind), ['group', 'element']);
assert.equal(tree[1].children[0].label, 'Текстовый блок');
assert.deepEqual(tree[1].children[0].elementIds, ['text-2', 'text-1']);
assert.deepEqual(collectLayerNodeElementIds(tree[1]), ['frame', 'text-2', 'text-1', 'image']);
const nestedTree = buildLayerHierarchy([
    {
        id: 'nested-a',
        type: 'shape',
        groupId: 'outer',
        groupPath: ['outer', 'inner'],
        groupNames: { outer: 'Внешняя', inner: 'Внутренняя' },
    },
    {
        id: 'nested-b',
        type: 'text',
        text: 'Текст',
        groupId: 'outer',
        groupPath: ['outer', 'inner'],
        groupNames: { outer: 'Внешняя', inner: 'Внутренняя' },
    },
    {
        id: 'nested-c',
        type: 'shape',
        groupId: 'outer',
        groupPath: ['outer'],
        groupNames: { outer: 'Внешняя' },
    },
]);
assert.equal(nestedTree[0].label, 'Внешняя');
assert.equal(nestedTree[0].children[0].label, 'Фигура');
assert.equal(nestedTree[0].children[1].label, 'Внутренняя');
assert.deepEqual(nestedTree[0].children[1].elementIds, ['nested-b', 'nested-a']);
assert.deepEqual(
    nestedTree[0].children[1].children.map(({ id }) => id),
    ['nested-b', 'nested-a'],
);
assert.equal(getLayerLabel({ type: 'text', text: '   ' }), 'Текст');
assert.deepEqual(resolveLayerMapSelection(['one'], ['two'], false), ['two']);
assert.deepEqual(resolveLayerMapSelection(['one'], ['two', 'three'], true), ['one', 'two', 'three']);
assert.deepEqual(resolveLayerMapSelection(['one', 'two', 'three'], ['two', 'three'], true), ['one']);

const filterElements = [
    { id: 'frame-filter', type: 'frame', name: 'Кухня' },
    { id: 'image-filter', type: 'image', frameId: 'frame-filter', fileName: 'Латунный свет.jpg' },
    { id: 'text-filter', type: 'text', frameId: 'frame-filter', text: 'Палитра' },
    { id: 'linked-filter', type: 'shape', shapeType: 'star', hyperlink: 'https://shop.example/item' },
];
const filterTree = buildLayerHierarchy(filterElements);
const imageResults = filterLayerHierarchy(filterTree, filterElements, { type: 'image' });
assert.deepEqual(imageResults.map(({ id }) => id), ['frame-filter']);
assert.deepEqual(imageResults[0].children.map(({ id }) => id), ['image-filter']);
const nameResults = filterLayerHierarchy(filterTree, filterElements, { query: 'латунный' });
assert.deepEqual(nameResults[0].children.map(({ id }) => id), ['image-filter']);
const linkResults = filterLayerHierarchy(filterTree, filterElements, { scope: 'linked' });
assert.deepEqual(linkResults.map(({ id }) => id), ['linked-filter']);
const linkQueryResults = filterLayerHierarchy(filterTree, filterElements, { query: 'shop.example' });
assert.deepEqual(linkQueryResults.map(({ id }) => id), ['linked-filter']);
const framedResults = filterLayerHierarchy(filterTree, filterElements, { scope: 'framed' });
assert.deepEqual(framedResults.map(({ id }) => id), ['frame-filter']);
assert.deepEqual(framedResults[0].children.map(({ id }) => id), ['text-filter', 'image-filter']);
assert.deepEqual(getLayerMapStats(filterElements, ['image-filter', 'linked-filter']), {
    total: 4,
    selected: 2,
    locked: 0,
});
const namedLayerDocument = {
    schemaVersion: 2,
    pages: [{
        id: 'page-layer-names',
        name: 'Лист',
        canvas: { width: 1600, height: 1000, background: '#ffffff' },
        elements: [{
            id: 'named-text',
            type: 'text',
            text: 'Заголовок',
            name: 'Основной заголовок',
            groupId: 'group-named',
            groupName: 'Тексты',
        }],
    }],
};
assert.equal(validateMoodboardDocument(namedLayerDocument), true);
const orphanGroupNameDocument = structuredClone(namedLayerDocument);
delete orphanGroupNameDocument.pages[0].elements[0].groupId;
assert.throws(
    () => validateMoodboardDocument(orphanGroupNameDocument),
    /groupName допустим только вместе с groupId/,
);

const layers = [{ id: 'back' }, { id: 'middle' }, { id: 'front' }];
assert.deepEqual(
    reorderLayerElements(layers, ['back'], ['front'], 'before').map(({ id }) => id),
    ['middle', 'front', 'back'],
);
assert.deepEqual(
    reorderLayerElements(layers, ['front'], ['back'], 'after').map(({ id }) => id),
    ['front', 'back', 'middle'],
);
assert.equal(reorderLayerElements(layers, ['front'], ['middle'], 'before'), null);
assert.equal(reorderLayerElements(layers, ['front'], ['front'], 'after'), null);
const groupedLayers = [
    { id: 'group-back', groupId: 'group-1' },
    { id: 'outside' },
    { id: 'group-front', groupId: 'group-1' },
];
const reorderedGroup = reorderLayerElements(
    groupedLayers,
    ['group-back'],
    ['group-front'],
    'before',
    ['group-back', 'group-front'],
);
assert.deepEqual(reorderedGroup.map(({ id }) => id), ['group-front', 'outside', 'group-back']);
const reorderedGroupNode = buildLayerHierarchy(reorderedGroup)
    .find(({ kind }) => kind === 'group');
assert.deepEqual(reorderedGroupNode.children.map(({ id }) => id), ['group-back', 'group-front']);

const framedLayers = [
    { id: 'frame-2', type: 'frame' },
    { id: 'frame-back', type: 'shape', frameId: 'frame-2' },
    { id: 'outside-2', type: 'shape' },
    { id: 'frame-front', type: 'text', frameId: 'frame-2', text: 'Верхний' },
];
const reorderedFrame = reorderLayerElements(
    framedLayers,
    ['frame-back'],
    ['frame-front'],
    'before',
    ['frame-back', 'frame-front'],
);
assert.deepEqual(
    reorderedFrame.map(({ id }) => id),
    ['frame-2', 'frame-front', 'outside-2', 'frame-back'],
);
const reorderedFrameNode = buildLayerHierarchy(reorderedFrame)
    .find(({ id }) => id === 'frame-2');
assert.deepEqual(reorderedFrameNode.children.map(({ id }) => id), ['frame-back', 'frame-front']);

const controllerSource = await readFile(
    new URL('../assets/js/editor/ui-controller.js', import.meta.url),
    'utf8',
);
assert.equal(
    (controllerSource.match(/_setLayerMapOpen\(/g) || []).length,
    3,
    'Карта слоёв должна переключаться собственной кнопкой и закрываться справкой.',
);
assert.match(
    controllerSource,
    /if \(this\.helpOpen\) \{[\s\S]*?this\._setLayerMapOpen\(false\)/,
);
assert.match(controllerSource, /event\.kind === 'selection-changed'[\s\S]*?_renderLayerMap\(\)/);
assert.match(controllerSource, /const previousScrollTop = treeElement\?\.scrollTop \|\| 0/);
assert.match(controllerSource, /treeElement\.scrollTop = previousScrollTop/);
assert.match(controllerSource, /_startLayerMapRename\(/);
assert.match(controllerSource, /_toggleLayerMapNodeLock\(/);
assert.match(controllerSource, /collapsedLayerNodeIds/);
assert.match(controllerSource, /filterLayerHierarchy\(fullTree, elements, filters\)/);

const editorStyles = await readFile(new URL('../assets/css/editor.css', import.meta.url), 'utf8');
assert.match(editorStyles, /\.editor-help\s*\{[\s\S]*?right:\s*18px;/);
assert.match(editorStyles, /\.layer-map\s*\{[\s\S]*?right:\s*66px;/);
assert.match(editorStyles, /\.layer-map__filters\s*\{/);
assert.match(editorStyles, /\.layer-map__navigation-toggle\s*\{/);
assert.match(editorStyles, /\.layer-map__rename-input\s*\{/);

const editorMarkup = await readFile(new URL('../editor.php', import.meta.url), 'utf8');
assert.match(editorMarkup, /data-role="layer-map-search"/);
assert.match(editorMarkup, /data-role="layer-map-navigation" hidden/);
assert.match(editorMarkup, /data-action="toggle-layer-map-navigation"/);
assert.match(editorMarkup, /<span>Навигация по слоям<\/span>/);
assert.match(editorMarkup, /data-role="layer-map-type-filter"/);
assert.match(editorMarkup, /data-role="layer-map-scope-filter"/);
assert.match(editorMarkup, /data-role="layer-map-selected-count"/);
assert.match(editorMarkup, /data-role="layer-map-locked-count"/);
assert.match(controllerSource, /layerMapNavigationOpen = false/);
assert.match(controllerSource, /_setLayerMapNavigationOpen\(/);

console.log('layer map: PASS');
