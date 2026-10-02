import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { bootTriggerPaths } from "../src/lib/control/logic-policy.ts";

test("TriggerMode includes boot", () => {
  const types = fs.readFileSync("src/lib/control/types.ts", "utf8");
  assert.match(types, /export type TriggerMode = "change" \| "interval" \| "boot"/);
});

test("normalize coerces unknown mode; keeps boot", () => {
  const src = fs.readFileSync("src/lib/control/store-normalize.ts", "utf8");
  assert.match(src, /rule\.mode === "interval" \|\| rule\.mode === "boot"/);
});

test("runDueTriggers skips boot; runBootTriggers is one-shot via globalThis", () => {
  const leaf = fs.readFileSync("src/lib/control/store-schedules.ts", "utf8");
  assert.match(leaf, /rule\.mode === "boot"/);
  assert.match(leaf, /export async function runBootTriggers/);
  assert.match(leaf, /__relayBootTriggersDone__/);
  assert.match(leaf, /if \(g\.__relayBootTriggersDone__\) return/);
  assert.match(leaf, /g\.__relayBootTriggersDone__ = true/);
  const store = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  assert.match(store, /void runBootTriggers\(\)\.catch\(\(\) => undefined\)/);
  assert.match(store, /__relayBootTriggersDone__/);
});

test("UI exposes On Relay boot and documents HMR", () => {
  const pane = fs.readFileSync("src/components/config/trigger-pane.tsx", "utf8");
  assert.match(pane, /value="boot"/);
  assert.match(pane, /On Relay boot/);
  assert.match(pane, /hot reload does not re-fire/i);
  assert.match(pane, /Always \(no check\)/);
});

test("bootTriggerPaths library behaviour", () => {
  assert.deepEqual(bootTriggerPaths({ mode: "boot" }, {}), ["t"]);
  assert.deepEqual(bootTriggerPaths({ mode: "interval", variable: "x" }, { x: "1" }), []);
  assert.deepEqual(bootTriggerPaths({ mode: "boot", variable: "x", compare: "eq", equals: "1" }, { x: "1" }), ["t"]);
  assert.deepEqual(bootTriggerPaths({ mode: "boot", variable: "x", compare: "eq", equals: "1" }, { x: "0" }), ["f"]);
});
