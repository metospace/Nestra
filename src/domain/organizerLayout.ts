import type { PanelLayout } from '@/types';

export interface SurfaceBounds { x: number; y: number; width: number; height: number }

/** Shared complete tile dimensions for surface sizing, grid rows and pages. */
export function organizerMetrics(layout: PanelLayout) {
  const padding = layout.density === 'compact' ? 5 : 10;
  const icon = layout.iconSize ?? (layout.density === 'compact' ? 32 : 42);
  const label = 11 * 1.35 * (layout.labelLines ?? 2);
  return {
    gap: layout.itemGap ?? (layout.density === 'compact' ? 2 : 8),
    tileWidth: Math.max(84, icon + padding * 2 + 2),
    tileHeight: Math.ceil((layout.viewMode === 'list' ? Math.max(icon, label) : icon + 5 + label) + padding * 2 + 2),
  };
}

/** Fit whole rows inside one screen. Large folders page instead of clipping tiles. */
export function fitOrganizer(layout: PanelLayout, count: number, bounds: SurfaceBounds, chromeHeight = 42, paddingY = 16) {
  const metrics = organizerMetrics(layout), margin = 12;
  const maxWidth = Math.max(1, bounds.width - margin * 2), maxHeight = Math.max(1, bounds.height - margin * 2);
  const horizontalInsets = 18;
  const maxColumns = layout.viewMode === 'list' ? 1 : Math.max(1, Math.floor((maxWidth - horizontalInsets + metrics.gap) / (metrics.tileWidth + metrics.gap)));
  const safeCount = Math.max(0, Math.floor(count));
  if (layout.autoSize === false) {
    const width = Math.min(maxWidth, Math.max(264, layout.width));
    const columns = layout.viewMode === 'list' ? 1 : Math.max(1, Math.floor((width - horizontalInsets + metrics.gap) / (metrics.tileWidth + metrics.gap)));
    const base = chromeHeight + paddingY + 2;
    const minHeight = base + metrics.tileHeight + (safeCount > columns ? 34 : 0);
    const height = Math.min(maxHeight, Math.max(layout.height, minHeight));
    const rowsWithoutPager = Math.max(1, Math.floor((height - base + metrics.gap) / (metrics.tileHeight + metrics.gap)));
    const pagerHeight = safeCount > columns * rowsWithoutPager ? 34 : 0;
    const rows = Math.max(1, Math.floor((height - base - pagerHeight + metrics.gap) / (metrics.tileHeight + metrics.gap)));
    const x = Math.max(bounds.x + margin, Math.min(layout.x, bounds.x + bounds.width - margin - width));
    const y = Math.max(bounds.y + margin, Math.min(layout.y, bounds.y + bounds.height - margin - height));
    return { layout: { ...layout, x, y, width, height }, columns, rows, minHeight,
      pageSize: columns * rows, pageCount: Math.max(1, Math.ceil(safeCount / (columns * rows))), ...metrics };
  }
  const preferred = layout.viewMode === 'list' ? 1 : Math.min(Math.max(1, safeCount), Math.max(1, layout.columns ?? 4), maxColumns);
  const rowsAvailable = (pager: number) => Math.max(1, Math.floor((maxHeight - chromeHeight - paddingY - 2 - pager + metrics.gap) / (metrics.tileHeight + metrics.gap)));
  let maxRows = rowsAvailable(0);
  const paginated = safeCount > maxColumns * maxRows;
  const pagerHeight = paginated ? 34 : 0;
  if (paginated) maxRows = rowsAvailable(pagerHeight);
  const columns = Math.min(maxColumns, Math.max(preferred, Math.ceil(safeCount / maxRows)));
  const rows = Math.min(maxRows, Math.max(1, Math.ceil(safeCount / columns)));
  const width = Math.min(maxWidth, Math.max(264, layout.viewMode === 'list' ? layout.width : columns * metrics.tileWidth + (columns - 1) * metrics.gap + horizontalInsets));
  const height = Math.min(maxHeight, Math.max(142, chromeHeight + paddingY + 2 + rows * metrics.tileHeight + (rows - 1) * metrics.gap + pagerHeight));
  const x = Math.max(bounds.x + margin, Math.min(layout.x, bounds.x + bounds.width - margin - width));
  const y = Math.max(bounds.y + margin, Math.min(layout.y, bounds.y + bounds.height - margin - height));
  const minHeight = chromeHeight + paddingY + 2 + metrics.tileHeight + (safeCount > columns ? 34 : 0);
  return { layout: { ...layout, x, y, width, height }, columns, rows, minHeight, pageSize: columns * rows,
    pageCount: Math.max(1, Math.ceil(safeCount / (columns * rows))), ...metrics };
}
