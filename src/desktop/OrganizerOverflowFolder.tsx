import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useOrganizerLayout } from '@/composables/useOrganizerLayout';
import { surfaceVariables } from '@/domain/presentation';
import { displayAtPoint } from '@/lib/layout';
import { useNestra } from '@/stores/state';
import type { DesktopEntry, DisplayInfo, PanelLayout } from '@/types';
import ItemTile from './ItemTile';
import OrganizerPages from './OrganizerPages';

/** View-only folder: shares tiles, native input, drag behavior and pagination.
 * It must never create a directory or issue a file move merely by opening. */
export default function OrganizerOverflowFolder({ layout, entries, panelKey, title, onClose }: { layout: PanelLayout; entries: DesktopEntry[]; panelKey: string; title: string; onClose: () => void }) {
  const state = useNestra();
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const display = state.displays.length ? displayAtPoint(layout.x + layout.width / 2, layout.y + layout.height / 2, state.displays) : { id: 'viewport', name: '', x: 0, y: 0, ...viewport, isPrimary: true };
  const area = display.workArea ?? display;
  const width = Math.min(600, Math.max(1, area.width - 24)), height = Math.min(500, Math.max(1, area.height - 24));
  const folderLayout = { ...layout, x: area.x + 12, y: area.y + 12, width, height, autoSize: false, overflowMode: 'pages' as const };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="nestra-hit overflow-hidden gap-0 p-0" style={{ left: area.x + area.width / 2, top: area.y + area.height / 2, width, maxWidth: width, maxHeight: area.height - 24 }}>
      <FolderContents layout={folderLayout} entries={entries} panelKey={panelKey} title={title} display={{ ...display, ...area }}/>
    </DialogContent>
  </Dialog>;
}

function FolderContents({ layout, entries, panelKey, title, display }: { layout: PanelLayout; entries: DesktopEntry[]; panelKey: string; title: string; display: DisplayInfo }) {
  const state = useNestra(), [page, setPage] = useState(0);
  const { rootRef, contentRef, fit } = useOrganizerLayout(layout, entries.length, [display]);
  const size = fit?.pageSize ?? 1, pageCount = Math.max(1, Math.ceil(entries.length / size)), current = Math.min(page, pageCount - 1);
  useEffect(() => setPage(0), [size]);
  if (!fit) return null;
  return <section ref={rootRef} className="organizer-auto-layout flex flex-col overflow-hidden" data-overflow-folder style={{ ...surfaceVariables(layout, state.appearance), height: fit.layout.height }}>
    <DialogHeader className="shrink-0 p-4 pr-12"><DialogTitle>{title} · 更多项目</DialogTitle><DialogDescription>{entries.length} 项，仅在此折叠显示，文件位置不变。</DialogDescription></DialogHeader>
    <div ref={contentRef} className="organizer-content min-h-0 flex-1 overflow-hidden p-2">
      <div className={`surface-item-grid ${layout.viewMode === 'list' ? 'is-list' : ''}`} style={{ gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`, gridAutoRows: `${fit.tileHeight}px` }}>
        {entries.slice(current * size, (current + 1) * size).map(entry => <ItemTile key={entry.id} entry={entry} folded={state.foldedItems[panelKey]?.includes(entry.id)} panelKey={panelKey} list={layout.viewMode === 'list'} selectionOrder={entries.map(item => item.id)}/>)}
      </div>
    </div>
    <OrganizerPages title="更多项目" page={current} pageCount={pageCount} count={entries.length} onChange={setPage}/>
  </section>;
}
