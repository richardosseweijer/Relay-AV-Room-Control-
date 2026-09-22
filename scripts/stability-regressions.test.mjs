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
  const src = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
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
  const src = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
  // Persist body must publicConfig(normalizedConfig(...)), not publicConfig(normalize(...)).
  assert.match(src, /publicConfig\s*\(\s*normalizedConfig\s*\(\s*mem\.config\s*\)\s*\)/);
  assert.doesNotMatch(src, /publicConfig\s*\(\s*normalize\s*\(\s*mem\.config\s*\)\s*\)/);
});

test("F1+F7: installRoomConfig bumps generation; memo hits on same identity", () => {
  const src = fs.readFileSync(new URL("../src/lib/control/store.server.ts", import.meta.url), "utf8");
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
