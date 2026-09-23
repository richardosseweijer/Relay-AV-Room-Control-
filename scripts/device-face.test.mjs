import test from "node:test";
import assert from "node:assert/strict";
import {
  readNicFace,
  planDeviceBind,
  planDeviceBindForDevice,
  nicFaceProtocolGate,
  deviceHostAllowed,
  DEVICE_VENUE_SKIP_OUTBOUND_NONE,
  DEVICE_VENUE_SKIP_NO_BIND,
  DEVICE_VENUE_SKIP_CLEARTEXT,
  DEVICE_VENUE_SKIP_INVENTORY_CLEARTEXT,
  DEVICE_VENUE_AV_ONLY,
  DEVICE_VENUE_SKIP_BAD_HOST,
} from "../src/lib/control/device-face.ts";
import { listLanNicsFrom, OUTBOUND_NONE_NAME } from "../src/lib/control/nics.ts";

const fixture = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp1s0: [{ address: "10.0.25.10", family: 4, internal: false, cidr: "10.0.25.10/24" }],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
};
const nics = listLanNicsFrom(fixture);
const avPick = { name: "enp1s0", index: 1 };
const outPick = { name: "enp2s0", index: 2 };

test("readNicFace defaults to av; accepts venue aliases", () => {
  assert.equal(readNicFace({}), "av");
  assert.equal(readNicFace({ nicFace: null }), "av");
  assert.equal(readNicFace({ nicFace: "av" }), "av");
  assert.equal(readNicFace({ nicFace: "outbound" }), "outbound");
  assert.equal(readNicFace({ nicFace: "venue" }), "outbound");
  assert.equal(readNicFace({ auth: { nicFace: "nic2" } }), "outbound");
});

test("planDeviceBind AV: AV localAddress", () => {
  const plan = planDeviceBind({ face: "av", nics, avPick, outboundPick: outPick });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.face, "av");
  assert.equal(plan.localAddress, "10.0.25.10");
  assert.equal(plan.rejectUnauthorized, true);
});

test("planDeviceBind outbound: venue bind + soft TLS", () => {
  const plan = planDeviceBind({ face: "outbound", nics, avPick, outboundPick: outPick });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.face, "outbound");
  assert.equal(plan.localAddress, "192.168.1.40");
  assert.equal(plan.rejectUnauthorized, false);
});

test("planDeviceBind outbound soft-skips when None", () => {
  const plan = planDeviceBind({
    face: "outbound",
    nics,
    avPick,
    outboundPick: { name: OUTBOUND_NONE_NAME, index: null },
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, DEVICE_VENUE_SKIP_OUTBOUND_NONE);
});

test("planDeviceBind outbound soft-skips when no IPv4", () => {
  const bare = listLanNicsFrom({
    enp1s0: [{ address: "10.0.25.10", family: 4, internal: false, cidr: "10.0.25.10/24" }],
    enp2s0: [{ address: "fe80::1", family: "IPv6", internal: false }],
  });
  const plan = planDeviceBind({
    face: "outbound",
    nics: bare,
    avPick: { name: "enp1s0" },
    outboundPick: { name: "enp2s0" },
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, DEVICE_VENUE_SKIP_NO_BIND);
});

test("planDeviceBindForDevice default av from room picks", () => {
  const plan = planDeviceBindForDevice(
    { nicFace: null },
    {
      room: {
        avLanNicName: "enp1s0",
        avLanNicIndex: 1,
        outboundNicName: "enp2s0",
        outboundNicIndex: 2,
      },
    },
    nics,
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.localAddress, "10.0.25.10");
});

test("nicFaceProtocolGate blocks cleartext and multicast on venue", () => {
  assert.equal(nicFaceProtocolGate("av", "http").ok, true);
  assert.equal(nicFaceProtocolGate("outbound", "https").ok, true);
  assert.equal(nicFaceProtocolGate("outbound", "cast").ok, true);
  assert.equal(nicFaceProtocolGate("outbound", "tls-websocket").ok, true);
  assert.equal(nicFaceProtocolGate("outbound", "tcp").ok, true);
  const http = nicFaceProtocolGate("outbound", "http");
  assert.equal(http.ok, false);
  if (!http.ok) assert.equal(http.message, DEVICE_VENUE_SKIP_CLEARTEXT);
  const ws = nicFaceProtocolGate("outbound", "websocket");
  assert.equal(ws.ok, false);
  const sacn = nicFaceProtocolGate("outbound", "sacn");
  assert.equal(sacn.ok, false);
  if (!sacn.ok) assert.match(sacn.message, /sACN/);
  assert.match(DEVICE_VENUE_AV_ONLY, /AV-LAN/);
  const ipm = nicFaceProtocolGate("outbound", "ipmidi", { multicast: true });
  assert.equal(ipm.ok, false);
  const ipmUni = nicFaceProtocolGate("outbound", "ipmidi", { multicast: false });
  assert.equal(ipmUni.ok, true);
});

test("deviceHostAllowed AV uses RFC1918; outbound needs IPv4 literal", () => {
  assert.equal(deviceHostAllowed("av", "10.0.25.50").ok, true);
  assert.equal(deviceHostAllowed("av", "8.8.8.8").ok, false);
  assert.equal(deviceHostAllowed("outbound", "8.8.8.8").ok, true);
  assert.equal(deviceHostAllowed("outbound", "192.168.1.9").ok, true);
  const bad = deviceHostAllowed("outbound", "relay.example");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, DEVICE_VENUE_SKIP_BAD_HOST);
});

test("inventory cleartext refusal message is pointed", () => {
  assert.match(DEVICE_VENUE_SKIP_INVENTORY_CLEARTEXT, /Inventory httpPath/);
  assert.match(DEVICE_VENUE_SKIP_INVENTORY_CLEARTEXT, /nicFace=outbound/);
  assert.match(DEVICE_VENUE_SKIP_CLEARTEXT, /forbids cleartext/);
});

test("peerFace auto path not rewritten by nicFace default (source pin)", async () => {
  const { readFileSync } = await import("node:fs");
  const peer = readFileSync(new URL("../src/lib/control/peer-venue.ts", import.meta.url), "utf8");
  // B3 resolvePeerFace must not call readNicFace (would break auto when nicFace defaults av)
  assert.doesNotMatch(peer, /readNicFace/);
  assert.match(peer, /resolvePeerFace/);
  const engine = readFileSync(new URL("../src/lib/control/engine-lan.ts", import.meta.url), "utf8");
  assert.match(engine, /planDeviceBindForDevice/);
  assert.match(engine, /nicFaceProtocolGate/);
});
