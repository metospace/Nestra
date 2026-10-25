import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/composables/useItemDrag.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('useItemDrag.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['itemDropTarget', 'finishItemDrop', 'commitItemDrop']);
const code = ts.transpile(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(ast).replace(/^export /, '')).join('\n'), { target: ts.ScriptTarget.ES2022 });
function setup() {
  const actions = [];
  const c = vm.createContext({
    placeItem: async (...args) => actions.push(['place', ...args]),
    moveEntryToDesktop: async id => actions.push(['desktop', id]),
    moveItem: async id => `${id}:moved`,
    foldItem: (...args) => actions.push(['fold', ...args]),
    unfoldItem: (...args) => actions.push(['unfold', ...args]),
  });
  vm.runInContext(code, c);
  const entry = { id: 'old-path-id', name: 'test.txt', zone: 'zone-a' };
  function hit(group, beforeId = null, fold = false, desktop = false) {
    return { closest: selector => selector === '[data-group-id]' ? group : selector === '[data-item-id]' && beforeId ? { dataset: { itemId: beforeId } } : selector === '[data-fold-target]' && fold ? {} : null,
      hasAttribute: key => desktop && key === 'data-desktop-background' };
  }
  return { c, actions, entry, hit };
}

test('readonly targets never dispatch real file moves', async () => {
  const t = setup(), target = t.c.itemDropTarget(t.hit({ dataset: { groupId: 'category', dropMode: 'blocked' } }), t.entry);
  assert.equal(target.kind, 'blocked'); await t.c.commitItemDrop([t.entry.id], target); assert.deepEqual(t.actions, []);
});
test('cross-zone drops preserve insertion position and await the file move', async () => {
  const t = setup(), target = t.c.itemDropTarget(t.hit({ dataset: { groupId: 'zone-b', dropMode: 'move' } }, 'before-id'), t.entry);
  await t.c.commitItemDrop([t.entry.id], target);
  assert.deepEqual(t.actions, [['place', 'old-path-id', 'zone-b', 'before-id'], ['unfold', 'zone:zone-b', 'old-path-id']]);
});
test('only the desktop background inside the viewport accepts file returns', async () => {
  const t = setup();
  for (const hit of [null, t.hit(null), t.hit(null, null, false, true)]) {
    const target = t.c.itemDropTarget(hit, t.entry, false); await t.c.commitItemDrop([t.entry.id], target);
  }
  assert.deepEqual(t.actions, []);
  await t.c.commitItemDrop([t.entry.id], t.c.itemDropTarget(t.hit(null, null, false, true), t.entry));
  assert.deepEqual(t.actions, [['desktop', 'old-path-id']]);
});
test('launcher targets keep reference semantics and cannot return unzoned files', async () => {
  const t = setup(), target = t.c.itemDropTarget(t.hit({ dataset: { groupId: 'launcher', dropMode: 'reference' } }), t.entry);
  assert.equal(target.kind, 'reference'); await t.c.commitItemDrop([t.entry.id], target);
  assert.deepEqual(t.actions, [['place', 'old-path-id', 'launcher', null]]);
  assert.equal(t.c.itemDropTarget(t.hit(null, null, false, true), { ...t.entry, zone: null }).kind, 'blocked');
});
test('folding across zones uses the new path identity for every selected item', async () => {
  const t = setup(), target = t.c.itemDropTarget(t.hit({ dataset: { groupId: 'zone-b', dropMode: 'move' } }, null, true), t.entry);
  await t.c.commitItemDrop(['one', 'two'], target);
  assert.deepEqual(t.actions, [['fold', 'zone:zone-b', 'one:moved'], ['fold', 'zone:zone-b', 'two:moved']]);
});
test('a selected drop anchor is a no-op and does not reorder other selected files', async () => {
  const t = setup(), target = t.c.itemDropTarget(t.hit({ dataset: { groupId: 'zone-b', dropMode: 'move' } }, 'two'), t.entry);
  await t.c.commitItemDrop(['one', 'two'], target); assert.deepEqual(t.actions, []);
});
test('multi-file commit stops after a native error instead of continuing partial operations', async () => {
  const t = setup(); t.c.placeItem = async id => { t.actions.push(id); throw Error('denied'); };
  await assert.rejects(t.c.commitItemDrop(['one', 'two'], { groupId: 'zone-b', kind: 'move', beforeId: null, fold: false }), /denied/);
  assert.deepEqual(t.actions, ['one']);
});
