import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import {
  packAppleMidi,
  unpackAppleMidi,
  packCk,
  unpackCk,
  wrapRtpMidi,
  unwrapRtpMidi,
  dropSession,
  sessionKey,
  rtpMidiPoolSize,
  ensureAppleMidi,
  sendRtpMidiCommand,
} from "../src/lib/control/rtp-midi.ts";

test("AppleMIDI IN/OK token and SSRC round-trip", () => {
  const packed = packAppleMidi({ cmd: "IN", initiator: 0x11223344, ssrc: 0xaabbccdd, name: "Relay" });
  const got = unpackAppleMidi(packed);
  assert.equal(got?.cmd, "IN");
  assert.equal(got?.initiator, 0x11223344);
  assert.equal(got?.ssrc, 0xaabbccdd);
  assert.equal(got?.name, "Relay");
  const ok = unpackAppleMidi(packAppleMidi({ cmd: "OK", initiator: 1, ssrc: 2, name: "desk" }));
  assert.equal(ok?.cmd, "OK");
  assert.equal(unpackAppleMidi(Buffer.from([0xff])), null);
  assert.equal(unpackAppleMidi(Buffer.alloc(16, 0)), null);
});

test("CK count 0/1/2 pack/unpack", () => {
  const ts = [10n, 20n, 30n];
  for (const count of [0, 1, 2]) {
    const got = unpackCk(packCk({ ssrc: 7, count, timestamps: ts }));
    assert.equal(got?.ssrc, 7);
    assert.equal(got?.count, count);
    assert.deepEqual(got?.timestamps, ts);
  }
  assert.equal(unpackCk(Buffer.alloc(20)), null);
});

test("wrapRtpMidi note-on 3 bytes; reject empty", () => {
  const midi = Buffer.from([0x90, 0x3c, 0x40]);
  const buf = wrapRtpMidi(0x12345678, 1, midi);
  assert.equal(buf[0], 0x80);
  assert.equal(buf[12], 3);
  assert.deepEqual([...buf.subarray(13, 16)], [0x90, 0x3c, 0x40]);
  assert.deepEqual([...unwrapRtpMidi(buf)], [0x90, 0x3c, 0x40]);
  assert.throws(() => wrapRtpMidi(1, 1, Buffer.alloc(0)), /empty/);
});

test("dropSession on missing key is a no-op", () => {
  const before = rtpMidiPoolSize();
  dropSession("no-such-session");
  assert.equal(rtpMidiPoolSize(), before);
});

test("ensureAppleMidi times out without a peer (200ms cap)", async () => {
  const t0 = Date.now();
  const res = await ensureAppleMidi({ host: "10.255.255.254", controlPort: 5004, timeoutMs: 200 });
  const dt = Date.now() - t0;
  assert.equal(res.ok, false);
  assert.match(res.message, /timeout/i);
  assert.ok(dt < 1500, `hung ${dt}ms`);
});

test("ensureAppleMidi session + wrap send against a local OK peer", async () => {
  const peer = dgram.createSocket("udp4");
  await new Promise((resolve) => peer.bind(0, "127.0.0.1", resolve));
  const port = peer.address().port;
  peer.on("message", (msg, rinfo) => {
    const cmd = unpackAppleMidi(msg);
    if (cmd?.cmd === "IN") {
      peer.send(packAppleMidi({ cmd: "OK", initiator: cmd.initiator, ssrc: 99, name: "desk" }), rinfo.port, rinfo.address);
    }
    const ck = unpackCk(msg);
    if (ck?.count === 0) {
      peer.send(packCk({ ssrc: 99, count: 1, timestamps: [ck.timestamps[0], 1n, 0n] }), rinfo.port, rinfo.address);
    }
  });
  const up = await ensureAppleMidi({ host: "127.0.0.1", controlPort: port, dataPort: port, timeoutMs: 400, keepMs: 500 });
  assert.equal(up.ok, true);
  assert.ok(rtpMidiPoolSize() >= 1);
  const sent = await sendRtpMidiCommand({
    host: "127.0.0.1",
    controlPort: port,
    dataPort: port,
    midi: Buffer.from([0x90, 0x3c, 0x40]),
    timeoutMs: 400,
    keepMs: 500,
  });
  assert.equal(sent.ok, true);
  dropSession(sessionKey("127.0.0.1", port));
  assert.equal(rtpMidiPoolSize(), 0);
  peer.close();
});
