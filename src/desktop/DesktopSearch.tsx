import { GripVertical, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startMove } from '@/composables/useSurfaceDrag';
import { requestOpenSearch } from '@/lib/tauri';
import { bringToFront, DESKTOP_SEARCH_KEY, showStatus, updateLayout, useNestra } from '@/stores/state';
import { surfaceStyle } from './SurfaceChrome';

export default function DesktopSearch() {
  const state = useNestra(), layout = state.panelLayouts[DESKTOP_SEARCH_KEY];
  if (!layout || layout.visible === false) return null;
  return <section className="desktop-search nestra-hit" aria-label="桌面搜索组件" style={surfaceStyle(layout, state.appearance)}>
    <Button variant="ghost" size="icon" className="search-grip h-full w-6 rounded-none" aria-label="拖动搜索组件" onPointerDown={event => {
      bringToFront(DESKTOP_SEARCH_KEY); startMove(event as unknown as PointerEvent, layout, { minWidth: 220, minHeight: 46, commit: value => updateLayout(DESKTOP_SEARCH_KEY, value) });
    }}><GripVertical size={14} /></Button>
    <Button variant="ghost" className="search-entry h-full flex-1 justify-start rounded-none" title="Ctrl+Alt+F" onClick={() => { void requestOpenSearch().catch(() => showStatus('暂时无法打开搜索，请重试')); }}><Search size={17} /><span>搜索文件和应用</span></Button>
  </section>;
}
