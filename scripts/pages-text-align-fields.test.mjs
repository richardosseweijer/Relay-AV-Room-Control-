import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor exposes Text align for label/button/status only", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.match(src, /Text align/);
  assert.match(src, /selected\.type === "label" \|\| selected\.type === "button" \|\| selected\.type === "status"/);
  assert.match(src, /w\.textAlign/);
  assert.match(src, /option value="left"/);
  assert.match(src, /option value="center"/);
  assert.match(src, /option value="right"/);
  assert.match(src, /Left/);
  assert.match(src, /Center/);
  assert.match(src, /Right/);
  // Must not gate on the broader non-preview/non-image set used for textSize
  const alignBlock = src.slice(src.indexOf("Text align"));
  assert.equal(/selected\.type !== "preview" && selected\.type !== "image"/.test(alignBlock.slice(0, 200)), false);
});

test("panel tiles apply textAlign classes for label/button/status; leave preview/image alone", () => {
  const face = fs.readFileSync("src/components/panel/widget-face.tsx", "utf8");
  const tile = fs.readFileSync("src/components/panel/panel-tile.tsx", "utf8");
  assert.match(face, /supportsTextAlign/);
  assert.match(face, /textAlignClass/);
  assert.match(face, /widget\.textAlign/);
  assert.match(tile, /textAlignClass\(widget\.textAlign\)/);
  assert.match(tile, /textAlignJustifyClass\(widget\.textAlign\)/);
  // Preview/image tiles must not import text-align helpers
  const preview = fs.readFileSync("src/components/panel/preview-tile.tsx", "utf8");
  const image = fs.readFileSync("src/components/panel/image-tile.tsx", "utf8");
  const slider = fs.readFileSync("src/components/panel/panel-slider.tsx", "utf8");
  assert.equal(/text-align-widget/.test(preview), false);
  assert.equal(/text-align-widget/.test(image), false);
  assert.equal(/text-align-widget/.test(slider), false);
});
