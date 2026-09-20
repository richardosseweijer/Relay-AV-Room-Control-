import test from "node:test";
import assert from "node:assert/strict";
import {
  copyLandscapeToPortrait,
  DEFAULT_PORTRAIT_GRID,
  pageGrid,
  widgetBox,
  widgetsOn,
  overlaps,
} from "../src/lib/control/page-layout.ts";

function page() {
  return {
    id: "home",
    label: "Home",
    grid: { cols: 6, rows: 8 },
    widgets: [
      { id: "a", type: "button", x: 0, y: 0, w: 2, h: 1, label: "A", color: "steel", bind: { kind: "macro" } },
      { id: "b", type: "button", x: 2, y: 0, w: 1, h: 1, label: "B", color: "steel", bind: { kind: "macro" } },
    ],
  };
}

test("old rooms without portraitGrid stay landscape on a portrait phone", () => {
  const p = page();
  assert.deepEqual(pageGrid(p, true), { cols: 6, rows: 8 });
  assert.equal(widgetsOn(p, true).length, 2);
  assert.equal(widgetBox(p.widgets[0], true), null);
});

test("portraitGrid hides widgets until placed", () => {
  const p = page();
  p.portraitGrid = { ...DEFAULT_PORTRAIT_GRID };
  p.widgets[0].portrait = { x: 0, y: 1, w: 4, h: 2 };
  const tiles = widgetsOn(p, true);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].id, "a");
  assert.equal(tiles[0].w, 4);
  assert.equal(tiles[0].y, 1);
  assert.equal(p.widgets[0].w, 2);
});

test("copy from landscape skips cells that do not fit", () => {
  const p = page();
  p.widgets.push({ id: "wide", type: "button", x: 0, y: 2, w: 6, h: 1, label: "Wide", color: "steel", bind: { kind: "macro" } });
  copyLandscapeToPortrait(p);
  assert.deepEqual(p.portraitGrid, DEFAULT_PORTRAIT_GRID);
  assert.deepEqual(p.widgets[0].portrait, { x: 0, y: 0, w: 2, h: 1 });
  assert.deepEqual(p.widgets[1].portrait, { x: 2, y: 0, w: 1, h: 1 });
  assert.equal(p.widgets[2].portrait, undefined);
});

test("overlap uses the active face", () => {
  const p = page();
  p.portraitGrid = { cols: 4, rows: 10 };
  p.widgets[0].portrait = { x: 0, y: 0, w: 2, h: 1 };
  assert.equal(overlaps(p.widgets, 0, 0, 1, 1, undefined, true), true);
  assert.equal(overlaps(p.widgets, 3, 3, 1, 1, undefined, true), false);
  assert.equal(overlaps(p.widgets, 2, 0, 1, 1), true);
});
