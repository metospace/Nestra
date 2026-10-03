import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/refreshQueue.ts", import.meta.url), "utf8");
const context = vm.createContext({ setTimeout });
vm.runInContext(ts.transpile(source.replace("export function", "function"), { target: ts.ScriptTarget.ES2022 }), context);
const { createRefreshQueue } = context;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test("refresh requested during a drag waits before scanning", async () => {
  let blocked = true, scans = 0;
  const gate = deferred(), results = [];
  const refresh = createRefreshQueue(async () => ++scans, x => results.push(x), () => blocked, () => gate.promise);
  const done = refresh();
  assert.equal(scans, 0);
  blocked = false; gate.resolve(); await done;
  assert.deepEqual(results, [1]);
});

test("drag starting during IPC prevents replacement until release", async () => {
  let blocked = false;
  const scan = deferred(), gate = deferred(), results = [];
  const refresh = createRefreshQueue(() => scan.promise, x => results.push(x), () => blocked, () => gate.promise);
  const done = refresh(); blocked = true; scan.resolve("new snapshot");
  await tick(); assert.deepEqual(results, []);
  blocked = false; gate.resolve(); await done;
  assert.deepEqual(results, ["new snapshot"]);
});

test("overlapping file notifications serialize and discard the superseded snapshot", async () => {
  const first = deferred(), second = deferred(), results = [];
  let calls = 0;
  const refresh = createRefreshQueue(() => (++calls === 1 ? first.promise : second.promise), x => results.push(x), () => false);
  const done = refresh(); const again = refresh(); refresh();
  assert.equal(calls, 1);
  first.resolve("old"); await tick();
  assert.equal(calls, 2); assert.deepEqual(results, []);
  second.resolve("latest"); await Promise.all([done, again]);
  assert.deepEqual(results, ["latest"]);
});

test("failed scan retains the current model and permits a later retry", async () => {
  let fail = true; const results = ["current"];
  const refresh = createRefreshQueue(async () => { if (fail) throw new Error("scan failed"); return "recovered"; }, x => results.push(x), () => false);
  await assert.rejects(refresh(), /scan failed/);
  assert.deepEqual(results, ["current"]);
  fail = false; await refresh();
  assert.deepEqual(results, ["current", "recovered"]);
});
