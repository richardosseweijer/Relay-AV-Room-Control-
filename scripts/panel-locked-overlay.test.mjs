import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("control-panel composes PanelLockedOverlay leaf for host.locked chrome", () => {
  const src = fs.readFileSync("src/components/panel/control-panel.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/panel/panel-locked-overlay.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/panel-locked-overlay[\"']/);
  assert.match(src, /<PanelLockedOverlay\b/);
  assert.match(src, /export function ControlPanel\s*\(/);
  assert.equal(/Room locked/.test(src), false);
  assert.equal(/z-\[68\]/.test(src), false);

  assert.match(leaf, /export function PanelLockedOverlay\s*\(/);
  assert.match(leaf, /Room locked/);
  assert.match(leaf, /z-\[68\]/);
  assert.match(leaf, /panel\.unlock/);
  assert.match(leaf, /fireCommand/);
});
