import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPin, isHashedPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "../src/lib/control/pins.server.ts";
import { isWeakPin } from "../src/lib/control/pins.ts";
import { signPeer, verifyPeerRequest, varsRequestAllowed } from "../src/lib/control/peer-auth.ts";
import { serialPathOk, sendLocal } from "../src/lib/control/engine-host.ts";
import { safeLanHttpUrl, allowedLanHost } from "../src/lib/control/engine-policy.ts";

test("weak pins", () => {
  assert.equal(isWeakPin("1234"), true);
  assert.equal(isWeakPin("8492"), false);
});

test("scrypt pin round trip", () => {
  const stored = hashPin("8492");
  assert.equal(isHashedPin(stored), true);
  assert.equal(verifyStoredPin("8492", stored), true);
  assert.equal(verifyStoredPin("0000", stored), false);
});

test("hmac replay rejects case variants", () => {
  const key = "k".repeat(24);
  const ts = String(Date.now());
  const sig = signPeer(key, "POST", "/api/peer", ts, "{}");
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body: "{}", sig }), true);
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body: "{}", sig: sig.toUpperCase() }), false);
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body: "{}", sig: `${sig}00` }), false);
});

test("vars GET unsigned only when externalControl and no peer key", () => {
  assert.equal(varsRequestAllowed({
    key: "", method: "GET", externalControl: true, sig: "", ts: "", body: "",
  }), true);
  assert.equal(varsRequestAllowed({
    key: "", method: "GET", externalControl: false, sig: "", ts: "", body: "",
  }), false);
  assert.equal(varsRequestAllowed({
    key: "", method: "PUT", externalControl: true, sig: "", ts: "", body: "{}",
  }), false);
});

test("vars denies unsigned when peer key is set even if externalControl", () => {
  const key = "v".repeat(24);
  assert.equal(varsRequestAllowed({
    key, method: "GET", externalControl: true, sig: "", ts: "", body: "",
  }), false);
  // Fresh ts per verify — replay cache keys digest:ts
  const ts1 = String(Date.now());
  const sig1 = signPeer(key, "GET", "/api/vars", ts1, "");
  assert.equal(varsRequestAllowed({
    key, method: "GET", externalControl: true, sig: sig1, ts: ts1, body: "",
  }), true);
  const ts2 = String(Date.now() + 1);
  const sig2 = signPeer(key, "GET", "/api/vars", ts2, "");
  assert.equal(varsRequestAllowed({
    key, method: "GET", externalControl: false, sig: sig2, ts: ts2, body: "",
  }), true);
});

