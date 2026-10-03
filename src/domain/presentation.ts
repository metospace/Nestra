import type { AppearanceSettings, PanelLayout } from "@/types";

export const cornerRadii = { square: 2, compact: 8, standard: 14, rounded: 22 };
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
