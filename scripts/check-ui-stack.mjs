import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function sourceFiles(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(join(dir,entry.name)):[join(dir,entry.name)]); }
export function checkUiStack() {
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const allowed=new Set(['react','react-dom','zustand','lucide-react','motion','radix-ui','@radix-ui/react-compose-refs','@dnd-kit/core','react-resizable-panels','class-variance-authority','clsx','tailwind-merge','@tauri-apps/api','@tauri-apps/plugin-global-shortcut','@tauri-apps/plugin-opener']);
  const errors=[];
  for(const name of Object.keys(pkg.dependencies)) if(!allowed.has(name)) errors.push(`Unreviewed runtime dependency: ${name}. Update docs/UI_STACK.md and this allowlist deliberately.`);
  for(const file of sourceFiles(join(root,'src'))) {
    if(file.endsWith('.vue')) errors.push(`Legacy framework file: ${file}`);
    if(!/\.(?:tsx?|css)$/.test(file))continue;
    const text=readFileSync(file,'utf8');
    for(const match of text.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
      const specifier=match[1];
      if(specifier.startsWith('.')||specifier.startsWith('@/'))continue;
      const dependency=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
      if(!allowed.has(dependency))errors.push(`Unreviewed runtime import ${specifier} in ${file}`);
    }
    if(/(?:from\s*|import\s*)['"](?:vue|@nuxt\/ui|@iconify|motion-v|framer-motion|reka-ui)(?:\/|['"])/.test(text)) errors.push(`Competing UI dependency in ${file}`);
    if(/from ['"]radix-ui['"]/.test(text)&&!file.includes(`${join('components','ui')}`)) errors.push(`Import source-owned shadcn components instead of Radix directly: ${file}`);
    if(/import\s*\*\s+as\s+\w+\s+from\s*['"]lucide-react['"]/.test(text)) errors.push(`Use static named Lucide imports: ${file}`);
  }
  return errors;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const errors=checkUiStack();
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('UI stack: one framework, one component system, approved dependencies only.');
}
