import test from "node:test";
import assert from "node:assert/strict";
import { encodeOsc, sendOscCommand } from "../src/lib/control/osc.ts";

test("encodeOsc /ping has path and empty type tag, 4-byte aligned", () => {
  const buf = encodeOsc("/ping", []);
  assert.equal(buf.length % 4, 0);
  const text = buf.toString("utf8");
  assert.ok(text.startsWith("/ping"));
  assert.ok(text.includes(","));
  assert.equal(buf.length, 12);
});

test("encodeOsc /ch/1/mix/on ,i 1", () => {
  const buf = encodeOsc("/ch/1/mix/on", [{ type: "i", value: 1 }]);
  assert.equal(buf.length % 4, 0);
  const path = buf.subarray(0, 16).toString("utf8").replace(/\0+$/, "");
  assert.equal(path, "/ch/1/mix/on");
  const tags = buf.subarray(16, 20).toString("utf8").replace(/\0+$/, "");
  assert.equal(tags, ",i");
  assert.equal(buf.readInt32BE(20), 1);
});

test("encodeOsc rejects a path without /", () => {
  assert.throws(() => encodeOsc("ping", []), /start with \//);
});

test("sendOscCommand rejects types/values length mismatch", async () => {
  const res = await sendOscCommand({ host: "127.0.0.1", port: 9000, path: "/x", types: "f", values: [] });
  assert.equal(res.ok, false);
});

test("ChatGPT #3: OSC {value} template receives provided number (not empty→0)", async () => {
  const { renderPayload } = await import("../src/lib/control/engine-payload.ts");
  // Bug mode: undefined → "" → Number("") → 0 float
  assert.equal(renderPayload("{value}", undefined), "");
  assert.equal(Number(""), 0);
  const rendered = renderPayload("{value}", 0.75);
  assert.equal(rendered, "0.75");
  const buf = encodeOsc("/ch/1/mix/fader", [{ type: "f", value: rendered }]);
  assert.equal(buf.subarray(0, 16).toString("utf8").replace(/\0+$/, ""), "/ch/1/mix/fader");
  assert.equal(buf.subarray(16, 20).toString("utf8").replace(/\0+$/, ""), ",f");
  const f = buf.readFloatBE(20);
  assert.ok(Math.abs(f - 0.75) < 1e-5, `expected 0.75 got ${f}`);
});
