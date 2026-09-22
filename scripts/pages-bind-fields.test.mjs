import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor composes PagesBindFields leaf for button/slider bind editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/config/pages-bind-fields.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/pages-bind-fields[\"']/);
  assert.match(src, /<PagesBindFields\b/);
  assert.match(src, /export function PagesEditor\s*\(/);
  // Button/slider bind chrome left the god file; PagesEditor stays composed entry.
  assert.equal(/Also go to page/.test(src), false);
  assert.equal(/Follow highlight group/.test(src), false);
  assert.equal(/When variable matches/.test(src), false);
  assert.equal(/Last pressed in group/.test(src), false);
  assert.equal(/sliderDir/.test(src), false);
  assert.equal(/Auto \(taller = upright\)/.test(src), false);
  // Type switch still orchestrated on PagesEditor (incl. button/slider bind init)
  assert.match(src, /selected\.type === "button"/);
  assert.match(src, /selected\.type === "slider"/);
  assert.match(src, /type === "button"/);
  assert.match(src, /type === "slider"/);
  assert.match(src, /kind: "range"/);
  assert.match(src, /kind: "macro"/);

  assert.match(leaf, /export function PagesBindFields\s*\(/);
  assert.match(leaf, /Also go to page/);
  assert.match(leaf, /Follow highlight group/);
  assert.match(leaf, /When variable matches/);
  assert.match(leaf, /Last pressed in group/);
  assert.match(leaf, /sliderDir/);
  assert.match(leaf, /Auto \(taller = upright\)/);
  assert.match(leaf, /NONE_MACRO_ID/);
  assert.match(leaf, /snap\.drivers/);
  assert.match(leaf, /gotoPage/);
});
