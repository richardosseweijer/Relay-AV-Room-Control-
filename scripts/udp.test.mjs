import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { isMulticastV4, sendUdp, sendUdpMulticast, listenUdpMulticast } from "../src/lib/control/udp.ts";

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

test("listenUdpMulticast rejects unicast dest", async () => {
  const res = await listenUdpMulticast({ group: "10.0.0.20", port: 21928, onMessage: () => undefined });
  assert.equal("error" in res, true);
});