test("vars route uses varsRequestAllowed (peer key not ignored for open GET)", () => {
  const src = readFileSync(new URL("../src/routes/api/vars.ts", import.meta.url), "utf8");
  assert.match(src, /varsRequestAllowed\s*\(/);
  assert.doesNotMatch(src, /if\s*\(\s*key\s*&&\s*sig\s*\)/);
  assert.match(src, /from\s+["']@\/lib\/control\/peer-auth["']/);
});

test("plaintext pin verify is timing-safe path (legacy until hash upgrade)", () => {
  assert.equal(verifyStoredPin("8492", "8492"), true);
  assert.equal(verifyStoredPin("8493", "8492"), false);
  assert.equal(verifyStoredPin("849", "8492"), false);
  assert.equal(verifyStoredPin("84920", "8492"), false);
  assert.equal(verifyStoredPin("", "8492"), false);
  assert.equal(verifyStoredPin("8492", ""), false);
  assert.equal(verifyStoredPin("8492", null), false);
  const src = readFileSync(new URL("../src/lib/control/pins.server.ts", import.meta.url), "utf8");
  assert.match(src, /timingSafeStringEqual|timingSafeEqual/);
  assert.doesNotMatch(src, /if\s*\(!isHashedPin\(value\)\)\s*return\s+String\(pin\)\s*===\s*value/);
});

test("pin lockout blocks after 5 fails then clears on success (process-global, not forever)", () => {
  const key = lockoutKey("test-gate", `unit-${Date.now()}`);
  clearPinFail(key);
  for (let i = 0; i < 4; i++) {
    const gate = notePinFail(key);
    assert.equal(gate.blocked, false, `fail ${i + 1} should not lock yet`);
  }
  const locked = notePinFail(key);
  assert.equal(locked.blocked, true);
  assert.ok(locked.left > 0);
  assert.equal(checkLockout(key).blocked, true);
  clearPinFail(key);
  assert.equal(checkLockout(key).blocked, false);
});

test("serialPathOk allowlists COM and /dev tty/serial nodes", () => {
  assert.equal(serialPathOk("COM1"), true);
  assert.equal(serialPathOk("COM12"), true);
  assert.equal(serialPathOk("com3"), true);
  assert.equal(serialPathOk("/dev/ttyUSB0"), true);
  assert.equal(serialPathOk("/dev/ttyACM1"), true);
  assert.equal(serialPathOk("/dev/ttyAMA0"), true);
  assert.equal(serialPathOk("/dev/ttyS0"), true);
  assert.equal(serialPathOk("/dev/serial0"), true);
  assert.equal(serialPathOk("/dev/serial1"), true);
});

test("serialPathOk rejects filesystem escapes", () => {
  assert.equal(serialPathOk("/etc/passwd"), false);
  assert.equal(serialPathOk("../../etc/passwd"), false);
  assert.equal(serialPathOk("/dev/../etc/passwd"), false);
  assert.equal(serialPathOk("/dev/ttyUSB0/../../etc/passwd"), false);
  assert.equal(serialPathOk("/home/user/secret"), false);
  assert.equal(serialPathOk("/dev/sda"), false);
  assert.equal(serialPathOk("/dev/serial/by-id/usb-foo"), false);
  assert.equal(serialPathOk(""), false);
  assert.equal(serialPathOk("C:\\Windows\\System32\\config\\SAM"), false);
});

test("sendLocal serial rejects bad path before open", async () => {
  const driver = {
    specVersion: "2",
    device: { manufacturer: "T", model: "T", type: "serial" },
    transports: { rs232: { baud: 9600 } },
    commands: [],
    feedback: [],
  };
  const base = {
    id: "s1",
    name: "Serial",
    driver: "x.json",
    transport: "rs232",
    host: "",
    auth: { ifaceKind: "serial" },
    enabledFeatures: [],
    simulate: false,
  };
  const bad = await sendLocal(driver, { ...base, interface: "/etc/passwd" }, "AT");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Serial path rejected/);
  const traj = await sendLocal(driver, { ...base, interface: "../../etc/passwd" }, "AT");
  assert.equal(traj.ok, false);
  assert.match(traj.message, /Serial path rejected/);
});

test("safeLanHttpUrl accepts path-only /api/status", () => {
  const ok = safeLanHttpUrl("http", "10.0.10.50", 8080, "/api/status");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.url, "http://10.0.10.50:8080/api/status");
  const httpsOk = safeLanHttpUrl("https", "10.0.10.50", 8443, "/api/status");
  assert.equal(httpsOk.ok, true);
  if (httpsOk.ok) assert.equal(httpsOk.url, "https://10.0.10.50:8443/api/status");
});

test("safeLanHttpUrl rejects authority rewrite via @ in path", () => {
  const bad = safeLanHttpUrl("http", "10.0.10.50", 8080, "@127.0.0.1:8123/foo");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.message, /Invalid path/);
  const withSlash = safeLanHttpUrl("http", "10.0.10.50", 8080, "/@evil/foo");
  assert.equal(withSlash.ok, false);
  const noSlash = safeLanHttpUrl("http", "10.0.10.50", 8080, "api/status");
  assert.equal(noSlash.ok, false);
});


function engineSrc() {
  return readFileSync(new URL("../src/lib/control/engine.ts", import.meta.url), "utf8");
}

