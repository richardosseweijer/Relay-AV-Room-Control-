import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("control-panel composes PanelTile leaf for widget tile map", () => {
  const src = fs.readFileSync("src/components/panel/control-panel.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/panel-tile[\"']/);
  assert.match(src, /<PanelTile\b/);
  assert.match(src, /export function ControlPanel\s*\(/);
  assert.match(src, /async function run\s*\(/);
  assert.match(src, /function slide\s*\(/);
  assert.match(src, /async function refresh\s*\(/);
  // Render-map chrome left the god file; run/slide orchestration stays.
  assert.equal(/Nothing scheduled/.test(src), false);
  assert.equal(/Confirm\?/.test(src), false);
  assert.equal(/data-wide=\{wide\}/.test(src), false);
  assert.equal(/data-type=\{widget\.type\}/.test(src), false);
  assert.equal(/from\s+[\"']\.\/panel-slider[\"']/.test(src), false);
  assert.equal(/from\s+[\"']\.\/preview-tile[\"']/.test(src), false);
  assert.equal(/from\s+[\"']\.\/widget-face[\"']/.test(src), false);
  assert.equal(/traffic \|\| lit \|\| waiting/.test(src), false);
  assert.equal(/nextScheduled\(/.test(src), false);
  // Status press path (#86) still orchestrated on ControlPanel
  assert.match(src, /statusMacroId/);
  assert.match(src, /resolveStatusAppearance/);

  assert.match(leaf, /export function PanelTile\s*\(/);
  assert.match(leaf, /widget\.type === "slider"/);
  assert.match(leaf, /widget\.type === "label"/);
  assert.match(leaf, /widget\.type === "schedule"/);
  assert.match(leaf, /widget\.type === "preview"/);
  assert.match(leaf, /widget\.type === "status"/);
  assert.match(leaf, /resolveStatusAppearance/);
  assert.match(leaf, /traffic/);
  assert.match(leaf, /Nothing scheduled/);
  assert.match(leaf, /Confirm\?/);
  assert.match(leaf, /PanelSlider/);
  assert.match(leaf, /PreviewTile/);
  assert.match(leaf, /WidgetShell/);
});
