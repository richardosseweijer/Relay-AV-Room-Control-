import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("fireMacro awaits the same drainQueuedTriggers schedule uses", () => {
  const runtime = fs.readFileSync("src/lib/control/actions-runtime.ts", "utf8");
  const store = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  const leaf = fs.readFileSync("src/lib/control/store-schedules.ts", "utf8");
  const session = fs.readFileSync("src/lib/control/session.server.ts", "utf8");
  // Façade re-exports drain; schedule path lives on the schedules leaf (#85).
  assert.match(store, /drainQueuedTriggers/);
  assert.equal(/export async function drainQueuedTriggers\(/.test(store), false);
  assert.match(leaf, /export async function drainQueuedTriggers\s*\(/);
  assert.ok(leaf.includes("await drainQueuedTriggers()"), "schedule path must call drainQueuedTriggers");
  assert.ok(session.includes("drainQueuedTriggers"), "session re-exports drain for loadControl");
  assert.match(runtime, /drainQueuedTriggers/);
  assert.match(runtime, /await drainQueuedTriggers\(\)/);
  // Drain runs after clearing runningMacro / persist — success or fail.
  const handler = runtime.slice(runtime.indexOf("export const fireMacro"));
  const clearIdx = handler.indexOf("mem.runningMacro = null");
  const drainIdx = handler.indexOf("await drainQueuedTriggers()");
  assert.ok(clearIdx >= 0 && drainIdx > clearIdx, "drain must follow clearing runningMacro");
});

test("queue item left during a panel macro is processed after fireMacro-style drain", async () => {
  // Same protocol as store.server: park while runningMacro is set, drain after clear.
  const triggerQueue = [];
  let runningMacro = null;
  let activeScene = null;
  const macros = {
    "panel-macro": { id: "panel-macro", label: "Panel" },
    "queued-macro": { id: "queued-macro", label: "Queued" },
  };
  const ran = [];

  async function runQueuedTrigger(job) {
    if (runningMacro) {
      if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) {
        triggerQueue.push(job);
      }
      return;
    }
    const macro = macros[job.macroId];
    if (!macro) return;
    runningMacro = macro.id;
    try {
      ran.push(macro.id);
      activeScene = macro.id;
    } finally {
      runningMacro = null;
    }
    const next = triggerQueue.shift();
    if (next) await runQueuedTrigger(next);
  }

  async function drainQueuedTriggers() {
    const queued = triggerQueue.shift();
    if (queued) {
      const nested = macros[queued.macroId];
      if (nested) await runQueuedTrigger(queued);
    }
  }

  async function fireMacro(macroId) {
    const macro = macros[macroId];
    runningMacro = macro.id;
    // Trigger arrives mid-macro and parks (runDueTriggers path).
    triggerQueue.push({ id: "trig-park", macroId: "queued-macro", label: "Park edge", path: "t" });
    // Panel macro finishes (ok or fail — drain still runs).
    runningMacro = null;
    activeScene = macro.id;
    await drainQueuedTriggers();
  }

  await fireMacro("panel-macro");
  assert.equal(runningMacro, null);
  assert.deepEqual(ran, ["queued-macro"]);
  assert.equal(activeScene, "queued-macro");
  assert.equal(triggerQueue.length, 0);
});

test("peer POST drains triggerQueue after macro (same as fireMacro)", () => {
  const peer = fs.readFileSync("src/routes/api/peer.ts", "utf8");
  assert.match(peer, /drainQueuedTriggers/);
  assert.match(peer, /await drainQueuedTriggers\(\)/);
  const clearIdx = peer.indexOf("mem.runningMacro = null");
  const drainIdx = peer.indexOf("await drainQueuedTriggers()");
  assert.ok(clearIdx >= 0 && drainIdx > clearIdx, "peer drain must follow clearing runningMacro");
});

test("runQueuedTrigger early exits continue the parked queue", () => {
  const leaf = fs.readFileSync("src/lib/control/store-schedules.ts", "utf8");
  const fn = leaf.slice(leaf.indexOf("async function runQueuedTrigger"));
  // Path-miss release must be followed by drain so remaining parks are not orphaned.
  const miss = fn.indexOf("if (!triggerPathHit");
  assert.ok(miss >= 0);
  const after = fn.slice(miss, miss + 450);
  assert.match(after, /pendingTriggers\.release\(key\)/);
  assert.match(after, /await drainQueuedTriggers\(\)/);
  assert.match(leaf, /if \(!mem\.runningMacro && triggerQueue\.length\) await drainQueuedTriggers\(\)/);
});
