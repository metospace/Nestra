import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/stores/state.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("state.ts", source, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fillMissingIcons");
const code = ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 });
function setup(resolveIconPairs, count = 1) {
  let retries = 0;
  const context = vm.createContext({
    store: { entries: Array.from({ length: count }, (_, i) => ({ path: `path-${i}`, target: "" })) },
    iconUrls: new Map(), iconFillBusy: false, resolveIconPairs,
    convertFileSrc: value => `asset:${value}`, scheduleIconFill: () => { retries++; },
  });
  vm.runInContext(code, context);
  return { context, retries: () => retries };
}

test("failed icon IPC is negatively cached and does not loop forever", async () => {
  let calls = 0;
  const t = setup(async () => { calls++; throw new Error("Unavailable"); });
  await t.context.fillMissingIcons(); await t.context.fillMissingIcons();
  assert.equal(calls, 1); assert.equal(t.retries(), 0);
  assert.equal(t.context.iconUrls.has("null:path-0"), true);
});

test("an incomplete batch response releases every placeholder into fallback rendering", async () => {
  const t = setup(async () => ({}));
  await t.context.fillMissingIcons();
  assert.equal(t.context.iconUrls.has("path-0"), false);
  assert.equal(t.context.iconUrls.has("null:path-0"), true);
});

test("large desktops resolve a bounded batch before scheduling the next batch", async () => {
  let batchSize = 0;
  const t = setup(async pairs => { batchSize = pairs.length; return Object.fromEntries(pairs.map(([path]) => [path, path + ".png"])); }, 80);
  await t.context.fillMissingIcons();
  assert.equal(batchSize, 32); assert.equal(t.retries(), 1);
  assert.equal(t.context.iconUrls.size, 32);
});
