import test from "node:test";
import assert from "node:assert/strict";
import { encodeSacn, sacnGroup, cidFrom, sendSacnCommand, peekSacnSlots, clearSacnSlotBuffers } from "../src/lib/control/sacn.ts";

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

test("ChatGPT #4: successive channel writes preserve prior slots in full frame", async () => {
  clearSacnSlotBuffers();
  const cidKey = "chatgpt4-universe-buffer";
  const universe = 7;

  const r1 = await sendSacnCommand({ universe, slot: 1, value: 255, cidKey });
  assert.equal(r1.ok, true);
  const afterCh1 = peekSacnSlots({ universe, cidKey });
  assert.ok(afterCh1);
  assert.equal(afterCh1[0], 255);
  assert.equal(afterCh1[1], 0);

  const r2 = await sendSacnCommand({ universe, slot: 2, value: 128, cidKey });
  assert.equal(r2.ok, true);
  const afterCh2 = peekSacnSlots({ universe, cidKey });
  assert.ok(afterCh2);
  assert.equal(afterCh2[0], 255);
  assert.equal(afterCh2[1], 128);
  assert.equal(afterCh2[2], 0);

  const frame = encodeSacn({
    universe,
    priority: 100,
    cid: cidFrom(cidKey),
    sequence: 0,
    slots: afterCh2,
  });
  assert.equal(frame[126], 255);
  assert.equal(frame[127], 128);
  assert.notEqual(frame[126], 0);
});
