import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("pages-editor shows selected page id read-only next to page name", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.match(src, /Page name/);
  assert.match(src, /Page id/);
  assert.match(src, /value=\{page\.id\}/);
  assert.match(src, /readOnly/);
  assert.match(src, /font-mono/);
  assert.match(src, /ui\.page\s*\/\s*gotoPage/);
  // Label stays editable; id is display-only in this MR (no page.id write).
  assert.match(src, /p\.label = e\.target\.value/);
  assert.equal(/\bp\.id\s*=(?!=)/.test(src), false);
});
