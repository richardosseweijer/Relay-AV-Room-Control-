import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { isMulticastV4, sendUdp, sendUdpMulticast, sendUdpReply, listenUdpMulticast } from "../src/lib/control/udp.ts";
import { dropUdpHold, sendUdpHeld, setUdpPushHandler, udpHoldPoolSize } from "../src/lib/control/udp-hold.ts";

test("isMulticastV4 accepts 224–239 only", () => {
  assert.equal(isMulticastV4("239.255.0.1"), true);
  assert.equal(isMulticastV4("224.0.0.1"), true);
  assert.equal(isMulticastV4("10.0.0.20"), false);
  assert.equal(isMulticastV4("192.168.1.1"), false);
  assert.equal(isMulticastV4("255.255.255.255"), false);
  assert.equal(isMulticastV4("not-an-ip"), false);
});

test("sendUdpMulticast rejects unicast dest", async () => {
  const res = await sendUdpMulticast({ group: "10.0.0.20", port: 5568, buf: Buffer.from("x") });
  assert.equal(res.ok, false);
  assert.match(res.message, /multicast/i);
});

test("sendUdp delivers a unicast datagram", async () => {
  const recv = dgram.createSocket("udp4");
  await new Promise((resolve) => recv.bind(0, "127.0.0.1", resolve));
  const port = recv.address().port;
  const got = new Promise((resolve) => recv.once("message", (msg) => resolve(msg.toString())));
  const res = await sendUdp("127.0.0.1", port, Buffer.from("ping"));
  assert.equal(res.ok, true);
  assert.equal(await got, "ping");
  recv.close();
});

test("sendUdp can bind localAddress 127.0.0.1", async () => {
  const recv = dgram.createSocket("udp4");
  await new Promise((resolve) => recv.bind(0, "127.0.0.1", resolve));
  const port = recv.address().port;
  const got = new Promise((resolve) => recv.once("message", (msg) => resolve(msg.toString())));
  const res = await sendUdp("127.0.0.1", port, Buffer.from("bind"), "127.0.0.1");
  assert.equal(res.ok, true);
  assert.equal(await got, "bind");
  recv.close();
});

test("listenUdpMulticast rejects unicast dest", async () => {
  const res = await listenUdpMulticast({ group: "10.0.0.20", port: 21928, onMessage: () => undefined });
  assert.equal("error" in res, true);
});

test("listenUdpMulticast fails closed when localAddress is not on host", async () => {
  const res = await listenUdpMulticast({
    group: "239.255.0.1",
    port: 51999,
    localAddress: "192.0.2.8",
    onMessage: () => undefined,
  });
  assert.equal("error" in res, true);
});

test("UDP reply returns the peer datagram and times out otherwise", async () => {
  const recv = dgram.createSocket("udp4");
  await new Promise((resolve) => recv.bind(0, "127.0.0.1", resolve));
  const port = recv.address().port;
  recv.on("message", (msg, rinfo) => {
    if (msg.toString() === "h") recv.send(Buffer.from([0xb0, 0x26, 0x01]), rinfo.port, rinfo.address);
    else recv.send(Buffer.from("42"), rinfo.port, rinfo.address);
  });
  const ok = await sendUdpReply({ host: "127.0.0.1", port, buf: Buffer.from("q"), timeoutMs: 400 });
  assert.equal(ok.ok, true);
  assert.equal(ok.message, "42");
  const hex = await sendUdpReply({ host: "127.0.0.1", port, buf: Buffer.from("h"), timeoutMs: 400, encoding: "hex" });
  assert.equal(hex.ok, true);
  assert.equal(hex.message, "b02601");
  recv.removeAllListeners("message");
  const missed = await sendUdpReply({ host: "127.0.0.1", port, buf: Buffer.from("q"), timeoutMs: 40 });
  assert.equal(missed.ok, false);
  assert.equal(missed.message, "timeout");
  recv.close();
});

test("held UDP socket shares a port, pushes an idle datagram, and closes after keepMs", async () => {
  const recv = dgram.createSocket("udp4");
  const key = "hold-test";
  try {
    await new Promise((resolve) => recv.bind(0, "127.0.0.1", resolve));
    const port = recv.address().port;
    const from = [];
    recv.on("message", (_msg, rinfo) => from.push(rinfo.port));
    const first = await sendUdpHeld({ key, host: "127.0.0.1", port, buf: Buffer.from("one"), keepMs: 80, timeoutMs: 200, reply: false });
    const second = await sendUdpHeld({ key, host: "127.0.0.1", port, buf: Buffer.from("two"), keepMs: 80, timeoutMs: 200, reply: false });
    assert.equal(first.ok, true);
    assert.equal(second.message, "udp sent");
    const seen = Date.now();
    while (from.length < 2 && Date.now() - seen < 500) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(from.length, 2);
    assert.equal(from[0], from[1]);
    let pushed = "";
    setUdpPushHandler((_id, buf) => { pushed = buf.toString(); });
    recv.send(Buffer.from("status"), from[0], "127.0.0.1");
    const pushAt = Date.now();
    while (pushed !== "status" && Date.now() - pushAt < 500) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(pushed, "status");
    assert.equal(udpHoldPoolSize() > 0, true);
    const idleAt = Date.now();
    while (udpHoldPoolSize() !== 0 && Date.now() - idleAt < 500) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(udpHoldPoolSize(), 0);
  } finally {
    setUdpPushHandler(undefined);
    dropUdpHold(key);
    try { recv.close(); } catch { /* ignore */ }
  }
});

test("idle datagram is push feedback for udp and osc, not a poll", async () => {
  const { applyUdpPush } = await import("../src/lib/control/midi-in.ts");
  const { encodeOsc } = await import("../src/lib/control/osc.ts");
  const udp = {
    transports: { lan: { protocol: "udp", encoding: "ascii" } },
    feedback: [
      { id: "power", mode: "push", parse: { type: "exact", value: "PWR1" } },
      { id: "poll", mode: "poll", parse: { type: "exact", value: "PWR1" } },
    ],
  };
  const state = {};
  applyUdpPush({ deviceId: "d1", driver: udp, buf: Buffer.from("PWR1"), state });
  assert.equal(state.d1.power, "PWR1");
  assert.equal(state.d1.poll, undefined);
  applyUdpPush({ deviceId: "d1", driver: udp, buf: Buffer.from("nope"), state });
  assert.equal(state.d1.power, "PWR1");
  const osc = {
    transports: { lan: { protocol: "osc" } },
    feedback: [{ id: "ready", mode: "push", parse: { type: "exact", value: "ready" } }],
  };
  const oscState = {};
  applyUdpPush({
    deviceId: "mix",
    driver: osc,
    buf: encodeOsc("/reply", [{ type: "s", value: "ready" }]),
    state: oscState,
  });
  assert.equal(oscState.mix.ready, "ready");
  applyUdpPush({ deviceId: "mix", driver: { ...osc, transports: { lan: { protocol: "tcp" } } }, buf: Buffer.from("PWR1"), state: oscState });
  assert.equal(oscState.mix.power, undefined);
});
