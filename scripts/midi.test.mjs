import test from "node:test";
import assert from "node:assert/strict";
import { midiHexOk, midiPortOk, sendUsbMidi } from "../src/lib/control/midi.ts";

test("midiPortOk allowlists hw ports", () => {
  assert.equal(midiPortOk("hw:1,0,0"), true);
  assert.equal(midiPortOk("hw:0,0,0"), true);
  assert.equal(midiPortOk("virtual:foo"), true);
  assert.equal(midiPortOk("hw:1;rm -rf /"), false);
  assert.equal(midiPortOk(""), false);
});

test("midiHexOk even hex max 64 bytes", () => {
  assert.equal(midiHexOk("90 3c 40"), "903C40");
  assert.equal(midiHexOk("90 3c"), "903C");
  assert.equal(midiHexOk("9"), null);
  assert.equal(midiHexOk("aa".repeat(65)), null);
});

test("midiPortOk rejects device paths with slashes", () => {
  assert.equal(midiPortOk("/dev/snd/midiC1D0"), false);
  assert.equal(midiPortOk("hw:1,0,0"), true);
});

test("sendUsbMidi rejects COM1 and odd hex", async () => {
  const a = await sendUsbMidi({ port: "COM1", payload: "903C40" });
  assert.equal(a.ok, false);
  const b = await sendUsbMidi({ port: "hw:1,0,0", payload: "9" });
  assert.equal(b.ok, false);
});
