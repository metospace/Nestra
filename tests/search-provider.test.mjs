import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/search.ts", import.meta.url), "utf8");
const code = ts.transpile(source.replace(/^import .*$/gm, "").replace(/^export /gm, ""), { target: ts.ScriptTarget.ES2022 });
const context = vm.createContext({});
vm.runInContext(code, context);
const entry = (path, name = path) => ({ id: `file:${path}`, path, name });
const sources = (overrides = {}) => ({
  local: [entry("C:\\Desktop\\报告.pdf")], mappedPaths: [],
  everything: async () => ({ available: true, message: "Everything", total: 1, entries: [entry("E:\\资料\\报告.pdf")] }),
  mapped: async () => [], ...overrides,
});

test('exact names and prefixes outrank path matches; recent opens only break ties',()=>{
 const rows=[entry('D:/报告/notes.txt','notes.txt'),entry('D:/older.pdf','报告旧版.pdf'),entry('D:/exact.pdf','报告.pdf')];const sorted=context.rankSearch(rows,'报告',['D:/报告/notes.txt']);assert.deepEqual(Array.from(sorted,r=>r.name),['报告.pdf','报告旧版.pdf','notes.txt']);
 assert.equal(context.rankSearch(rows,'',['D:/older.pdf'])[0].path,'D:/older.pdf');
});
test('search loads beyond the previous 96-result cap while retaining explicit provider bounds',async()=>{
 let requested;const result=await context.runSearch('','all',sources({local:Array.from({length:140},(_,i)=>entry(`C:/file${i}.txt`)),everything:async(q,limit)=>{requested=limit;return{available:true,message:'Everything',total:400,entries:Array.from({length:200},(_,i)=>entry(`D:/file${i}.txt`))}}}));assert.equal(requested,200);assert.equal(result.entries.length,340);assert.match(result.message,/加载前 200 项/);
});

test("all scope queries the index even for a single Chinese character and keeps local results", async () => {
  let query;
  const result = await context.runSearch("报", "all", sources({ everything: async (text) => {
    query = text; return { available: true, message: "Everything", total: 1, entries: [entry("E:\\资料\\报告.pdf")] };
  } }));
  assert.equal(query, "报");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[1].path, "E:\\资料\\报告.pdf");
});

test("Everything-only scope never presents desktop fallback as index results", async () => {
  const result = await context.runSearch("报告", "everything", sources({ everything: async () => {
    throw new Error("IPC unavailable");
  } }));
  assert.equal(result.entries.length, 0);
  assert.match(result.message, /请启动 Everything/);
});

test("unavailable index leaves recursive mapped search usable with explicit limited scope", async () => {
  const result = await context.runSearch("报告", "all", sources({
    mappedPaths: ["E:\\资料"], mapped: async () => [entry("E:\\资料\\报告.pdf")],
    everything: async () => ({ available: false, message: "Everything 未运行", total: 0, entries: [] }),
  }));
  assert.equal(result.entries.length, 2);
  assert.match(result.message, /搜索桌面、收纳区、映射文件夹和已安装应用/);
});

test("local scopes do not request the disk index", async () => {
  const result = await context.runSearch("报告", "desktop", sources({ everything: async () => assert.fail("unexpected index query") }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.message, "桌面项目");
});

test("deduplication ignores Windows path casing and preserves authoritative desktop metadata", async () => {
  const result = await context.runSearch("报告", "all", sources({
    everything: async () => ({ available: true, message: "Everything", total: 1, entries: [entry("c:\\desktop\\报告.pdf", "indexed")] }),
  }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, "C:\\Desktop\\报告.pdf");
});

test("mapped query failure is visible while indexed results remain available and bounded", async () => {
  const result = await context.runSearch("报告", "all", sources({
    mappedPaths: ["E:\\资料"], mapped: async () => { throw new Error("offline"); },
    everything: async () => ({ available: true, message: "Everything", total: 500, entries: Array.from({ length: 80 }, (_, i) => entry(`E:\\${i}.pdf`)) }),
  }));
  assert.equal(result.entries.length, 81);
  assert.match(result.message, /匹配 500 项/);
  assert.match(result.message, /映射目录查询失败/);
});

test("local results arrive before a slow global index reply",async()=>{
 let release,partial;const wait=new Promise(resolve=>release=resolve);
 const pending=context.runSearch("报告","all",sources({everything:()=>wait}),result=>partial=result);
 assert.equal(partial.entries[0].path,"C:\\Desktop\\报告.pdf");
 release({available:true,message:"Everything",total:1,entries:[entry("E:\\报告.pdf")]});
 assert.equal((await pending).entries.length,2);
});
