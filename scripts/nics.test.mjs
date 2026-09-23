import test from "node:test";
import assert from "node:assert/strict";
import {
  listLanNicsFrom,
  resolveNic,
  outboundAddress,
  outboundBindFrom,
  isOutboundNonePick,
  OUTBOUND_NONE_NAME,
  OUTBOUND_NONE_UPDATE_MESSAGE,
  cidrContains,
  previewBindAddrsFrom,
  hostLanContains,
} from "../src/lib/control/nics.ts";

const EM = "\u2014";

const fixture = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true },
  ],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
  enp1s0: [{ address: "10.0.25.10", family: 4, internal: false, cidr: "10.0.25.10/24" }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false, cidr: "172.17.0.1/16" }],
};

test("listLanNicsFrom skips lo, sorts A-Z, 0-based, keeps docker0, em dash", () => {
  const nics = listLanNicsFrom(fixture);
  assert.deepEqual(nics.map((n) => n.name), ["docker0", "enp1s0", "enp2s0"]);
  assert.deepEqual(nics.map((n) => n.index), [0, 1, 2]);
  assert.equal(nics[1].ipv4, "10.0.25.10");
  assert.equal(nics[1].label, `1 ${EM} enp1s0 (10.0.25.10)`);
  assert.equal(nics[1].label.includes(" — "), true);
  assert.equal(nics[1].label.includes(" - "), false);
  assert.equal(nics[0].name, "docker0");
});

test("no IPv4 still listed", () => {
  const nics = listLanNicsFrom({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    enp1s0: [{ address: "fe80::1", family: "IPv6", internal: false }],
  });
  assert.equal(nics.length, 1);
  assert.equal(nics[0].ipv4, null);
  assert.equal(nics[0].label, `0 ${EM} enp1s0 (no IPv4)`);
});

test("resolveNic prefers name over stale index", () => {
  const nics = listLanNicsFrom(fixture);
  const hit = resolveNic(nics, { name: "enp2s0", index: 0 });
  assert.equal(hit?.name, "enp2s0");
  assert.equal(hit?.index, 2);
});

test("resolveNic falls back to index including 0", () => {
  const nics = listLanNicsFrom(fixture);
  assert.equal(resolveNic(nics, { index: 0 })?.name, "docker0");
  assert.equal(resolveNic(nics, { name: "", index: 1 })?.name, "enp1s0");
});

test("outboundAddress empty pick is kernel default", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundAddress(nics, {});
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.ipv4, undefined);
});

test("outboundAddress fail closed when selected NIC has no IPv4", () => {
  const nics = listLanNicsFrom({
    enp1s0: [{ address: "fe80::1", family: "IPv6", internal: false }],
    enp2s0: [{ address: "10.0.25.10", family: "IPv4", internal: false }],
  });
  const res = outboundAddress(nics, { name: "enp1s0" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /No IPv4/);
  const ok = outboundAddress(nics, { name: "enp2s0" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.ipv4, "10.0.25.10");
});

test("outboundAddress missing name is fail closed", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundAddress(nics, { name: "missing0" });
  assert.equal(res.ok, false);
});

test("cidrContains /24 and /16", () => {
  assert.equal(cidrContains("10.0.25.40", "10.0.25.10/24"), true);
  assert.equal(cidrContains("10.0.26.40", "10.0.25.10/24"), false);
  assert.equal(cidrContains("192.168.1.8", "192.168.1.40/24"), true);
  assert.equal(cidrContains("8.8.8.8", "10.0.25.10/24"), false);
});

test("hostLanContains: RFC1918 or this host's NIC subnet", () => {
  const nics = listLanNicsFrom({
    wan: [{ address: "203.0.113.5", family: "IPv4", internal: false, cidr: "203.0.113.5/24" }],
  });
  assert.equal(hostLanContains("10.0.10.40", nics), true);
  assert.equal(hostLanContains("203.0.113.80", nics), true);
  assert.equal(hostLanContains("8.8.8.8", nics), false);
});

test("previewBindAddrsFrom uses AV NIC when dest is on it, else the other", () => {
  const nics = listLanNicsFrom(fixture);
  const av = { name: "enp1s0" };
  const out = { name: "enp2s0" };
  assert.deepEqual(previewBindAddrsFrom(nics, "10.0.25.40", av, out), ["10.0.25.10"]);
  assert.deepEqual(previewBindAddrsFrom(nics, "192.168.1.8", av, out), ["192.168.1.40"]);
  assert.deepEqual(previewBindAddrsFrom(nics, "10.0.10.5", av, out), [undefined]);
  assert.deepEqual(previewBindAddrsFrom(nics, "8.8.8.8", av, out), ["10.0.25.10", "192.168.1.40", undefined]);
});

test("isOutboundNonePick: empty and __none__ are None", () => {
  assert.equal(isOutboundNonePick({}), true);
  assert.equal(isOutboundNonePick({ name: null, index: null }), true);
  assert.equal(isOutboundNonePick({ name: "", index: null }), true);
  assert.equal(isOutboundNonePick({ name: OUTBOUND_NONE_NAME }), true);
  assert.equal(isOutboundNonePick({ name: "enp1s0" }), false);
  assert.equal(isOutboundNonePick({ index: 0 }), false);
});

test("outboundBindFrom empty pick is None (not kernel default)", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundBindFrom(nics, {});
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.none, true);
    assert.equal(res.localAddress, undefined);
  }
});

test("outboundBindFrom __none__ sentinel is None", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundBindFrom(nics, { name: OUTBOUND_NONE_NAME, index: 1 });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.none, true);
});

test("outboundBindFrom selected NIC returns localAddress", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundBindFrom(nics, { name: "enp2s0" });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.none, undefined);
    assert.equal(res.localAddress, "192.168.1.40");
  }
});

test("outboundBindFrom missing NIC fail closed", () => {
  const nics = listLanNicsFrom(fixture);
  const res = outboundBindFrom(nics, { name: "missing0" });
  assert.equal(res.ok, false);
});

test("OUTBOUND_NONE_UPDATE_MESSAGE is clear", () => {
  assert.match(OUTBOUND_NONE_UPDATE_MESSAGE, /Outbound NIC is None/);
  assert.match(OUTBOUND_NONE_UPDATE_MESSAGE, /venue\/internet NIC/);
});

test("previewBindAddrsFrom with outbound None still binds AV only", () => {
  const nics = listLanNicsFrom(fixture);
  const av = { name: "enp1s0" };
  const out = {};
  assert.deepEqual(previewBindAddrsFrom(nics, "10.0.25.40", av, out), ["10.0.25.10"]);
  assert.deepEqual(previewBindAddrsFrom(nics, "8.8.8.8", av, out), ["10.0.25.10", undefined]);
});
