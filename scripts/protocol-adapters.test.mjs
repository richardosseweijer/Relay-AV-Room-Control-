import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function namedFn(src, name) {
  const start = src.search(new RegExp(String.raw`(?:export )?(?:async )?function ${name}\b`));
  assert.ok(start >= 0, `missing ${name}`);
  let i = src.indexOf("(", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < src.length && src[i] !== "{") i++;
  depth = 0;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

test("engine-policy does not import the engine barrel", () => {
  const src = fs.readFileSync("src/lib/control/engine-policy.ts", "utf8");
  assert.equal(/from ["']\.\/engine["']/.test(src), false);
  assert.equal(/from ["']\.\/engine\.ts["']/.test(src), false);
  const payload = fs.readFileSync("src/lib/control/engine-payload.ts", "utf8");
  assert.equal(/from ["']\.\/engine["']/.test(payload), false);
  assert.equal(/from ["']\.\/engine\.ts["']/.test(payload), false);
  const barrel = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  assert.match(barrel, /export \{ allowedLanHost, pushTrace, scrubSecret, traces \} from "\.\/engine-policy"/);
  assert.match(barrel, /from "\.\/engine-payload"/);
});

test("policy RFC1918 and scrubSecret", async () => {
  const { allowedLanHost, scrubSecret } = await import("../src/lib/control/engine-policy.ts");
  assert.equal(allowedLanHost("10.0.0.1"), true);
  assert.equal(allowedLanHost("192.168.1.8"), true);
  assert.equal(allowedLanHost("172.16.0.1"), true);
  assert.equal(allowedLanHost("8.8.8.8"), false);
  assert.equal(allowedLanHost("127.0.0.1"), false);
  assert.equal(allowedLanHost("127.0.0.1", { localOk: true }), true);
  assert.equal(scrubSecret('{"token":"abc","password":"x"}').includes("abc"), false);
  // Align with isSecretKey: key / pin / Bearer (and compound keys like apiKey)
  const json = scrubSecret('{"key":"k1","pin":"1234","apiKey":"ak","label":"ok"}');
  assert.equal(json.includes("k1"), false);
  assert.equal(json.includes("1234"), false);
  assert.equal(json.includes("ak"), false);
  assert.equal(json.includes('"label":"ok"'), true);
  assert.equal(scrubSecret("auth?key=secretval&pin=9999&host=10.0.0.1"), "auth?key=***&pin=***&host=10.0.0.1");
  assert.equal(scrubSecret("Authorization: Bearer eyJhbGciOi.abc"), "Authorization: Bearer ***");
  assert.equal(scrubSecret("token abc.def.ghi"), "token ***");
});

test("payload templates, guards, and parseFeedback", async () => {
  const { renderPayload, guardOk, parseFeedback, parseInventoryItems, mapCommandValue, applySim } = await import("../src/lib/control/engine-payload.ts");
  assert.equal(renderPayload("ka 01 {value:hex2}", 16), "ka 01 10");
  assert.equal(renderPayload("/api/{auth.token}/x", undefined, { token: "abc" }), "/api/abc/x");
  assert.equal(guardOk(["power.state=on"], { "power.state": "on" }), true);
  assert.equal(guardOk(["power.state=on"], { "power.state": "off" }), false);
  assert.equal(parseFeedback({ type: "contains", value: "ok" }, "status ok"), "ok");
  assert.equal(parseFeedback({ type: "contains", value: "ok" }, "fail"), "");
  const items = parseInventoryItems('{"lights":{"1":{"name":"A"}}}', { id: "lights", label: "Lights", parsePath: "lights", nameField: "name" });
  assert.equal(items[0]?.id, "1");
  assert.equal(items[0]?.name, "A");
  const mapped = mapCommandValue({ id: "volume.set", label: "Vol", kind: "range", min: 0, max: 100, transport: "lan", payload: "", valueMap: { kind: "int", inMin: 0, inMax: 100, outMin: 0, outMax: 255 } }, 50);
  assert.equal(mapped, 128);
  const slot = {};
  applySim({ id: "power.on", label: "On", kind: "action", transport: "lan", payload: "" }, undefined, slot);
  assert.equal(slot["power.state"], "on");
});

test("shipped drivers keep distinct LAN protocols", () => {
  const dir = path.resolve("data/library");
  const got = {};
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
    const spec = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const proto = spec.transports?.lan?.protocol ?? "none";
    (got[proto] ??= []).push(name);
  }
  assert.ok(got["tls-websocket"]?.includes("samsung-qe50q65t.json"));
  assert.ok(got["tls-websocket"]?.includes("samsung-tizen.json"));
  assert.ok(got.http?.includes("philips-hue-bridge.json"));
  assert.ok(got.tcp?.includes("sony-vpl-fhz120l.json"));
  assert.ok(got.cast?.includes("google-chromecast.json"));
  assert.ok(got.osc?.includes("osc-udp.json"));
  assert.ok(got.sacn?.includes("sacn-universe.json"));
  assert.ok(got.ipmidi?.includes("ipmidi.json"));
  assert.ok(got["rtp-midi"]?.includes("rtp-midi.json"));
  assert.ok(got.pjlink?.includes("pjlink-projector.json"));
  assert.ok(got.pjlink?.includes("mitsubishi-ud8900u.json"));
  assert.equal(got.cast?.includes("samsung-qe50q65t.json") || false, false);
});

test("engine sendLan still names http cast pjlink wol tcp websocket", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  const lan = namedFn(src, "sendLan");
  for (const needle of ['lan.protocol === "cast"', 'lan.protocol === "pjlink"', 'lan.protocol === "wol"', "tls-websocket", 'lan.protocol === "http"', 'lan.protocol === "osc"', 'lan.protocol === "sacn"', 'lan.protocol === "ipmidi"', 'lan.protocol === "rtp-midi"']) {
    assert.ok(lan.includes(needle), needle);
  }
  assert.equal(src.includes("sendSamsungKey"), false);
  assert.equal(src.includes("samsung.remote.control"), false);
  assert.equal(src.includes("Accept Allow on the TV"), false);
  assert.equal(src.includes("ms.channel.connect"), false);
  assert.ok(lan.includes("Unknown protocol"));
});

test("usb-midi is local.kind midi and engine calls sendUsbMidi", () => {
  const spec = JSON.parse(fs.readFileSync("data/library/usb-midi.json", "utf8"));
  assert.equal(spec.transports.local.kind, "midi");
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  assert.ok(namedFn(src, "sendLocal").includes('kind === "midi"'));
  assert.ok(namedFn(src, "sendLocal").includes("sendUsbMidi"));
  assert.equal(src.includes("node-midi"), false);
});

test("midiWatch is JSON matchers; no parse type midi", () => {
  const usb = JSON.parse(fs.readFileSync("data/library/usb-midi.json", "utf8"));
  assert.ok(usb.midiWatch.some((w) => w.kind === "cc" && w.feedback === "level.value"));
  assert.ok(usb.midiWatch.some((w) => w.kind === "mtc"));
  const types = fs.readFileSync("src/lib/control/types.ts", "utf8");
  assert.ok(types.includes("midiWatch"));
  assert.match(types, /export type ParseType = "regex" \| "jsonpath" \| "contains" \| "exact" \| "map"/);
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  assert.ok(namedFn(src, "executeCommand").includes("mtcSend"));
});

test("statusPlane uses only driver.status; Sonos poll stays on sendLan", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  const fn = namedFn(src, "statusPlane");
  assert.equal(fn.includes("httpPath"), false);
  assert.equal(fn.includes("8001"), false);
  assert.equal(fn.includes("pairing"), false);
  const q65 = JSON.parse(fs.readFileSync("data/library/samsung-qe50q65t.json", "utf8"));
  assert.equal(q65.status.port, 8001);
  assert.equal(q65.status.path, "/api/v2/");
  const sonos = JSON.parse(fs.readFileSync("data/library/sonos-s1-s2.json", "utf8"));
  assert.equal(sonos.status, undefined);
  const playback = sonos.feedback.find((f) => f.id === "playback.state");
  assert.equal(playback.httpMethod, "POST");
  assert.ok(playback.httpPath.includes("AVTransport"));
});

test("poll uses driver parse, not PowerState or displayName peeks", () => {
  const src = fs.readFileSync("src/lib/control/engine.ts", "utf8");
  const poll = namedFn(src, "readMonitorValue");
  assert.equal(poll.includes("device.PowerState"), false);
  assert.equal(poll.includes('feedbackId.includes("power")'), false);
  assert.equal(poll.includes('feedbackId.includes("app")'), false);
  const cast = fs.readFileSync("src/lib/control/cast.ts", "utf8");
  assert.ok(cast.includes("applications: [{ displayName: app }]"));
  const hue = JSON.parse(fs.readFileSync("data/library/philips-hue-bridge.json", "utf8"));
  assert.equal(hue.feedback[0].httpPath, "/api/{auth.token}/groups/0");
  assert.equal(hue.feedback[0].parse.path, "state.any_on");
});

test("MPS 602 polls ESC 0LS CR and parses input signal bits", () => {
  const mps = JSON.parse(fs.readFileSync("data/library/extron-mps-602.json", "utf8"));
  const samples = [
    "Sig1 0 1 1 0 1*1 1]",
    "Sig 1 0 1 1 0 1 * 1 1]",
    "Sig1*0*1*1*0*1*1*1]",
    "Sig 0 0 0 0 0 0 * 0 0\r\n",
  ];
  const wantOn = { "signal.1": "1", "signal.2": "0", "signal.3": "1", "signal.4": "1", "signal.5": "0", "signal.6": "1" };
  const wantOff = { "signal.1": "0", "signal.2": "0", "signal.3": "0", "signal.4": "0", "signal.5": "0", "signal.6": "0" };
  for (const sample of samples) {
    const want = sample.includes("0 0 0 0 0 0") ? wantOff : wantOn;
    for (const [id, bit] of Object.entries(want)) {
      const fb = mps.feedback.find((f) => f.id === id);
      assert.ok(fb, id);
      assert.equal(fb.query.charCodeAt(0), 0x1b);
      assert.equal(fb.query.slice(1), "0LS\r");
      const hit = sample.match(new RegExp(fb.parse.pattern));
      assert.equal(hit?.[1], bit, `${id} in ${JSON.stringify(sample)}`);
      assert.equal(fb.parse.map[bit], bit === "1" ? "on" : "off");
    }
  }
  const sig1 = mps.feedback.find((f) => f.id === "signal.1");
  assert.equal("ok".match(new RegExp(sig1.parse.pattern)), null);
  assert.equal("E10]".match(new RegExp(sig1.parse.pattern)), null);
  const micVol = mps.commands.find((c) => c.id === "mic.volume.set");
  assert.equal(micVol.payload, "16*{value}G");
  assert.equal(micVol.min, 0);
  assert.equal(micVol.max, 60);
  assert.equal(mps.commands.find((c) => c.id === "mic.mute.on").payload, "1M");
  assert.equal(mps.commands.find((c) => c.id === "mic.mute.off").payload, "0M");
  assert.equal(mps.feedback.find((f) => f.id === "mic.volume.level").query, "16G");
  assert.equal(mps.feedback.find((f) => f.id === "mic.mute.state").query, "M");
});

test("Mitsubishi UD8900U is PJLink Class 1 with the manual input map", () => {
  const spec = JSON.parse(fs.readFileSync("data/library/mitsubishi-ud8900u.json", "utf8"));
  assert.equal(spec.transports.lan.protocol, "pjlink");
  assert.equal(spec.transports.lan.port, 4352);
  assert.equal(spec.commands.find((c) => c.id === "power.on").payload, "%1POWR 1");
  assert.equal(spec.commands.find((c) => c.id === "input.hdmi").payload, "%1INPT 31");
  assert.equal(spec.commands.find((c) => c.id === "input.dvi").payload, "%1INPT 32");
  assert.equal(spec.commands.find((c) => c.id === "input.sdi").payload, "%1INPT 33");
  const input = spec.feedback.find((f) => f.id === "input.current");
  assert.equal("11 12 21 22 31 32 33".split(" ").every((code) => input.parse.map[code]), true);
  const power = spec.feedback.find((f) => f.id === "power.state");
  assert.equal("%1POWR=1".match(new RegExp(power.parse.pattern))?.[1], "1");
  assert.equal(power.parse.map["1"], "on");
});

test("Biamp Nexia PM is NTP telnet 23 with tagged I/O blocks", () => {
  const spec = JSON.parse(fs.readFileSync("data/library/biamp-nexia-pm.json", "utf8"));
  assert.equal(spec.transports.lan.protocol, "tcp");
  assert.equal(spec.transports.lan.port, 23);
  assert.equal(spec.transports.lan.lineEnding, "\n");
  assert.equal(spec.transports.rs232.baud, 38400);
  assert.equal(spec.commands.find((c) => c.id === "mic.1.level.set").payload, "SET 1 INPLVL MicIn 1 {value}");
  assert.equal(spec.commands.find((c) => c.id === "line.1.mute.on").payload, "SET 1 INPMUTEPML LineIn 1 1");
  assert.equal(spec.commands.find((c) => c.id === "out.1.level.set").payload, "SET 1 OUTLVLPM LineOut 1 {value}");
  assert.equal(spec.commands.find((c) => c.id === "preset.recall").payload, "RECALL 0 PRESET {value}");
  assert.equal(spec.probe.payload, "GETD 0 IPADDR");
});