function sliceFn(src, name) {
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?\\n(?=(?:export\\s+)?(?:async\\s+)?function\\s|$)`,
  );
  const m = src.match(re);
  assert.ok(m, `function ${name} not found`);
  return m[0];
}

test("F3 allowedLanHost rejects non-LAN and loopback; accepts RFC1918", () => {
  assert.equal(allowedLanHost("8.8.8.8"), false);
  assert.equal(allowedLanHost("1.1.1.1"), false);
  assert.equal(allowedLanHost("127.0.0.1"), false);
  assert.equal(allowedLanHost("169.254.1.1"), false);
  assert.equal(allowedLanHost("10.0.10.50"), true);
  assert.equal(allowedLanHost("192.168.1.8"), true);
  assert.equal(allowedLanHost("172.16.0.1"), true);
});

test("F3 authenticateDevice gates host with allowedLanHost before pairing fetch", () => {
  const fn = sliceFn(engineSrc(), "authenticateDevice");
  const gate = fn.indexOf("allowedLanHost(host");
  const fetchAt = fn.indexOf("await fetch(");
  const wsAt = fn.indexOf("sendControlSocket");
  assert.ok(gate >= 0, "authenticateDevice must call allowedLanHost");
  assert.match(fn, /Host not on room LAN/);
  assert.ok(fetchAt < 0 || gate < fetchAt, "LAN gate before pairing fetch");
  assert.ok(wsAt < 0 || gate < wsAt, "LAN gate before websocket pairing");
});

test("F3 syncInventory HTTP path gates with allowedLanHost before sendHttp", () => {
  const fn = sliceFn(engineSrc(), "syncInventory");
  const httpBranch = fn.slice(fn.indexOf("resource.httpPath"));
  const gate = httpBranch.indexOf("allowedLanHost(device.host)");
  const send = httpBranch.indexOf("sendHttp(");
  assert.ok(gate >= 0, "inventory httpPath must call allowedLanHost");
  assert.match(httpBranch, /Host not on room LAN/);
  assert.ok(send >= 0 && gate < send, "LAN gate before sendHttp");
});

test("F3 signedPeerFetch gates peer host before network I/O", () => {
  const fn = sliceFn(engineSrc(), "signedPeerFetch");
  // B3: planPeerTransportForDevice (LAN / venue allowlist) before requestHttpExact
  const gate = fn.indexOf("planPeerTransportForDevice");
  const fetchAt = fn.indexOf("requestHttpExact");
  assert.ok(gate >= 0, "signedPeerFetch must plan peer transport (allowlist)");
  assert.ok(fetchAt >= 0 && gate < fetchAt, "plan before requestHttpExact");
  assert.match(fn, /cleartext HTTP is not allowed on NIC2|plan\.ok/);
  // Callers that rely on signedPeerFetch for remote peers
  const src = engineSrc();
  assert.match(src, /signedPeerFetch\(device/);
  assert.match(src, /callRelayPeer\(/);
  assert.match(src, /planPeerTransportForDevice/);
});


test("F4 verifyConfigPin reloads secrets from disk before PIN verify (like config-unlock)", () => {
  const auth = readFileSync(new URL("../src/lib/control/actions-auth.ts", import.meta.url), "utf8");
  const unlock = readFileSync(new URL("../src/routes/api/config-unlock.ts", import.meta.url), "utf8");
  const session = readFileSync(new URL("../src/lib/control/session.server.ts", import.meta.url), "utf8");
  assert.match(unlock, /await\s+reloadSecretsFromDisk\s*\(/);
  assert.match(session, /reloadSecretsFromDisk/);
  const fnStart = auth.indexOf("export const verifyConfigPin");
  const fnEnd = auth.indexOf("export const verifyPanelPin");
  assert.ok(fnStart >= 0 && fnEnd > fnStart, "verifyConfigPin block bounds");
  const fn = auth.slice(fnStart, fnEnd);
  const reloadAt = fn.search(/await\s+reloadSecretsFromDisk\s*\(/);
  const storedAt = fn.indexOf("memory().config.room.configPin");
  assert.ok(reloadAt >= 0, "verifyConfigPin must await reloadSecretsFromDisk");
  assert.ok(storedAt >= 0 && reloadAt < storedAt, "reload before reading configPin");
});

test("F5 /api/vars PUT uses writeConfiguredVar (allowlist + clamp)", () => {
  const src = readFileSync(new URL("../src/routes/api/vars.ts", import.meta.url), "utf8");
  assert.match(src, /writeConfiguredVar\s*\(/);
  assert.match(src, /from\s+["']@\/lib\/control\/vars["']/);
  assert.doesNotMatch(src, /mem\.vars\[body\.id\]\s*=\s*body\.value/);
});

test("F5 writeConfiguredVar rejects unknown id; accepts and clamps known", async () => {
  const { writeConfiguredVar } = await import("../src/lib/control/vars.ts");
  const variables = [
    { id: "vol", label: "Volume", kind: "number", default: 50, min: 0, max: 100 },
    { id: "mode", label: "Mode", kind: "enum", default: "off", values: ["off", "on"] },
    { id: "note", label: "Note", kind: "text", default: "" },
  ];
  const unknown = writeConfiguredVar(variables, "evil.payload", 1);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.message, "Unknown variable");

  const hi = writeConfiguredVar(variables, "vol", 150);
  assert.equal(hi.ok, true);
  assert.equal(hi.value, 100);

  const lo = writeConfiguredVar(variables, "vol", -3);
  assert.equal(lo.ok, true);
  assert.equal(lo.value, 0);

  const mid = writeConfiguredVar(variables, "vol", 42);
  assert.equal(mid.ok, true);
  assert.equal(mid.value, 42);

  const okEnum = writeConfiguredVar(variables, "mode", "on");
  assert.equal(okEnum.ok, true);
  assert.equal(okEnum.value, "on");

  const badEnum = writeConfiguredVar(variables, "mode", "hack");
  assert.equal(badEnum.ok, true);
  assert.equal(badEnum.value, "off");

  const text = writeConfiguredVar(variables, "note", 7);
  assert.equal(text.ok, true);
  assert.equal(text.value, "7");

  const missingVal = writeConfiguredVar(variables, "note", undefined);
  assert.equal(missingVal.ok, true);
  assert.equal(missingVal.value, "");
});


test("F6 peer POST stays macro-only (rejects raw command bodies)", () => {
  const src = readFileSync(new URL("../src/routes/api/peer.ts", import.meta.url), "utf8");
  assert.match(src, /Peers may only run allow-listed macros/);
  assert.match(src, /if\s*\(\s*!body\.macroId\s*\)/);
  assert.match(src, /peerMacroIds/);
  // Must not grow a raw-command execution path on POST
  assert.doesNotMatch(src, /executeCommand\s*\(/);
  assert.doesNotMatch(src, /body\.command/);
});

test("F6 executeCommand remote host only peers macro.run; other cmds fail closed", () => {
  const fn = sliceFn(engineSrc(), "executeCommand");
  const remoteStart = fn.indexOf("if (!isLocalRelayHost(device.host))");
  assert.ok(remoteStart >= 0, "remote host branch required");
  const after = fn.slice(remoteStart);
  // Cut before local occupancy handling so the window is the remote if + local macro.run header
  const localHostMarker = after.indexOf('if (opts.commandId.startsWith("occupancy."))');
  const remoteWindow = after.slice(0, localHostMarker > 0 ? localHostMarker : 1200);
  assert.ok(remoteWindow.includes('opts.commandId === "macro.run"'), "remote branch must handle macro.run");
  assert.match(remoteWindow, /callRelayPeer\([\s\S]*\{\s*macroId:/);
  assert.match(remoteWindow, /Remote peer only accepts allow-listed macros/);
  assert.doesNotMatch(remoteWindow, /callRelayPeer\([\s\S]*\{\s*command:/);
  assert.doesNotMatch(fn, /\{\s*command:\s*opts\.commandId/);
});

test("F8 /api/room catch lastError uses scrubSecret (not raw err.message)", () => {
  const src = readFileSync(new URL("../src/routes/api/room.ts", import.meta.url), "utf8");
  assert.match(src, /import\s*\{\s*scrubSecret\s*\}\s*from\s*["']@\/lib\/control\/engine["']/);
  // Happy path already scrubs
  assert.match(src, /lastError:\s*snap\.lastError\s*\?\s*scrubSecret\(snap\.lastError\)\s*:\s*null/);
  const catchIdx = src.indexOf("catch (err)");
  assert.ok(catchIdx >= 0, "outer catch (err) required");
  const catchBlock = src.slice(catchIdx);
  assert.match(catchBlock, /lastError:\s*scrubSecret\(/);
  assert.doesNotMatch(catchBlock, /lastError:\s*err\s+instanceof\s+Error\s*\?\s*err\.message/);
});

test("F8 scrubSecret redacts secrets in exception-like lastError text", async () => {
  const { scrubSecret } = await import("../src/lib/control/engine-policy.ts");
  const raw = 'load failed Authorization: Bearer eyJhbGciOi.abc token abc.def.ghi pin=9999';
  const scrubbed = scrubSecret(raw);
  assert.equal(scrubbed.includes("eyJhbGciOi"), false);
  assert.equal(scrubbed.includes("abc.def.ghi"), false);
  assert.equal(scrubbed.includes("9999"), false);
  assert.match(scrubbed, /Bearer \*\*\*/);
  assert.match(scrubbed, /token \*\*\*/);
  assert.match(scrubbed, /pin=\*\*\*/);
});

test("F12 /api/room catch fails closed (503 / ok:false), not empty demo room", () => {
  const src = readFileSync(new URL("../src/routes/api/room.ts", import.meta.url), "utf8");
  const catchIdx = src.indexOf("catch (err)");
  assert.ok(catchIdx >= 0, "outer catch (err) required");
  const catchBlock = src.slice(catchIdx);
  assert.doesNotMatch(catchBlock, /emptyRoomConfig/);
  assert.doesNotMatch(catchBlock, /defaultDeviceState/);
  assert.match(catchBlock, /status:\s*503/);
  assert.match(catchBlock, /ok:\s*false/);
  assert.match(catchBlock, /error:\s*["']room unavailable["']/);
  assert.match(catchBlock, /lastError:\s*scrubSecret\(/);
});
