import test from "node:test";
import assert from "node:assert/strict";
import { encodeSacn, sacnGroup, cidFrom, sendSacnCommand } from "../src/lib/control/sacn.ts";

test("sacnGroup universe 1 and 12", () => {
  assert.equal(sacnGroup(1), "239.255.0.1");
  assert.equal(sacnGroup(12), "239.255.0.12");
});

test("encodeSacn is 638 bytes with universe at 113", () => {
  const slots = new Uint8Array(512);
  slots[0] = 255;
  const buf = encodeSacn({ universe: 12, priority: 100, cid: cidFrom("t"), sequence: 3, slots });
  assert.equal(buf.length, 638);
  assert.equal(buf.readUInt16BE(113), 12);
  assert.equal(buf[126], 255);
  assert.equal(buf[111], 3);
  assert.equal(buf.toString("ascii", 4, 16), "ASC-E1.17\0\0\0");
});

test("sendSacnCommand rejects universe 0", async () => {
  const res = await sendSacnCommand({ universe: 0, slot: 1, value: 1, cidKey: "x" });
  assert.equal(res.ok, false);
});

test("ChatGPT #3: sACN {value} template receives provided number (not empty→0)", async () => {
  const { renderPayload } = await import("../src/lib/control/engine-payload.ts");
  // Bug mode: undefined → "" → Number("") → 0 DMX
  assert.equal(renderPayload("{value}", undefined), "");
  assert.equal(Number(renderPayload("{value}", undefined)), 0);
  const rendered = renderPayload("{value}", 200);
  assert.equal(rendered, "200");
  const n = Number(rendered);
  assert.equal(n, 200);
  const slots = new Uint8Array(512);
  slots[0] = Math.max(0, Math.min(255, Math.trunc(n)));
  const buf = encodeSacn({ universe: 1, priority: 100, cid: cidFrom("t"), sequence: 1, slots });
  assert.equal(buf[126], 200);
});
