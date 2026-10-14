import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    CanvasAdapter,
    resolveInitialStageSize,
} from '../assets/js/editor/canvas-adapter.js';

const workspace = {
    clientWidth: 1440,
    clientHeight: 860,
    parentElement: null,
    getBoundingClientRect: () => ({ width: 1440, height: 860 }),
};
const hiddenShell = {
    clientWidth: 0,
    clientHeight: 0,
    parentElement: workspace,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
};
const hiddenContainer = {
    clientWidth: 0,
    clientHeight: 0,
    parentElement: hiddenShell,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
};
assert.deepEqual(resolveInitialStageSize(hiddenContainer), {
    width: 1440,
    height: 860,
});
assert.deepEqual(resolveInitialStageSize(null), { width: 1, height: 1 });

function createNode(children = []) {
    return {
        perfectDrawEnabled(value) {
            this.perfectDraw = value;
        },
        getChildren() {
            return children;
        },
    };
}

const nestedRect = createNode();
const childRect = createNode([nestedRect]);
const sceneGroup = createNode([childRect]);
const adapter = Object.create(CanvasAdapter.prototype);
adapter._disableSceneNodeBuffering(sceneGroup);
assert.equal(sceneGroup.perfectDraw, false);
assert.equal(childRect.perfectDraw, false);
assert.equal(nestedRect.perfectDraw, false);

const source = await readFile(
    new URL('../assets/js/editor/canvas-adapter.js', import.meta.url),
    'utf8',
);
assert.match(
    source,
    /const node = this\._createNode\(element\);\s*this\._disableSceneNodeBuffering\(node\);\s*this\._bindNode/,
);

console.log('Konva render buffer guard: PASS');
