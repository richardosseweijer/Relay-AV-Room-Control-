import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor composes PagesStatusFields leaf for status traffic-light editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/config/pages-status-fields.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/pages-status-fields[\"']/);
  assert.match(src, /<PagesStatusFields\b/);
  assert.match(src, /export function PagesEditor\s*\(/);
  // Status traffic-light chrome left the god file; PagesEditor stays composed entry.
  assert.equal(/Color when \(first match\)/.test(src), false);
  assert.equal(/When nothing matches/.test(src), false);
  assert.equal(/Catch-all color/.test(src), false);
  assert.equal(/statusDefault/.test(src), false);
  assert.equal(/colorWhen/.test(src), false);
  // Type switch still orchestrated on PagesEditor
  assert.match(src, /selected\.type === "status"/);
  assert.match(src, /type === "status"/);

  assert.match(leaf, /export function PagesStatusFields\s*\(/);
  assert.match(leaf, /Color when \(first match\)/);
  assert.match(leaf, /When nothing matches/);
  assert.match(leaf, /Catch-all color/);
  assert.match(leaf, /colorWhen/);
  assert.match(leaf, /statusDefault/);
  assert.match(leaf, /NONE_MACRO_ID/);
  assert.match(leaf, /Add rule/);
});
