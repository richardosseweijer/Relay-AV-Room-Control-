import test from "node:test";
import assert from "node:assert/strict";
import {
  AV_UNSET_CONTROL_URL_REASON,
  DEFAULT_PRODUCTION_CONTROL_PORT,
  avNoIpv4ControlUrlReason,
  controlBaseUrlFrom,
  isListenHostPeer,
  normalizePeerIp,
  resolveControlBaseUrl,
} from "./control-base-url.mjs";
import { listLanNicsFrom } from "./http-listen-host.mjs";

const fixture = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp1s0: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
};

test("controlBaseUrlFrom: AV set → http://AV:8081", () => {
  const nics = listLanNicsFrom(fixture);
  const res = controlBaseUrlFrom({ nics, pick: { name: "enp1s0" }, port: 8081 });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.host, "10.0.25.10");
    assert.equal(res.url, "http://10.0.25.10:8081");
  }
});

test("controlBaseUrlFrom: AV unset → first scanned (same as listen; not loopback URL)", () => {
  const nics = listLanNicsFrom(fixture);
  const res = controlBaseUrlFrom({ nics, pick: {}, port: 8081 });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.host, "10.0.25.10");
    assert.equal(res.url, "http://10.0.25.10:8081");
    assert.match(String(res.warning), /auto-mapped/i);
  }
});

test("controlBaseUrlFrom: no scanned NICs → soft-fail (not loopback URL)", () => {
  const res = controlBaseUrlFrom({ nics: [], pick: {}, port: 8081 });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, AV_UNSET_CONTROL_URL_REASON);
    assert.equal("url" in res, false);
  }
});

test("controlBaseUrlFrom: AV set no IPv4 → soft-fail", () => {
  const nics = listLanNicsFrom({
    enp1s0: [{ address: "fe80::1", family: "IPv6", internal: false }],
  });
  const res = controlBaseUrlFrom({ nics, pick: { name: "enp1s0" } });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, avNoIpv4ControlUrlReason("enp1s0"));
});

test("controlBaseUrlFrom: RELAY_LISTEN_HOST=127.0.0.1 lab escape", () => {
  const nics = listLanNicsFrom(fixture);
  const res = controlBaseUrlFrom({
    nics,
    pick: { name: "enp1s0" },
    envHost: "127.0.0.1",
    port: DEFAULT_PRODUCTION_CONTROL_PORT,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.url, "http://127.0.0.1:8081");
    assert.match(String(res.warning), /lab escape/i);
  }
});

test("controlBaseUrlFrom: outbound NIC ignored — AV still wins", () => {
  const nics = listLanNicsFrom(fixture);
  const res = controlBaseUrlFrom({ nics, pick: { name: "enp1s0" }, port: 8081 });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.host, "10.0.25.10");
});

test("resolveControlBaseUrl: room store AV pick", () => {
  const nics = listLanNicsFrom(fixture);
  const res = resolveControlBaseUrl({
    envHost: "",
    roomJson: { config: { room: { avLanNicName: "enp2s0" } } },
    nics,
    port: 8081,
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.url, "http://192.168.1.40:8081");
});

test("normalizePeerIp + isListenHostPeer: hairpin / mapped IPv4", () => {
  assert.equal(normalizePeerIp("::ffff:10.0.25.10"), "10.0.25.10");
  assert.equal(isListenHostPeer("10.0.25.10", "10.0.25.10"), true);
  assert.equal(isListenHostPeer("::ffff:10.0.25.10", "10.0.25.10"), true);
  assert.equal(isListenHostPeer("10.0.25.99", "10.0.25.10"), false);
  assert.equal(isListenHostPeer("10.0.25.10", "127.0.0.1"), false);
  assert.equal(isListenHostPeer("127.0.0.1", "10.0.25.10"), false);
});
