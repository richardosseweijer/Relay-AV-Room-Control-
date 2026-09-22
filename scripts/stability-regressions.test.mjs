import assert from "node:assert/strict";
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
