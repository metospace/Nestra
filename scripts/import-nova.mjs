// Source-owned shadcn/ui Nova components. Run intentionally when upgrading the registry.
import { mkdir, writeFile } from 'node:fs/promises';
const names = ['button','input','textarea','select','dialog','alert-dialog','dropdown-menu','context-menu','popover','tabs','switch','slider','checkbox','tooltip','table','badge','card','label','separator','scroll-area','resizable','progress','collapsible'];
await mkdir('src/components/ui', {recursive:true});
for (const name of names) {
  const url = `https://ui.shadcn.com/r/styles/radix-nova/${name}.json`;
  const response = await fetch(url);
  if (!response.ok) throw Error(`${name}: ${response.status}`);
  const item = await response.json();
  for (const file of item.files ?? []) {
    let source = file.content.replaceAll('from "cn"', 'from "@/lib/utils"').replace(/@\/registry\/[^/]+\/ui\//g, '@/components/ui/').replace(/@\/registry\/[^/]+\/lib\/utils/g, '@/lib/utils');
    // Desktop WebViews are clipped to native hit regions. Portal content must participate.
    source = source.replace(/(data-slot="(?:dialog-overlay|dialog-content|alert-dialog-overlay|alert-dialog-content|select-content|popover-content|dropdown-menu-content|dropdown-menu-sub-content|context-menu-content|context-menu-sub-content|tooltip-content)"[\s\S]*?className=\{cn\(\s*)"/g, '$1"nestra-hit ');
    source = source.replaceAll('z-50', 'z-[9700]');
    source = source.replace(/data-slot="(button|checkbox|switch|tabs-trigger|select-trigger|slider-thumb|dialog-content|alert-dialog-content|popover-content|dropdown-menu-content|dropdown-menu-sub-content|context-menu-content|context-menu-sub-content)"/g, 'data-slot="$1" data-desktop-input');
    source = source.replace(/data-slot="(select-content|select-item|dropdown-menu-item|dropdown-menu-checkbox-item|dropdown-menu-radio-item|dropdown-menu-sub-trigger|context-menu-item|context-menu-checkbox-item|context-menu-radio-item|context-menu-sub-trigger)"/g, 'data-slot="$1" data-desktop-input');
    source = source.replaceAll('<span className="sr-only">Close</span>', '<span className="sr-only">关闭</span>');
    // The registry consumes value for its indicator; Radix also needs it for ARIA.
    if (name === 'progress' && !/<ProgressPrimitive\.Root[\s\S]*?value=\{value\}/.test(source)) {
      source = source.replace('data-slot="progress"', 'data-slot="progress"\n      value={value}');
    }
    if (['dropdown-menu','context-menu','popover','select'].includes(name)) {
      source = `import { useDesktopPopupBoundary } from "@/components/ui/desktop-portal-plane"\n${source}`;
      const primitive = {'dropdown-menu':'DropdownMenu','context-menu':'ContextMenu',popover:'Popover',select:'Select'}[name];
      const start = source.indexOf(`function ${primitive}Content(`);
      const end = source.indexOf('\nfunction ', start + 1);
      let block = source.slice(start, end);
      block = block.replace('  ...props', '  ref,\n  ...props');
      block = block.replace('  return (', '  const boundary = useDesktopPopupBoundary(ref)\n  return (<>');
      block = block.replace(`<${primitive}Primitive.Content`, `<${primitive}Primitive.Content ref={boundary.ref}`);
      block = block.replace(`</${primitive}Primitive.Portal>`, `</${primitive}Primitive.Portal>\n    {boundary.plane}</>`);
      source = source.slice(0,start) + block + source.slice(end);
    }
    // Controlled dialogs have no Trigger ref. Compose Radix's lifecycle callbacks
    // to restore the element that opened them while retaining library focus traps.
    if (['dialog','alert-dialog'].includes(name)) {
      source = `import { useDialogFocus } from "@/components/ui/dialog-focus"\n${source}`;
      const primitive = name === 'dialog' ? 'Dialog' : 'AlertDialog';
      const start = source.indexOf(`function ${primitive}Content(`);
      const end = source.indexOf('\nfunction ', start + 1);
      if (start < 0 || end < 0) throw Error(`Cannot adapt ${name} focus callbacks`);
      let block = source.slice(start, end);
      block = block.replace('  ...props', '  onOpenAutoFocus,\n  onCloseAutoFocus,\n  ...props');
      block = block.replace('  return (', '  const focus = useDialogFocus({ onOpenAutoFocus, onCloseAutoFocus })\n  return (');
      block = block.replace('        {...props}', '        {...props}\n        onOpenAutoFocus={focus.onOpenAutoFocus}\n        onCloseAutoFocus={focus.onCloseAutoFocus}');
      source = source.slice(0, start) + block + source.slice(end);
    }
    // Registry shorthand is emitted for the create app; use standard Radix attributes in Vite.
    for (const state of ['active','open','closed','checked','unchecked']) source = source.replaceAll(`data-${state}:`, `data-[state=${state}]:`);
    for (const orientation of ['horizontal','vertical']) source = source.replaceAll(`data-${orientation}`, `data-[orientation=${orientation}]`);
    // Motion is the only animation library; registry enter/exit utility names are inert without tw-animate-css.
    source = source.replace(/[^\s"]*(?:animate-in|animate-out|fade-in-0|fade-out-0|zoom-in-95|zoom-out-95|slide-in-from-(?:left|right|top|bottom)-2)[^\s"]*/g, '');
    const icons = new Set();
    source = source.replace(/<IconPlaceholder\s+([\s\S]*?)\/>/g, (_, attributes) => {
      const icon = attributes.match(/lucide="([^"]+)"/)?.[1];
      if (!icon) throw Error(`Missing Lucide icon in ${name}`);
      icons.add(icon);
      const remaining = attributes.replace(/(?:lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"/g, '').trim();
      return `<${icon} ${remaining} />`;
    });
    source = source.replace('import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"', `import { ${[...icons].join(', ')} } from "lucide-react"`);
    const target = `src/components/ui/${file.path.split('/').at(-1)}`;
    await writeFile(target, `// Source: ${url} (MIT). Native hit-region adaptations documented in docs/UI_STACK.md.\n${source}`, 'utf8');
  }
  console.log(`${name}: ${(item.dependencies ?? []).join(', ')}`);
}
