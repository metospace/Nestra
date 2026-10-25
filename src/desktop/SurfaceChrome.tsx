import type { CSSProperties, ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { surfaceVariables } from '@/domain/presentation';
import { startResize, type ResizeDirection } from '@/composables/useSurfaceDrag';
import type { AppearanceSettings, PanelLayout } from '@/types';

export function surfaceStyle(layout: PanelLayout, appearance: AppearanceSettings): CSSProperties {
  return { ...surfaceVariables(layout, appearance), left: layout.x, top: layout.y, width: layout.width, height: layout.height, zIndex: layout.zIndex };
}
export function IconButton({ children, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="icon" className="surface-icon-button size-7 shrink-0" onPointerDown={event => event.stopPropagation()} {...props}>{children}</Button>;
}
const handles: { direction: ResizeDirection; className: string }[] = [
  { direction: 'n', className: 'left-2 right-2 top-0 h-1.5 cursor-n-resize' },
  { direction: 's', className: 'left-2 right-2 bottom-0 h-1.5 cursor-s-resize' },
  { direction: 'w', className: 'top-2 bottom-2 left-0 w-1.5 cursor-w-resize' },
  { direction: 'e', className: 'top-2 bottom-2 right-0 w-1.5 cursor-e-resize' },
  { direction: 'nw', className: 'left-0 top-0 h-3 w-3 cursor-nw-resize' },
  { direction: 'ne', className: 'right-0 top-0 h-3 w-3 cursor-ne-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 h-3 w-3 cursor-sw-resize' },
  { direction: 'se', className: 'bottom-0 right-0 h-3 w-3 cursor-se-resize' },
];
export function ResizeHandles({ layout, commit, onStart, minWidth = 264, minHeight = 176 }: { layout: PanelLayout; commit: (layout: Partial<PanelLayout>) => void; onStart: () => void; minWidth?: number; minHeight?: number }) {
  if (layout.locked) return null;
  return handles.map(handle => <div key={handle.direction} data-resize-direction={handle.direction} className={`resize-handle absolute ${handle.className}`} onPointerDown={event => {
    event.stopPropagation(); onStart(); startResize(event as unknown as PointerEvent, handle.direction, layout, { minWidth, minHeight, commit });
  }} />);
}
