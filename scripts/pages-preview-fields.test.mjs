import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor composes PagesPreviewFields leaf for preview stream editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/config/pages-preview-fields.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/pages-preview-fields[\"']/);
  assert.match(src, /<PagesPreviewFields\b/);
  assert.match(src, /export function PagesEditor\s*\(/);
  // Preview stream chrome left the god file; PagesEditor stays composed entry.
  assert.equal(/Stream URL/.test(src), false);
  assert.equal(/Behind live \(seconds\)/.test(src), false);
  assert.equal(/RTSP transport/.test(src), false);
  assert.equal(/previewTransport/.test(src), false);
  assert.equal(/previewDelay/.test(src), false);
  assert.equal(/previewFit/.test(src), false);
  // Type switch still orchestrated on PagesEditor (incl. streamUrl init)
  assert.match(src, /selected\.type === "preview"/);
  assert.match(src, /type === "preview"/);
  assert.match(src, /w\.streamUrl = w\.streamUrl \|\| ""/);

  assert.match(leaf, /export function PagesPreviewFields\s*\(/);
  assert.match(leaf, /Stream URL/);
  assert.match(leaf, /Behind live \(seconds\)/);
  assert.match(leaf, /RTSP transport/);
  assert.match(leaf, /previewTransport/);
  assert.match(leaf, /previewDelay/);
  assert.match(leaf, /previewFit/);
  assert.match(leaf, /streamUrl/);
  assert.match(leaf, /NONE_MACRO_ID/);
  assert.match(leaf, /Tap macro \(optional\)/);
});
