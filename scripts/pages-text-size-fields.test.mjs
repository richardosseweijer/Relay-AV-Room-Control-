import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor exposes Text size for non-preview/non-image widgets", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.match(src, /Text size/);
  assert.match(src, /selected\.type !== "preview" && selected\.type !== "image"/);
  assert.match(src, /w\.textSize/);
  assert.match(src, /option value="sm"/);
  assert.match(src, /option value="md"/);
  assert.match(src, /option value="lg"/);
  assert.match(src, /Small/);
  assert.match(src, /Medium/);
  assert.match(src, /Large/);
});

test("panel tiles apply textSize helpers (not preview/image paths)", () => {
  const face = fs.readFileSync("src/components/panel/widget-face.tsx", "utf8");
  const tile = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  const slider = fs.readFileSync("src/components/panel/panel-slider.tsx", "utf8");
  assert.match(face, /widgetBodyTextClass\(widget\.textSize/);
  assert.match(face, /widgetChipTextClass\(widget\.textSize\)/);
  assert.match(tile, /widgetLabelTileTextClass\(widget\.textSize\)/);
  assert.match(tile, /widgetBodyTextClass\(widget\.textSize\)/);
  assert.match(slider, /widgetBodyTextClass\(widget\.textSize\)/);
  assert.match(slider, /widgetChipTextClass\(widget\.textSize\)/);
  // Preview/image tiles must not import text-size helpers
  const preview = fs.readFileSync("src/components/panel/preview-tile.tsx", "utf8");
  const image = fs.readFileSync("src/components/panel/image-tile.tsx", "utf8");
  assert.equal(/text-size-widget/.test(preview), false);
  assert.equal(/text-size-widget/.test(image), false);
});
