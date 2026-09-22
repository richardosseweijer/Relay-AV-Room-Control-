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
