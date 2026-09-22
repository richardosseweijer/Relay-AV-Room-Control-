import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fetchTextBounded } from "../src/lib/control/http-client.ts";
import { TriggerReservations } from "../src/lib/control/logic-policy.ts";
import { paceDevice } from "../src/lib/control/engine-wire.ts";

test("a delayed change trigger runs once for one edge", async () => {
  const reservations = new TriggerReservations();
  let runs = 0;
  const dispatch = () => {
    if (!reservations.reserve("edge:t")) return;
    void (async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        runs += 1;
      } finally {
        reservations.release("edge:t");
      }
    })();
  };
  dispatch();
  dispatch();
  dispatch();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(runs, 1);
});

test("HTTP timeout covers a response body that stalls after headers", async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const started = Date.now();
  const result = await fetchTextBounded(`http://127.0.0.1:${address.port}`, { method: "GET" }, 50);
  assert.equal(result.ok, false);
  assert.equal(result.text, "request timed out");
  assert.ok(Date.now() - started < 300, `timeout took ${Date.now() - started}ms`);
});

test("HTTP responses larger than 64 KiB are rejected", async (t) => {
  const body = "x".repeat(65 * 1024);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const result = await fetchTextBounded(`http://127.0.0.1:${address.port}`, { method: "GET" }, 500);
  assert.equal(result.ok, false);
  assert.equal(result.text, "response too large");
});

