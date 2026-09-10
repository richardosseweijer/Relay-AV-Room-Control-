import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fetchTextBounded } from "../src/lib/control/http-client.ts";
import { TriggerReservations } from "../src/lib/control/logic-policy.ts";

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
  const result = await fetchTextBounded(`http://127.0.0.1:${address.port}`, { method: "GET" }, 50).catch((error) => ({ ok: false, text: String(error) }));
  assert.equal(result.ok, false);
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
