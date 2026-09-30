import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import {
  dropUdpSeq,
  packUdpSeq,
  sendUdpSeq,
  udpSeqOpening,
  UDP_SEQ_ACK,
  UDP_SEQ_DATA,
  UDP_SEQ_HELLO,
  UDP_SEQ_OK,
  unpackUdpSeqAll,
} from "../src/lib/control/udp-seq.ts";
import { setUdpPushHandler } from "../src/lib/control/udp-hold.ts";

function peer() {
  const recv = dgram.createSocket("udp4");
  const packets = [];
  let last = null;
  let onData = () => undefined;
  recv.on("message", (msg, rinfo) => {
    last = rinfo;
    for (const parsed of unpackUdpSeqAll(msg)) {
      packets.push(parsed);
      if (parsed.type === UDP_SEQ_HELLO) {
        recv.send(packUdpSeq({ type: UDP_SEQ_OK, sessionId: parsed.sessionId, seq: 0, ack: 0 }), rinfo.port, rinfo.address);
      } else if (parsed.type === UDP_SEQ_DATA) {
        onData(parsed, rinfo);
      }
    }
  });
  return {
    recv,
    packets,
    port: () => recv.address().port,
    last: () => last,
    setOnData(fn) { onData = fn; },
    async bind() {
      await new Promise((resolve) => recv.bind(0, "127.0.0.1", resolve));
      return recv.address().port;
    },
    close() {
      try { recv.close(); } catch { /* ignore */ }
    },
  };
}

async function until(pred, ms = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("length prefix keeps the next frame when the first is unknown", () => {
  const a = packUdpSeq({ type: UDP_SEQ_DATA, sessionId: 7, seq: 4, ack: 0, payload: Buffer.from("nope") });
  const b = packUdpSeq({ type: UDP_SEQ_DATA, sessionId: 7, seq: 5, ack: 2, payload: Buffer.from("yes") });
  const all = unpackUdpSeqAll(Buffer.concat([a, b, Buffer.from("trailing")]));
  assert.equal(all.length, 2);
  assert.equal(all[0].payload.toString(), "nope");
  assert.equal(all[1].seq, 5);
  assert.equal(all[1].ack, 2);
  assert.equal(all[1].payload.toString(), "yes");
  assert.equal(unpackUdpSeqAll(Buffer.from("nope")).length, 0);
});

test("udp-seq opening is empty without connect bytes, including hex drivers", () => {
  const empty = udpSeqOpening(undefined, "hex");
  assert.ok(Buffer.isBuffer(empty));
  assert.equal(empty.length, 0);
  const hex = udpSeqOpening("b026", "hex");
  assert.ok(Buffer.isBuffer(hex));
  assert.equal(hex.toString("hex"), "b026");
  const bad = udpSeqOpening("abc", "hex");
  assert.equal("error" in bad, true);
});

test("sequenced session handshakes once, counts payloads, acks, resends once, and skips an unknown inner message", async () => {
  const box = peer();
  const key = "seq-order";
  let releaseAck = () => undefined;
  const gate = new Promise((resolve) => { releaseAck = resolve; });
  try {
    const port = await box.bind();
    box.setOnData((parsed, rinfo) => {
      const body = parsed.payload.toString();
      if (body === "one") {
        const seen = box.packets.filter((row) => row.type === UDP_SEQ_DATA && row.payload.toString() === "one").length;
        if (seen === 1) return;
        void gate.then(() => {
          box.recv.send(packUdpSeq({ type: UDP_SEQ_ACK, sessionId: parsed.sessionId, seq: 0, ack: parsed.seq }), rinfo.port, rinfo.address);
        });
        return;
      }
      if (body === "two") {
        const unknown = packUdpSeq({ type: UDP_SEQ_DATA, sessionId: parsed.sessionId, seq: 9, ack: 0, payload: Buffer.from("nope") });
        const yes = packUdpSeq({ type: UDP_SEQ_DATA, sessionId: parsed.sessionId, seq: 10, ack: parsed.seq, payload: Buffer.from("yes") });
        box.recv.send(Buffer.concat([unknown, yes]), rinfo.port, rinfo.address);
      }
    });
    const first = sendUdpSeq({
      key, host: "127.0.0.1", port, payload: Buffer.from("one"), hello: Buffer.from("hi"),
      timeoutMs: 180, keepMs: 2000, reply: false,
    });
    const second = sendUdpSeq({
      key, host: "127.0.0.1", port, payload: Buffer.from("two"), hello: Buffer.from("hi"),
      timeoutMs: 400, keepMs: 2000, reply: true,
    });
    await until(() => {
      const ones = box.packets.filter((row) => row.type === UDP_SEQ_DATA && row.payload.toString() === "one");
      const twos = box.packets.filter((row) => row.type === UDP_SEQ_DATA && row.payload.toString() === "two");
      return ones.length >= 2 && twos.length === 0;
    });
    releaseAck();
    const a = await first;
    const b = await second;
    assert.equal(a.ok, true);
    assert.equal(a.message, "ok");
    assert.equal(b.ok, true);
    assert.equal(b.message, "yes");
    const hellos = box.packets.filter((row) => row.type === UDP_SEQ_HELLO);
    assert.equal(hellos.length, 1);
    const data = box.packets.filter((row) => row.type === UDP_SEQ_DATA);
    assert.equal(data[0].payload.toString(), "one");
    assert.equal(data[1].payload.toString(), "one");
    assert.equal(data[0].seq, data[1].seq);
    assert.equal(data[2].payload.toString(), "two");
    assert.equal(data[2].seq, (data[0].seq + 1) >>> 0);
    await until(() => box.packets.some((row) => row.type === UDP_SEQ_ACK && row.ack === 9));
    let pushed = "";
    setUdpPushHandler((_id, buf) => { pushed = buf.toString(); });
    const from = box.last();
    box.recv.send(packUdpSeq({
      type: UDP_SEQ_DATA,
      sessionId: hellos[0].sessionId,
      seq: 11,
      ack: 0,
      payload: Buffer.from("status"),
    }), from.port, from.address);
    await until(() => pushed === "status");
  } finally {
    setUdpPushHandler(undefined);
    dropUdpSeq(key);
    box.close();
  }
});

test("a quiet peer ends the session and the next command handshakes a new id", async () => {
  const box = peer();
  const key = "seq-quiet";
  try {
    const port = await box.bind();
    const first = await sendUdpSeq({
      key, host: "127.0.0.1", port, payload: Buffer.from("one"), hello: Buffer.from("hi"),
      timeoutMs: 40, keepMs: 5000, reply: true,
    });
    assert.equal(first.ok, false);
    assert.equal(first.message, "timeout");
    const second = sendUdpSeq({
      key, host: "127.0.0.1", port, payload: Buffer.from("two"), hello: Buffer.from("hi"),
      timeoutMs: 40, keepMs: 5000, reply: false,
    });
    await until(() => box.packets.filter((row) => row.type === UDP_SEQ_HELLO).length >= 2);
    second.then(() => undefined, () => undefined);
    const hellos = box.packets.filter((row) => row.type === UDP_SEQ_HELLO);
    assert.equal(hellos.length >= 2, true);
    assert.notEqual(hellos[0].sessionId, hellos[1].sessionId);
    const data = box.packets.filter((row) => row.type === UDP_SEQ_DATA && row.payload.toString() === "one");
    assert.equal(data.length >= 2, true);
    assert.equal(data[0].seq, data[1].seq);
    await second;
  } finally {
    dropUdpSeq(key);
    box.close();
  }
});
