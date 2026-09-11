import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("shipped drivers keep distinct LAN protocols", () => {
  const dir = path.resolve("data/drivers");
  const got = {};
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const proto = spec.transports?.lan?.protocol ?? "none";
    (got[proto] ??= []).push(name);
  }
  assert.ok(got["tls-websocket"]?.includes("samsung-qe50q65t.json"));
  assert.ok(got.http?.includes("philips-hue-bridge.json"));
  assert.ok(got.tcp?.includes("sony-vpl-fhz120l.json"));
  assert.ok(got.cast?.includes("google-chromecast.json"));
  assert.ok(got.pjlink?.includes("pjlink-projector.json"));
  assert.equal(got.cast?.includes("samsung-qe50q65t.json") || false, false);
});

test("engine sendLan still names http cast pjlink wol tcp websocket", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  for (const needle of ['lan.protocol === "cast"', 'lan.protocol === "pjlink"', 'lan.protocol === "wol"', "tls-websocket", 'lan.protocol === "http"']) {
    assert.ok(src.includes(needle), needle);
  }
  assert.equal(src.includes("sendSamsungKey"), false);
  assert.equal(src.includes("samsung.remote.control"), false);
  assert.equal(src.includes("Accept Allow on the TV"), false);
  assert.equal(src.includes("ms.channel.connect"), false);
  assert.ok(src.includes("Unknown protocol"));
});
