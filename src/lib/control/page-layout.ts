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

function boxesOn(page: Page, portrait: boolean): Box[] {
  return page.widgets.flatMap((widget) => {
    const box = widgetBox(widget, portrait);
    return box ? [box] : [];
  });
}

function boxFits(grid: GridSize, box: Box, boxes: Box[]) {
  if (box.w < 1 || box.h < 1 || box.x < 0 || box.y < 0) return false;
  if (box.x + box.w > grid.cols || box.y + box.h > grid.rows) return false;
  return !overlapsBoxes(boxes, box.x, box.y, box.w, box.h);
}

/** Same cell when it fits; otherwise the first free cell of that size. */
function placePrefer(grid: GridSize, prefer: Box, boxes: Box[]): Box | null {
  if (boxFits(grid, prefer, boxes)) return { x: prefer.x, y: prefer.y, w: prefer.w, h: prefer.h };
  return firstFree(boxes, grid.cols, grid.rows, prefer.w, prefer.h);
}

/**
 * Clone a tile onto this page. The face you are looking at keeps its cell when free,
 * else the first free cell of the same size. Portrait is kept only when that box fits;
 * landscape always gets a real cell because every tile has one. Does not mutate inputs.
 */
export function pasteWidget(page: Page, source: Widget, portrait: boolean, id: string): Widget | null {
  const activePrefer = widgetBox(source, portrait) ?? { x: source.x, y: source.y, w: source.w, h: source.h };
  const active = placePrefer(pageGrid(page, portrait), activePrefer, boxesOn(page, portrait));
  if (!active) return null;

  const landGrid = pageGrid(page, false);
  const landBoxes = boxesOn(page, false);
  const landPrefer = { x: source.x, y: source.y, w: source.w, h: source.h };
  const land = portrait
    ? (boxFits(landGrid, landPrefer, landBoxes) ? { ...landPrefer } : firstFree(landBoxes, landGrid.cols, landGrid.rows, landPrefer.w, landPrefer.h))
    : active;
  if (!land) return null;

  const portraitGrid = pageGrid(page, true);
  const portraitBoxes = boxesOn(page, true);
  const keptPortrait = portrait
    ? active
    : (source.portrait && boxFits(portraitGrid, source.portrait, portraitBoxes) ? { ...source.portrait } : null);

  const next = structuredClone(source);
  next.id = id;
  next.x = land.x;
  next.y = land.y;
  next.w = land.w;
  next.h = land.h;
  if (keptPortrait) next.portrait = keptPortrait;
  else delete next.portrait;
  return next;
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
