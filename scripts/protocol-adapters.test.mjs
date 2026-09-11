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

test("statusPlane uses only driver.status; Sonos poll stays on sendLan", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  const fn = src.slice(src.indexOf("function statusPlane"), src.indexOf("async function sendRpcShutdown"));
  assert.equal(fn.includes("httpPath"), false);
  assert.equal(fn.includes("8001"), false);
  assert.equal(fn.includes("pairing"), false);
  const q65 = JSON.parse(fs.readFileSync("data/drivers/samsung-qe50q65t.json", "utf8"));
  assert.equal(q65.status.port, 8001);
  assert.equal(q65.status.path, "/api/v2/");
  const sonos = JSON.parse(fs.readFileSync("data/drivers/sonos-s1-s2.json", "utf8"));
  assert.equal(sonos.status, undefined);
  const playback = sonos.feedback.find((f) => f.id === "playback.state");
  assert.equal(playback.httpMethod, "POST");
  assert.ok(playback.httpPath.includes("AVTransport"));
});

test("poll uses driver parse, not PowerState or displayName peeks", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  const poll = src.slice(src.indexOf("const statusUrl = statusPlane"), src.indexOf("export async function applyHost"));
  assert.equal(poll.includes("device.PowerState"), false);
  assert.equal(poll.includes('feedbackId.includes("power")'), false);
  assert.equal(poll.includes('feedbackId.includes("app")'), false);
  const cast = fs.readFileSync("src/lib/control/cast.ts", "utf8");
  assert.ok(cast.includes("applications: [{ displayName: app }]"));
  const hue = JSON.parse(fs.readFileSync("data/drivers/philips-hue-bridge.json", "utf8"));
  assert.equal(hue.feedback[0].httpPath, "/api/{auth.token}/groups/0");
  assert.equal(hue.feedback[0].parse.path, "state.any_on");
});