test("large inventory and peer responses can opt into a 2 MiB limit", async (t) => {
  const body = "x".repeat(1024 * 1024);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, "object");
  const result = await fetchTextBounded(
    `http://127.0.0.1:${address.port}`,
    { method: "GET" },
    1000,
    2 * 1024 * 1024,
  );
  assert.equal(result.ok, true);
  assert.equal(result.text.length, body.length);
});
test("concurrent paceDevice callers reserve minIntervalMs slots sequentially", async () => {
  const id = `pace-regression-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const gap = 60;
  const n = 4;
  const stamps = [];
  await Promise.all(
    Array.from({ length: n }, async () => {
      await paceDevice(id, gap);
      stamps.push(Date.now());
    }),
  );
  stamps.sort((a, b) => a - b);
  assert.equal(stamps.length, n);
  for (let i = 1; i < stamps.length; i++) {
    const delta = stamps[i] - stamps[i - 1];
    // Timer jitter: allow a few ms short of gap; without the mutex deltas are ~0.
    assert.ok(delta >= gap - 8, `slot ${i} delta ${delta}ms < ${gap - 8}ms`);
  }
  const span = stamps[n - 1] - stamps[0];
  assert.ok(span >= (n - 1) * gap - 20, `span ${span}ms too short for ${n} paced sends`);
});

test("F3: flushPersist clears dirty before await and loops while dirty", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store-persist.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function flushPersist()");
  assert.ok(start >= 0, "flushPersist present");
  const end = src.indexOf("\nexport async function persistNow", start);
  assert.ok(end > start, "flushPersist bounded before persistNow");
  const body = src.slice(start, end);
  assert.match(body, /while\s*\(\s*persistDirty\s*\)/);
  const clearIdx = body.indexOf("persistDirty = false");
  const awaitIdx = body.indexOf("await writeFileStore");
  assert.ok(clearIdx >= 0 && awaitIdx > clearIdx, "dirty must clear before await writeFileStore");
  // Must not clear dirty only after the write (lost concurrent persist).
  const afterAwait = body.slice(awaitIdx);
  assert.equal(afterAwait.includes("persistDirty = false"), false, "must not clear dirty after await write");
  assert.match(body, /catch\s*\([\s\S]*persistDirty\s*=\s*true/);
});

test("F3: dirty set during in-flight write is flushed again (protocol)", async () => {
  let persistDirty = false;
  const writes = [];
  let value = 0;

  async function writeFileStore(snapshot) {
    await new Promise((r) => setTimeout(r, 30));
    writes.push(snapshot);
  }

  async function flushPersist() {
    while (persistDirty) {
      persistDirty = false;
      const snap = value;
      try {
        await writeFileStore(snap);
      } catch (err) {
        persistDirty = true;
        throw err;
      }
    }
  }

  function persist() {
    persistDirty = true;
  }

  persistDirty = true;
  value = 1;
  const flush = flushPersist();
  await new Promise((r) => setTimeout(r, 5));
  value = 2;
  persist();
  await flush;
  assert.equal(persistDirty, false);
  assert.deepEqual(writes, [1, 2], "mutation during flush must trigger a second durable write");
});

test("F1: snapshot uses normalizedConfig memo (not bare normalize every poll)", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
  const start = src.indexOf("export function snapshot()");
  assert.ok(start >= 0, "snapshot present");
  const end = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, end > start ? end : start + 800);
  assert.match(body, /normalizedConfig\s*\(\s*mem\.config\s*\)/, "snapshot must use normalizedConfig");
  assert.doesNotMatch(body, /mem\.config\s*=\s*normalize\s*\(\s*mem\.config\s*\)/, "snapshot must not call normalize(mem.config) directly");
});

test("F7: writeFileStore/persist reuses normalizedConfig (no second normalize)", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store-persist.ts", import.meta.url), "utf8");
  // Persist body must publicConfig(normalizedConfig(...)), not publicConfig(normalize(...)).
  assert.match(src, /publicConfig\s*\(\s*normalizedConfig\s*\(\s*mem\.config\s*\)\s*\)/);
  assert.doesNotMatch(src, /publicConfig\s*\(\s*normalize\s*\(\s*mem\.config\s*\)\s*\)/);
});

test("F1+F7: installRoomConfig bumps generation; memo hits on same identity", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store-normalize.ts", import.meta.url), "utf8");
  assert.match(src, /export function installRoomConfig\s*\(/);
  assert.match(src, /export function normalizedConfig\s*\(/);
  assert.match(src, /export function invalidateNormalizedConfig\s*\(/);
  const install = src.match(/export function installRoomConfig\([\s\S]*?\n\}/);
  assert.ok(install, "installRoomConfig body");
  assert.match(install[0], /configNormGeneration\s*\+=\s*1/);
  assert.match(install[0], /rememberNormalized\s*\(/);
  const memo = src.match(/export function normalizedConfig\([\s\S]*?\n\}/);
  assert.ok(memo, "normalizedConfig body");
  assert.match(memo[0], /config === memoNormalized/);
  assert.match(memo[0], /memoNormGeneration === configNormGeneration/);
  // Protocol: same generation + same identity → no rebuild; install bumps then rebuilds once.
  let configNormGeneration = 0;
  let memoNormGeneration = -1;
  let memoNormalized = null;
  let normalizeCalls = 0;
  function normalize(config) {
    normalizeCalls += 1;
    return { ...config, _n: normalizeCalls };
  }
  function rememberNormalized(config) {
    memoNormalized = config;
    memoNormGeneration = configNormGeneration;
  }
  function normalizedConfig(config) {
    if (memoNormalized && memoNormGeneration === configNormGeneration && config === memoNormalized) {
      return memoNormalized;
    }
    const next = normalize(config);
    rememberNormalized(next);
    return next;
  }
  function installRoomConfig(config, opts) {
    configNormGeneration += 1;
    const next = opts?.alreadyNormalized ? config : normalize(config);
    rememberNormalized(next);
    return next;
  }
  const live = installRoomConfig({ room: { name: "A" } });
  assert.equal(normalizeCalls, 1);
  assert.equal(normalizedConfig(live), live);
  assert.equal(normalizedConfig(live), live);
  assert.equal(normalizeCalls, 1, "polls must not re-normalize");
  const replaced = installRoomConfig({ room: { name: "B" } });
  assert.equal(normalizeCalls, 2);
  assert.equal(normalizedConfig(replaced), replaced);
  assert.equal(normalizeCalls, 2);
  // alreadyNormalized install still bumps generation but skips normalize().
  const seeded = { room: { name: "C" }, _n: 99 };
  const adopted = installRoomConfig(seeded, { alreadyNormalized: true });
  assert.equal(adopted, seeded);
  assert.equal(normalizeCalls, 2, "alreadyNormalized must not call normalize");
  assert.equal(normalizedConfig(seeded), seeded);
  assert.equal(normalizeCalls, 2);
});

test("F1+F7: config write paths installRoomConfig (not raw memory().config =)", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/actions-config.ts", import.meta.url), "utf8");
  assert.equal((src.match(/memory\(\)\.config\s*=/g) || []).length, 0, "actions-config must not assign memory().config raw");
  assert.match(src, /installRoomConfig\s*\(\s*nextConfig\s*\)/);
  assert.match(src, /installRoomConfig\s*\(\s*emptyRoomConfig/);
  assert.match(src, /installRoomConfig\s*\(\s*config\s*,\s*\{\s*alreadyNormalized:\s*true\s*\}\s*\)/);
  assert.match(src, /normalizedConfig\s*\(\s*memory\(\)\.config\s*\)/);
});

test("F5: panel refresh skips setSnap when panel fingerprint unchanged", () => {
  const src = fs.readFileSync(new URL("../src/components/panel/control-panel.tsx", import.meta.url), "utf8");
  assert.match(src, /panelSnapFingerprint/);
  assert.match(src, /snapFp\.current/);
  assert.match(src, /if\s*\(\s*fp\s*!==\s*snapFp\.current\s*\)/);
  // Must not unconditionally setSnap(next) on every poll anymore.
  assert.doesNotMatch(src, /setLoadErr\(null\);\s*setSnap\(next\);/);
});

test("F5: panelSnapFingerprint ignores process/log noise; reacts to vars/host/config", async () => {
  const { panelSnapFingerprint, samePanelSnap } = await import("../src/lib/control/panel-snap.ts");
  const base = {
    config: { room: { name: "A" }, pages: [], devices: [], macros: [], variables: [], schedules: [], monitors: [] },
    drivers: {},
    library: {},
    state: {},
    vars: { volume: 10 },
    health: {},
    log: [{ id: "1" }],
    traces: {},
    monitorStatus: {},
    latches: {},
    lastError: null,
    runningMacro: null,
    activeScene: null,
    host: { dim: false, locked: false, toast: null, block: null, pageId: null },
    process: { pid: 1, uptimeSec: 1 },
  };
  const noisy = {
    ...base,
    log: [{ id: "2" }, { id: "3" }],
    process: { pid: 1, uptimeSec: 999 },
    traces: { d: [{ at: 1 }] },
    drivers: { x: {} },
    version: "changed",
  };
  assert.equal(panelSnapFingerprint(base), panelSnapFingerprint(noisy), "poll noise must not change fingerprint");
  assert.equal(samePanelSnap(base, noisy), true);

  const varsChanged = { ...base, vars: { volume: 11 } };
  assert.notEqual(panelSnapFingerprint(base), panelSnapFingerprint(varsChanged));
  assert.equal(samePanelSnap(base, varsChanged), false);

  const hostChanged = {
    ...base,
    host: { ...base.host, toast: "hi", toastAt: 1 },
  };
  assert.notEqual(panelSnapFingerprint(base), panelSnapFingerprint(hostChanged));

  const pageChanged = {
    ...base,
    config: {
      ...base.config,
      pages: [{ id: "home", widgets: [{ id: "w1" }] }],
    },
  };
  assert.notEqual(panelSnapFingerprint(base), panelSnapFingerprint(pageChanged));
});


test("F14: /api/room rate-limit Map drops idle IP/token keys", async () => {
  const { roomRateLimited, roomRateLimitSize, roomRateLimitReset } = await import("../src/lib/control/room-rate-limit.ts");
  roomRateLimitReset();
  const t0 = 1_000_000;
  assert.equal(roomRateLimited("ip-a", t0), false);
  assert.equal(roomRateLimited("token-b", t0 + 100), false);
  assert.equal(roomRateLimitSize(), 2);
  // Past both keys' 10s windows — pruneIdle must drop them when a new key arrives.
  assert.equal(roomRateLimited("ip-c", t0 + 10_101), false);
  assert.equal(roomRateLimitSize(), 1, "idle keys must be evicted with the window");
  assert.equal(roomRateLimited("ip-c", t0 + 10_102), false);
  assert.equal(roomRateLimitSize(), 1);
  roomRateLimitReset();
});

test("F8: sACN retain drops removed device slots/seq; keeps live", async () => {
  const {
    sendSacnCommand,
    clearSacnSlotBuffers,
    retainSacnCidKeys,
    sacnMapSizes,
    peekSacnSlots,
  } = await import("../src/lib/control/sacn.ts");
  clearSacnSlotBuffers();
  retainSacnCidKeys([]); // also drop seq counters left by earlier suites
  await sendSacnCommand({ universe: 1, slot: 1, value: 10, cidKey: "dev-live" });
  await sendSacnCommand({ universe: 2, slot: 1, value: 20, cidKey: "dev-gone" });
  assert.equal(sacnMapSizes().slots, 2);
  assert.equal(sacnMapSizes().seq, 2);
  retainSacnCidKeys(["dev-live"]);
  assert.equal(sacnMapSizes().slots, 1);
  assert.equal(sacnMapSizes().seq, 1);
  const live = peekSacnSlots({ universe: 1, cidKey: "dev-live" });
  assert.ok(live);
  assert.equal(live[0], 10);
  assert.equal(peekSacnSlots({ universe: 2, cidKey: "dev-gone" }), undefined);
  clearSacnSlotBuffers();
});

test("F8: pace retain drops removed device tails; idle prune drops stale", async () => {
  const {
    paceDevice,
    retainPaceDevices,
    pruneIdlePaceDevices,
    paceMapSizes,
    forgetPaceDevice,
  } = await import("../src/lib/control/engine-wire.ts");
  const live = `pace-live-${Date.now()}`;
  const gone = `pace-gone-${Date.now()}`;
  const stale = `pace-stale-${Date.now()}`;
  await paceDevice(live, 10);
  await paceDevice(gone, 10);
  await paceDevice(stale, 10);
  assert.ok(paceMapSizes().clock >= 3);
  retainPaceDevices([live]);
  assert.ok(paceMapSizes().clock >= 1);
  // gone/stale not retained → dropped immediately
  await paceDevice(live, 10); // still works for live
  await paceDevice(stale, 10);
  const beforeIdle = paceMapSizes().clock;
  assert.ok(beforeIdle >= 2, "stale recreated until idle prune");
  pruneIdlePaceDevices(Date.now() + 31 * 60_000, 30 * 60_000);
  // everything idle relative to future now is dropped
  assert.equal(paceMapSizes().clock, 0);
  forgetPaceDevice(live);
  forgetPaceDevice(gone);
  forgetPaceDevice(stale);
});

test("F8: installRoomConfig prunes runtime Maps (source contract)", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
  assert.match(src, /function pruneRuntimeMaps\s*\(/);
  assert.match(src, /retainPaceDevices\s*\(/);
  assert.match(src, /retainSacnCidKeys\s*\(/);
  assert.match(src, /pruneIdlePaceDevices\s*\(/);
  assert.match(src, /pruneMonitorMaps\s*\(\s*config\s*\)/);
  assert.match(src, /bindNormalizeInstallDeps\s*\(\s*\{\s*memory,\s*pruneRuntimeMaps\s*\}\s*\)/);
  const leaf = fs.readFileSync(new URL("../src/lib/control/store-normalize.ts", import.meta.url), "utf8");
  const install = leaf.match(/export function installRoomConfig\([\s\S]*?\n\}/);
  assert.ok(install, "installRoomConfig body");
  assert.match(install[0], /installDeps\.pruneRuntimeMaps\s*\(\s*next\s*\)/);
  const monitors = fs.readFileSync(new URL("../src/lib/control/store-monitors.ts", import.meta.url), "utf8");
  assert.match(monitors, /export function pruneMonitorMaps\s*\(/);
  assert.match(monitors, /lastMonitorRun\.delete/);
  assert.match(monitors, /goodPolls\.delete/);
});

test("F14: room route uses roomRateLimited helper (idle eviction)", () => {
  const src = fs.readFileSync(new URL("../src/routes/api/room.ts", import.meta.url), "utf8");
  assert.match(src, /roomRateLimited/);
  assert.match(src, /from\s+[\"']@\/lib\/control\/room-rate-limit[\"']/);
  assert.doesNotMatch(src, /const hits = new Map/);
});


test("F11: WidgetType drops toggle; normalize coerces legacy toggle → button", () => {
  const types = fs.readFileSync(new URL("../src/lib/control/types.ts", import.meta.url), "utf8");
  const typeLine = types.match(/export type WidgetType = [^;]+;/);
  assert.ok(typeLine, "WidgetType export");
  assert.doesNotMatch(typeLine[0], /"toggle"/);
  assert.match(typeLine[0], /"button"/);

  const status = fs.readFileSync(new URL("../src/lib/control/status-widget.ts", import.meta.url), "utf8");
  assert.match(status, /export function coerceLegacyWidgetType/);
  assert.match(status, /type === "toggle"/);
  assert.match(status, /type: "button"/);

  const store = fs.readFileSync(new URL("../src/lib/control/store-normalize.ts", import.meta.url), "utf8");
  assert.match(store, /normalizeStatusFields\s*\(\s*coerceLegacyWidgetType\s*\(\s*widget\s*\)\s*\)/);

  const arch = fs.readFileSync(new URL("../ARCHITECTURE.md", import.meta.url), "utf8");
  const widgetRow = arch.match(/\| Widget \|[^\n]+/);
  assert.ok(widgetRow, "ARCHITECTURE Widget row");
  assert.doesNotMatch(widgetRow[0], /`toggle`/);
  assert.match(widgetRow[0], /`button`/);
  assert.match(widgetRow[0], /`preview`/);
});

test("F15: ARCHITECTURE.md and CONTEXT.md match package.json version", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const ver = pkg.version;
  assert.ok(ver, "package.json version");
  const arch = fs.readFileSync(new URL("../ARCHITECTURE.md", import.meta.url), "utf8");
  const ctx = fs.readFileSync(new URL("../CONTEXT.md", import.meta.url), "utf8");
  assert.match(arch, new RegExp(`Relay \\*\\*${ver.replace(/\./g, "\\.")}\\*\\* \\(beta\\)`));
  assert.match(ctx, new RegExp(`Relay \\*\\*${ver.replace(/\./g, "\\.")}\\*\\* \\(beta\\)`));
  assert.match(ctx, new RegExp(`still true at ${ver.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(arch, /0\.9\.38/);
  assert.doesNotMatch(ctx, /0\.9\.38/);
});

test("F6: runDueMonitors groups by device and uses bounded mapPool", () => {
  const barrel = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
  assert.match(barrel, /export \{\s*runDueMonitors,\s*applyDueMonitor,\s*pruneMonitorMaps\s*\}/);
  assert.equal(/async function runDueMonitors\(/.test(barrel), false);
  const src = fs.readFileSync(new URL("../src/lib/control/store-monitors.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function runDueMonitors()");
  assert.ok(start >= 0, "runDueMonitors present on monitors leaf");
  const body = src.slice(start);
  assert.match(body, /groupMonitorRulesByDevice\s*\(\s*due\s*\)/);
  assert.match(body, /mapPool\s*\(\s*groups\s*,\s*MONITOR_DEVICE_CONCURRENCY/);
  assert.match(body, /for\s*\(\s*const rule of rules\s*\)/);
  assert.match(body, /applyDueMonitor/);
  // I/O must not live in runDueMonitors itself (serial flat await); applyDueMonitor owns readMonitorValue.
  assert.doesNotMatch(body, /readMonitorValue/);
  assert.match(src, /from\s+[\"']\.\/monitor-pool[\"']/);
  const pool = fs.readFileSync(new URL("../src/lib/control/monitor-pool.ts", import.meta.url), "utf8");
  assert.match(pool, /MONITOR_DEVICE_CONCURRENCY\s*=\s*4/);
  assert.match(pool, /export async function mapPool/);
  assert.match(pool, /export function groupMonitorRulesByDevice/);
});

test("F6: group by device keeps same-device serial; mapPool bounds cross-device", async () => {
  const { groupMonitorRulesByDevice, mapPool, MONITOR_DEVICE_CONCURRENCY, monitorDeviceKey } = await import(
    "../src/lib/control/monitor-pool.ts"
  );
  assert.equal(MONITOR_DEVICE_CONCURRENCY, 4);
  assert.equal(monitorDeviceKey({ id: "m1", device: "pj1" }), "pj1");
  assert.equal(monitorDeviceKey({ id: "m2", device: "", interfaceId: "serial-a" }), "iface:serial-a");

  const rules = [
    { id: "a1", device: "A" },
    { id: "b1", device: "B" },
    { id: "a2", device: "A" },
    { id: "c1", device: "C" },
  ];
  const groups = groupMonitorRulesByDevice(rules);
  assert.equal(groups.length, 3);
  const byDev = Object.fromEntries(groups.map((g) => [g[0].device, g.map((r) => r.id)]));
  assert.deepEqual(byDev.A, ["a1", "a2"]);
  assert.deepEqual(byDev.B, ["b1"]);
  assert.deepEqual(byDev.C, ["c1"]);

  // Protocol: same-device rules run strictly serial; distinct devices overlap under the pool.
  const active = new Map();
  const maxActiveByDevice = new Map();
  let peakGlobal = 0;
  let globalActive = 0;
  const started = [];

  await mapPool(groups, MONITOR_DEVICE_CONCURRENCY, async (group) => {
    for (const rule of group) {
      const dev = rule.device;
      globalActive += 1;
      peakGlobal = Math.max(peakGlobal, globalActive);
      active.set(dev, (active.get(dev) ?? 0) + 1);
      maxActiveByDevice.set(dev, Math.max(maxActiveByDevice.get(dev) ?? 0, active.get(dev)));
      started.push(`${dev}:${rule.id}:${Date.now()}`);
      await new Promise((r) => setTimeout(r, 40));
      active.set(dev, active.get(dev) - 1);
      globalActive -= 1;
    }
  });

  assert.equal(maxActiveByDevice.get("A"), 1, "same-device must stay serial");
  assert.equal(maxActiveByDevice.get("B"), 1);
  assert.equal(maxActiveByDevice.get("C"), 1);
  assert.ok(peakGlobal >= 2, `cross-device should overlap (peak=${peakGlobal})`);
  assert.ok(peakGlobal <= MONITOR_DEVICE_CONCURRENCY, `peak ${peakGlobal} exceeds pool`);
  assert.equal(started.length, 4);
});
