import test from "node:test";
import assert from "node:assert/strict";
import { listLanNicsFrom, resolveNic, outboundAddress } from "../src/lib/control/nics.ts";

const EM = "\u2014";

const fixture = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
    { address: "::1", family: "IPv6", internal: true },
  ],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false }],
  enp1s0: [{ address: "10.0.25.10", family: 4, internal: false }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
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
