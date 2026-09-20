import type { Page, Widget } from "./types";

export type GridSize = { cols: number; rows: number };
export type Box = { x: number; y: number; w: number; h: number };

export const DEFAULT_PORTRAIT_GRID: GridSize = { cols: 4, rows: 10 };

export function pageGrid(page: Page, portrait: boolean): GridSize {
  if (portrait && page.portraitGrid) return page.portraitGrid;
  return page.grid;
}

/** Landscape always has a box. Portrait is opt-in; null = hidden on that face. */
export function widgetBox(widget: Widget, portrait: boolean): Box | null {
  if (!portrait) return { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  return widget.portrait ?? null;
}

export function overlapsBoxes(boxes: Box[], x: number, y: number, w: number, h: number) {
  return boxes.some((box) => x < box.x + box.w && x + w > box.x && y < box.y + box.h && y + h > box.y);
}

export function overlaps(
  widgets: Widget[],
  x: number,
  y: number,
  w: number,
  h: number,
  skipId?: string,
  portrait = false,
) {
  return widgets.some((item) => {
    if (item.id === skipId) return false;
    const box = widgetBox(item, portrait);
    if (!box) return false;
    return x < box.x + box.w && x + w > box.x && y < box.y + box.h && y + h > box.y;
  });
}

export function firstFree(boxes: Box[], cols: number, rows: number, w = 1, h = 1): Box | null {
  for (let y = 0; y <= rows - h; y += 1) {
    for (let x = 0; x <= cols - w; x += 1) {
      if (!overlapsBoxes(boxes, x, y, w, h)) return { x, y, w, h };
    }
  }
  return null;
}

/** Use portrait coords when that grid exists; else the landscape page (old rooms). */
export function widgetsOn(page: Page, portrait: boolean): Widget[] {
  const usePortrait = portrait && Boolean(page.portraitGrid);
  const rows = page.widgets.flatMap((widget) => {
    const box = widgetBox(widget, usePortrait);
    if (!box) return [];
    return [{ ...widget, x: box.x, y: box.y, w: box.w, h: box.h }];
  });
  return rows.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function gridStyle(box: Box) {
  return {
    gridColumn: `${box.x + 1} / span ${box.w}`,
    gridRow: `${box.y + 1} / span ${box.h}`,
  };
}

export function setBox(widget: Widget, portrait: boolean, patch: Partial<Box>) {
  if (!portrait) {
    if (patch.x != null) widget.x = patch.x;
    if (patch.y != null) widget.y = patch.y;
    if (patch.w != null) widget.w = patch.w;
    if (patch.h != null) widget.h = patch.h;
    return;
  }
  const cur = widget.portrait ?? { x: 0, y: 0, w: 1, h: 1 };
  widget.portrait = {
    x: patch.x ?? cur.x,
    y: patch.y ?? cur.y,
    w: patch.w ?? cur.w,
    h: patch.h ?? cur.h,
  };
}

export function ensurePortraitGrid(page: Page): GridSize {
  if (!page.portraitGrid) page.portraitGrid = { ...DEFAULT_PORTRAIT_GRID };
  return page.portraitGrid;
}

export function copyLandscapeToPortrait(page: Page) {
  const grid = ensurePortraitGrid(page);
  const placed: Box[] = page.widgets.flatMap((widget) => (widget.portrait ? [widget.portrait] : []));
  for (const widget of page.widgets) {
    if (widget.portrait) continue;
    const box = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
    if (box.x + box.w > grid.cols || box.y + box.h > grid.rows) continue;
    if (overlapsBoxes(placed, box.x, box.y, box.w, box.h)) continue;
    widget.portrait = box;
    placed.push(box);
  }
}
