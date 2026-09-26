import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor composes PagesImageFields leaf for image widget editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/config/pages-image-fields.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/pages-image-fields[\"']/);
  assert.match(src, /<PagesImageFields\b/);
  assert.match(src, /export function PagesEditor\s*\(/);
  // Image upload/fit chrome left the god file; PagesEditor stays composed entry.
  assert.equal(/Clear image/.test(src), false);
  assert.equal(/image\/png,image\/jpeg,image\/webp/.test(src), false);
  assert.equal(/\/api\/media/.test(src), false);
  assert.equal(/imageSrc/.test(src), false);
  // Type switch still orchestrated on PagesEditor (incl. imageFit / label init)
  assert.match(src, /selected\.type === "image"/);
  assert.match(src, /type === "image"/);
  assert.match(src, /option value="image"/);
  assert.match(src, /w\.imageFit = w\.imageFit === "cover" \? "cover" : "contain"/);
  assert.match(src, /label === "Button" \|\| !w\.label \? "Image"/);
  // Color stays; icon picker hidden for image
  assert.match(src, /selected\.type !== "image"/);
  assert.match(src, /fills\[color\]/);

  assert.match(leaf, /export function PagesImageFields\s*\(/);
  assert.match(leaf, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(leaf, /\/api\/media/);
  assert.match(leaf, /imageSrc/);
  assert.match(leaf, /imageFit/);
  assert.match(leaf, /Fit \(keep aspect\)/);
  assert.match(leaf, /Fill tile/);
  assert.match(leaf, /NONE_MACRO_ID/);
  assert.match(leaf, /Tap macro \(optional\)/);
  assert.match(leaf, /relay-config-token/);
  assert.match(leaf, /method: "POST"/);
  assert.match(leaf, /method: "DELETE"/);
  assert.match(leaf, /Clear image/);
});
