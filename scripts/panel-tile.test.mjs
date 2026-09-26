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
  assert.equal(/from\s+[\"']\.\/image-tile[\"']/.test(src), false);
  assert.equal(/from\s+[\"']\.\/widget-face[\"']/.test(src), false);
  assert.equal(/traffic \|\| lit \|\| waiting/.test(src), false);
  assert.equal(/nextScheduled\(/.test(src), false);
  // Status press path (#86) still orchestrated on ControlPanel
  assert.match(src, /statusMacroId/);
  assert.match(src, /resolveStatusAppearance/);
  // Image optional tap mirrors preview (no useful macro bind = no-op)
  assert.match(src, /widget\.type === "preview" \|\| widget\.type === "image"/);

  assert.match(leaf, /export function PanelTile\s*\(/);
  assert.match(leaf, /widget\.type === "slider"/);
  assert.match(leaf, /widget\.type === "label"/);
  assert.match(leaf, /widget\.type === "schedule"/);
  assert.match(leaf, /widget\.type === "preview"/);
  assert.match(leaf, /widget\.type === "image"/);
  assert.match(leaf, /widget\.type === "status"/);
  assert.match(leaf, /resolveStatusAppearance/);
  assert.match(leaf, /traffic/);
  assert.match(leaf, /Nothing scheduled/);
  assert.match(leaf, /Confirm\?/);
  assert.match(leaf, /PanelSlider/);
  assert.match(leaf, /PreviewTile/);
  assert.match(leaf, /ImageTile/);
  assert.match(leaf, /WidgetShell/);
  // Image spans wide like preview
  assert.match(leaf, /widget\.type === "preview" \|\| widget\.type === "image"/);
});

test("ImageTile loads media via fetch+blob (Bearer), not bare img src", () => {
  const tile = fs.readFileSync("src/components/panel/image-tile.tsx", "utf8");
  assert.match(tile, /export function ImageTile\s*\(/);
  assert.match(tile, /WidgetShell/);
  assert.match(tile, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(tile, /URL\.createObjectURL/);
  assert.match(tile, /URL\.revokeObjectURL/);
  assert.match(tile, /object-contain/);
  assert.match(tile, /object-cover/);
  assert.match(tile, /No image/);
  // Borderless: skip WidgetShell chrome; still a button for optional tap
  assert.match(tile, /imageBorderless/);
  assert.match(tile, /borderless/);
  // Must not use the raw imageSrc / path as <img src> (cookies absent; Bearer required).
  assert.match(tile, /src=\{blobUrl\}/);
  assert.equal(/<img[^>]*src=\{(?:src|widget\.imageSrc)/.test(tile), false);
});

test("PanelTile hides label when shouldHideWhenDisabled", () => {
  const leaf = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  assert.match(leaf, /shouldHideWhenDisabled/);
  assert.match(leaf, /widget\.type === "label"/);
  assert.match(leaf, /return null/);
  assert.match(leaf, /!on && "opacity-40"/);
});

test("PanelTile applies textAlign classes on label tiles", () => {
  const leaf = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  assert.match(leaf, /textAlignClass\(widget\.textAlign\)/);
  assert.match(leaf, /textAlignJustifyClass\(widget\.textAlign\)/);
  assert.match(leaf, /from\s+[\"']@\/lib\/control\/text-align-widget[\"']/);
});

test("PanelTile resolves widget labels via resolveWidgetLabel for all face types", () => {
  const leaf = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  assert.match(leaf, /resolveWidgetLabel/);
  assert.match(leaf, /from\s+[\"']@\/lib\/control\/vars[\"']/);
  // One face object with resolved label feeds every widget type that shows a label.
  assert.match(leaf, /const face = \{ \.\.\.widget, label: resolveWidgetLabel\(/);
  assert.match(leaf, /<PanelSlider[\s\S]*widget=\{face\}/);
  assert.match(leaf, /\{face\.label\}/);
  assert.match(leaf, /<PreviewTile widget=\{face\}/);
  assert.match(leaf, /<ImageTile widget=\{face\}/);
  assert.match(leaf, /\.\.\.face, color: appearance\.color/);
  assert.match(leaf, /widget=\{face\}/); // button shell
  // Status colorWhen / default readout labels also expand.
  assert.match(leaf, /resolveWidgetLabel\(appearance\.text/);
});

test("PanelTile label tiles apply widgetColorClass for configured background", () => {
  const leaf = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  const face = fs.readFileSync("src/components/panel/widget-face.tsx", "utf8");
  assert.match(leaf, /widgetColorClass\[widget\.color\]/);
  assert.match(leaf, /from\s+[\"']\.\/widget-face[\"']/);
  // Label keeps its own tile (not WidgetShell button chrome) but shares face fill.
  assert.match(leaf, /widget\.type === "label"/);
  assert.match(leaf, /rounded-lg border/);
  assert.match(face, /export const widgetColorClass/);
  assert.match(face, /bg-steel\/25/);
});
