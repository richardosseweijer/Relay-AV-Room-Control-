import test from "node:test";
import assert from "node:assert/strict";
import {
  copyLandscapeToPortrait,
  DEFAULT_PORTRAIT_GRID,
  pageGrid,
  widgetBox,
  widgetsOn,
  overlaps,
  pasteWidget,
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

test("paste keeps a free cell and does not share nested fields", () => {
  const target = { id: "other", label: "Other", grid: { cols: 6, rows: 8 }, widgets: [] };
  const source = {
    id: "a",
    type: "button",
    x: 1,
    y: 2,
    w: 2,
    h: 1,
    label: "Go",
    color: "steel",
    bind: { kind: "macro", id: "go" },
    colorWhen: [{ equals: "1", color: "sage", label: "On" }],
  };
  const next = pasteWidget(target, source, false, "copy");
  assert.equal(next.id, "copy");
  assert.deepEqual({ x: next.x, y: next.y, w: next.w, h: next.h }, { x: 1, y: 2, w: 2, h: 1 });
  assert.equal(next.portrait, undefined);
  source.bind.id = "changed";
  source.colorWhen[0].label = "Off";
  assert.equal(next.bind.id, "go");
  assert.equal(next.colorWhen[0].label, "On");
  assert.equal(target.widgets.length, 0);
});

test("paste moves a taken cell and drops a portrait box that does not fit", () => {
  const target = page();
  target.portraitGrid = { cols: 4, rows: 10 };
  const source = {
    id: "a",
    type: "button",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
    label: "Go",
    color: "steel",
    portrait: { x: 0, y: 0, w: 5, h: 1 },
    bind: { kind: "macro" },
  };
  const next = pasteWidget(target, source, false, "copy");
  assert.deepEqual({ x: next.x, y: next.y, w: next.w, h: next.h }, { x: 3, y: 0, w: 2, h: 1 });
  assert.equal(next.portrait, undefined);
  assert.equal(source.portrait.w, 5);
});

test("paste on portrait keeps a fitting portrait cell and relocates landscape", () => {
  const target = page();
  target.portraitGrid = { cols: 4, rows: 10 };
  const source = {
    id: "src",
    type: "status",
    x: 0,
    y: 0,
    w: 2,
    h: 1,
    label: "Power",
    color: "clay",
    latchGroup: "power",
    portrait: { x: 0, y: 4, w: 2, h: 1 },
    bind: { kind: "macro", id: "pwr" },
  };
  const next = pasteWidget(target, source, true, "copy");
  assert.equal(next.latchGroup, "power");
  assert.deepEqual(next.portrait, { x: 0, y: 4, w: 2, h: 1 });
  assert.deepEqual({ x: next.x, y: next.y, w: next.w, h: next.h }, { x: 3, y: 0, w: 2, h: 1 });
});

test("paste refuses when the active face has no free cell", () => {
  const target = {
    id: "full",
    label: "Full",
    grid: { cols: 1, rows: 1 },
    widgets: [{ id: "a", type: "button", x: 0, y: 0, w: 1, h: 1, label: "A", color: "steel", bind: { kind: "macro" } }],
  };
  assert.equal(pasteWidget(target, target.widgets[0], false, "copy"), null);
  assert.equal(target.widgets.length, 1);
});
