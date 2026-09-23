import test from "node:test";
import assert from "node:assert/strict";
import { panelKioskUrlFrom } from "./panel-kiosk-url.mjs";

const nics = [
  { index: 0, name: "enp1s0", ipv4: "10.0.25.10" },
  { index: 1, name: "enp2s0", ipv4: "192.168.1.40" },
];

test("panelKioskUrlFrom: AV IPv4 → http://AV:port/", () => {
  const res = panelKioskUrlFrom({ nics, pick: { name: "enp1s0" }, port: 8081 });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.host, "10.0.25.10");
    assert.equal(res.url, "http://10.0.25.10:8081/");
  }
});

test("panelKioskUrlFrom: never advertises 0.0.0.0", () => {
  const res = panelKioskUrlFrom({
    nics,
    pick: { name: "enp1s0" },
    envHost: "0.0.0.0",
    port: 8081,
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /0\.0\.0\.0/);
});

test("panelKioskUrlFrom: AV unset soft-fail (not loopback URL)", () => {
  const res = panelKioskUrlFrom({ nics, pick: {}, port: 8081 });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal("url" in res, false);
    assert.match(res.reason, /AV-LAN/i);
  }
});

test("panelKioskUrlFrom: RELAY_LISTEN_HOST lab escape allowed when concrete", () => {
  const res = panelKioskUrlFrom({
    nics,
    pick: {},
    envHost: "127.0.0.1",
    port: 8080,
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.url, "http://127.0.0.1:8080/");
});
