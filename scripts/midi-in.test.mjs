import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMidi,
  applyMidiWatch,
  pushMtcQf,
  parseMtcSysex,
  encodeMtcQf,
  encodeMtcSysex,
  onMidiBytes,
} from "../src/lib/control/midi-in.ts";

test("parseMidi note-on, running status, stray FE ignored", () => {
  const a = parseMidi(Buffer.from([0x90, 0x3c, 0x40]));
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, "note");
  assert.equal(a[0].channel, 1);
  assert.equal(a[0].data1, 0x3c);
  assert.equal(a[0].data2, 0x40);
  const b = parseMidi(Buffer.from([0x90, 0x3c, 0x40, 0x3d, 0x41]));
  assert.equal(b.length, 2);
  assert.equal(b[1].data1, 0x3d);
  const c = parseMidi(Buffer.from([0xfe, 0x90, 0x3c, 0x40]));
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "note");
});

test("applyMidiWatch CC7 ch1 and ignores wrong channel", () => {
  const watch = [
    { kind: "cc", channel: 1, controller: 7, feedback: "level.value" },
  ];
  const hits = applyMidiWatch(watch, { kind: "cc", channel: 1, data1: 7, data2: 64 });
  assert.deepEqual(hits, [{ feedback: "level.value", value: "64" }]);
  const miss = applyMidiWatch(watch, { kind: "cc", channel: 2, data1: 7, data2: 64 });
  assert.equal(miss.length, 0);
});

test("MTC quarter-frame assembler needs all eight QF", () => {
  const id = "mtc-a";
  const nibbles = [0x0b, 0, 0x0b, 0, 0x0b, 0, 0x01, 0];
  for (let i = 0; i < 7; i++) assert.equal(pushMtcQf(id, (i << 4) | nibbles[i]), null);
  assert.equal(pushMtcQf(id, (7 << 4) | nibbles[7]), "01:11:11:11");
});

test("SysEx full-frame MTC", () => {
  const buf = Buffer.from([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x01, 0x02, 0x03, 0x04, 0xf7]);
  assert.equal(parseMtcSysex(buf), "01:02:03:04");
  const msgs = parseMidi(buf);
  assert.equal(msgs[0]?.kind, "mtc");
  assert.equal(msgs[0]?.time, "01:02:03:04");
});

test("encodeMtcQf / sysex round-trip HH:MM:SS:FF", () => {
  const qf = encodeMtcQf("01:02:03:04");
  assert.ok(qf);
  assert.equal(qf.length, 16);
  const syx = encodeMtcSysex("01:02:03:04");
  assert.equal(parseMtcSysex(syx), "01:02:03:04");
  assert.equal(encodeMtcQf("bad"), null);
});

test("onMidiBytes writes watch feedback into state", () => {
  const state = {};
  const watch = [
    { kind: "cc", channel: 1, controller: 7, feedback: "level.value" },
    { kind: "mtc", feedback: "mtc.time" },
  ];
  const hits = onMidiBytes("dev1", Buffer.from([0xb0, 0x07, 0x40]), watch, state);
  assert.equal(hits[0]?.value, "64");
  assert.equal(state.dev1["level.value"], "64");
});
