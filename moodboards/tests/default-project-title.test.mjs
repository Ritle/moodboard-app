import assert from 'node:assert/strict';

import { buildDefaultMoodboardTitle } from '../assets/js/moodboards/moodboards-list-controller.js';

assert.equal(buildDefaultMoodboardTitle(0), 'Новый проект 1');
assert.equal(buildDefaultMoodboardTitle(5), 'Новый проект 6');
assert.equal(buildDefaultMoodboardTitle(39), 'Новый проект 40');
assert.equal(buildDefaultMoodboardTitle(-1), 'Новый проект 1');

console.log('default project title: PASS');
