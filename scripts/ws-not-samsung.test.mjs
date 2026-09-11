import test from "node:test";
import assert from "node:assert/strict";
import { buildWsTarget } from "../src/lib/control/ws.ts";

test("dummy websocket target is not Samsung", () => {
  const t = buildWsTarget({ path: "/echo", port: 9, query: { n: "x" } });
  assert.equal(t.port, 9);
  assert.equal(t.tls, false);
  assert.match(t.path, /^\/echo\?/);
  assert.doesNotMatch(t.path, /samsung\.remote\.control/);
  assert.ok(!String(t.port).includes("8002"));
  assert.match(t.path, /n=x/);
});

test("file: path is not used as a socket path", () => {
  const t = buildWsTarget({ path: "file:///etc/passwd", port: 9, query: { n: "1" } });
  assert.equal(t.path.startsWith("file:"), false);
});
