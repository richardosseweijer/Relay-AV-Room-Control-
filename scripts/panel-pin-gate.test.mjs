import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("control-panel composes PanelPinGate leaf for PIN unlock UI", () => {
  const src = fs.readFileSync("src/components/panel/control-panel.tsx", "utf8");
  const leaf = fs.readFileSync("src/components/panel/panel-pin-gate.tsx", "utf8");

  assert.match(src, /from\s+[\"']\.\/panel-pin-gate[\"']/);
  assert.match(src, /<PanelPinGate\b/);
  assert.match(src, /export function ControlPanel\s*\(/);
  assert.equal(/async function unlockRoom\s*\(/.test(src), false);
  assert.equal(/\bconst \[pin, setPin\]/.test(src), false);
  assert.equal(/PIN to open the room/.test(src), false);

  assert.match(leaf, /export function PanelPinGate\s*\(/);
  assert.match(leaf, /async function unlockRoom\s*\(/);
  assert.match(leaf, /PIN to open the room/);
  assert.match(leaf, /\/api\/panel-unlock/);
  assert.match(leaf, /PANEL_TOKEN_KEY/);
  assert.match(leaf, /to=\"\/config\"/);
});
