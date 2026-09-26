import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor exposes Text size for button/label/status/schedule only", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.match(src, /Text size/);
  assert.match(src, /selected\.type !== "preview" && selected\.type !== "image" && selected\.type !== "slider"/);
  assert.match(src, /w\.textSize/);
  assert.match(src, /delete w\.textSize/);
  assert.match(src, /option value="xs"/);
  assert.match(src, /option value="sm"/);
  assert.match(src, /option value="md"/);
  assert.match(src, /option value="lg"/);
  assert.match(src, /Extra small/);
  assert.match(src, /Small/);
  assert.match(src, /Medium/);
  assert.match(src, /Large/);
});

test("panel tiles apply height-relative textSize styles (not preview/image/slider)", () => {
  const face = fs.readFileSync("src/components/panel/widget-face.tsx", "utf8");
  const tile = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  const slider = fs.readFileSync("src/components/panel/panel-slider.tsx", "utf8");
  const css = fs.readFileSync("src/components/panel/panel-layout.css", "utf8");
  assert.match(css, /widget-text-container/);
  assert.match(css, /container-type:\s*size/);
  assert.match(face, /widgetBodyTextStyle\(widget\.textSize/);
  assert.match(face, /widgetChipTextStyle\(widget\.textSize/);
  assert.match(face, /widget-text-container/);
  // Buttons use body size for the label (primary face text).
  assert.match(face, /widget\.type === "button"/);
  assert.match(tile, /widgetLabelTileTextStyle\(widget\.textSize\)/);
  assert.match(tile, /widgetBodyTextStyle\(widget\.textSize\)/);
  assert.match(tile, /widgetSecondaryTextStyle\(widget\.textSize\)/);
  // Slider restored to fixed face sizing (pre-textSize).
  assert.equal(/text-size-widget/.test(slider), false);
  assert.equal(/widget\.textSize/.test(slider), false);
  assert.equal(/widget-text-container/.test(slider), false);
  assert.match(slider, /text-xl/);
  assert.match(slider, /text-\[11px\]/);
  // Preview/image tiles must not import text-size helpers
  const preview = fs.readFileSync("src/components/panel/preview-tile.tsx", "utf8");
  const image = fs.readFileSync("src/components/panel/image-tile.tsx", "utf8");
  assert.equal(/text-size-widget/.test(preview), false);
  assert.equal(/text-size-widget/.test(image), false);
});
