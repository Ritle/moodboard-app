import assert from 'node:assert/strict';

import { getSelectionSummary } from '../assets/js/editor/ui-controller.js';

assert.equal(getSelectionSummary([
    { id: 'a', groupId: 'group-1' },
    { id: 'b', groupId: 'group-1' },
    { id: 'c', groupId: 'group-1' },
]), 'Группа из 3');

assert.equal(getSelectionSummary([
    {
        id: 'a',
        groupId: 'outer',
        groupPath: ['outer', 'inner'],
        groupNames: { outer: 'Внешняя', inner: 'Карточки' },
    },
    {
        id: 'b',
        groupId: 'outer',
        groupPath: ['outer', 'inner'],
        groupNames: { outer: 'Внешняя', inner: 'Карточки' },
    },
]), 'Карточки из 2');

assert.equal(getSelectionSummary([
    { id: 'a' },
    { id: 'b' },
]), 'Выбрано объектов: 2');

assert.equal(getSelectionSummary([
    { id: 'a', groupId: 'group-1' },
    { id: 'b', groupId: 'group-2' },
]), 'Выбрано объектов: 2');

assert.equal(getSelectionSummary([
    { id: 'a', groupId: 'group-1' },
    { id: 'b' },
]), 'Выбрано объектов: 2');

console.log('selection summary: PASS');
