import type { AppearanceSettings, DisplayInfo, PanelLayout } from "@/types";

export const cornerRadii = { square: 2, compact: 8, standard: 14, rounded: 22 };

/** Desktop spans the virtual screen, including the taskbar. Place notices in a
 * real monitor's usable area, rather than at the bottom of that virtual screen. */
export function desktopNoticePosition(displays: DisplayInfo[], viewport: { width: number; height: number }) {
  const display = displays.find(item => item.isPrimary) ?? displays[0];
  const area = display?.workArea ?? display ?? { x: 0, y: 0, width: viewport.width, height: Math.max(1, viewport.height - 64) };
  const left = Math.max(0, area.x), top = Math.max(0, area.y);
  const right = Math.max(left + 1, Math.min(viewport.width, area.x + area.width));
  const bottom = Math.max(top + 1, Math.min(viewport.height, area.y + area.height));
  return { left: (left + right) / 2, bottom: Math.max(0, viewport.height - bottom) + 16,
    maxWidth: Math.max(1, Math.min(640, right - left - 32)), maxHeight: Math.max(1, bottom - top - 32) };
}

export function settingsPosition(layout: Pick<PanelLayout, 'x' | 'y' | 'width'>, viewport: {width:number;height:number}, workArea?: {x:number;y:number;width:number;height:number}) {
  const area=workArea ?? {x:0,y:0,...viewport}, margin=12;
  const minX=Math.max(0,area.x)+margin, minY=Math.max(0,area.y)+margin;
  const maxX=Math.min(viewport.width,area.x+area.width)-margin, maxY=Math.min(viewport.height,area.y+area.height)-margin;
  const width=Math.min(360,Math.max(1,maxX-minX));
  const maxHeight=Math.max(1,maxY-minY), height=Math.min(580,maxHeight);
  const right=layout.x+layout.width+10;
  const left=right+width<=maxX ? right : layout.x-width-10;
  const top=Math.max(minY,Math.min(layout.y,maxY-height));
  return {left:Math.max(minX,Math.min(left,maxX-width)),top,width,maxHeight:Math.min(maxHeight,Math.max(1,maxY-top))};
}
export function surfaceAppearance(layout: PanelLayout, global: AppearanceSettings) {
  return { ...global, ...layout.appearance };
}
/** Style variables belong to the surface, never the shared document root. */
export function surfaceVariables(layout: PanelLayout, global: AppearanceSettings): Record<string, string> {
  const appearance = surfaceAppearance(layout, global);
  const style: Record<string, string> = {
    '--panel-opacity': String(appearance.panelOpacity),
    '--panel-radius': `${cornerRadii[appearance.cornerStyle]}px`,
    '--item-icon-size': `${layout.iconSize ?? (layout.density === 'compact' ? 32 : 42)}px`,
    '--item-gap': `${layout.itemGap ?? (layout.density === 'compact' ? 2 : 8)}px`,
    '--item-label-lines': String(layout.labelLines ?? 2),
    '--item-padding': layout.density === 'compact' ? '5px' : '10px',
  };
  const color = appearance.backgroundColor;
  if (color && /^#[0-9a-f]{6}$/i.test(color)) {
    const channels = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));
    const light = channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0) > 150;
    style['--nestra-surface-rgb'] = channels.join(',');
    style['--nestra-text'] = light ? '#172337' : '#eff4fc';
    style['--nestra-text-secondary'] = light ? '#4c5c72' : '#c0cada';
    style['--nestra-text-faint'] = light ? '#63758c' : '#9caac0';
    style['--nestra-line'] = light ? '#17233726' : '#ffffff26';
    style['--nestra-line-strong'] = light ? '#1723374d' : '#ffffff4d';
  }
  return style;
}
