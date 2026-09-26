import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor composes PagesEnableWhen leaf for enableWhen conditions editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/config/pages-enable-when.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/pages-enable-when[\"']/);
  assert.match(src, /<PagesEnableWhen\b/);
  assert.match(src, /export function PagesEditor\s*\(/);
  // Enable-when chrome left the god file; PagesEditor stays composed entry.
  assert.equal(/Enable when/.test(src), false);
  assert.equal(/Add condition/.test(src), false);
  assert.equal(/enableWhen/.test(src), false);

  assert.match(leaf, /export function PagesEnableWhen\s*\(/);
  assert.match(leaf, /Enable when/);
  assert.match(leaf, /Add condition/);
  assert.match(leaf, /enableWhen/);
  assert.match(leaf, /op: "eq"/);
  assert.match(leaf, /gte/);
  assert.match(leaf, /lte/);
});

test("PagesEnableWhen exposes Hide when disabled checkbox for label widgets only", () => {
  const leaf = fs.readFileSync("src/components/config/pages-enable-when.tsx", "utf8");
  assert.match(leaf, /Hide when disabled/);
  assert.match(leaf, /selected\.type === "label"/);
  assert.match(leaf, /hideWhenDisabled/);
  assert.match(leaf, /type="checkbox"/);
  // Keep the opt-in out of the god pages-editor file.
  const editor = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.equal(/hideWhenDisabled/.test(editor), false);
  assert.equal(/Hide when disabled/.test(editor), false);
});

