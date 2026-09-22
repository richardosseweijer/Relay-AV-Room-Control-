import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { hashPin, verifyStoredPin } from "../src/lib/control/pins.server.ts";
import { isWeakPin, isHashedPin } from "../src/lib/control/pins.ts";
import { redactAuth } from "../src/lib/control/secrets.ts";
import { panelUnlockAllowed } from "../src/lib/control/panel-unlock-rule.ts";

// Execute the actual handler bodies, substituting only framework/session I/O.
// No AV engine is loaded or called by these credential tests.
function handler(file, name, bindings) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) callback = node.initializer.arguments[0];
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) callback = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `handler ${name} exists`);
  const body = callback.getText(source).replace('import("./defaults")', 'loadDefaults()');
  const js = ts.transpileModule(`const run = ${body};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn run;`)(...Object.values(bindings));
}

function fixture(room) {
  const mem = { config: { room, devices: [], variables: [], pages: [] }, vars: {}, sessions: {}, log: [], pinChangeRequired: false };
  let writes = 0;
  const io = {
    memory: () => mem, ensureLoaded: async () => {}, reloadSecretsFromDisk: async () => {},
    persist: () => { writes++; }, persistNow: async () => { writes++; },
    writeDriverFile: async () => {}, pruneRoomDrivers: async () => {}, readLibrarySpec: async () => null,
    validToken: token => token === "test-config-session", hashPin, verifyStoredPin,
    checkLockout: () => ({ blocked: false }), lockoutKey: kind => kind,
    clearPinFail: () => {}, notePinFail: () => {}, mint: () => "test-config-session",
    normalize: (c) => c, normalizedConfig: (c) => c,
    installRoomConfig: (c) => { mem.config = c; return c; },
    invalidateNormalizedConfig: () => {},
    traces: () => ({}), processStatus: () => ({}),
    randomHex: () => "test-id",
  };
  return { mem, writes: () => writes, bindings: { ...io, loadControl: async () => io, isWeakPin, isHashedPin, panelUnlockAllowed,
    occupancyOf: () => "available", applyOccupancy: () => {},
    randomHex: () => "test-id", seedVars: () => ({}), loadDefaults: async () => ({ emptyRoomConfig: pin => ({ room: { configPin: pin }, devices: [] }), defaultDeviceState: () => ({}), hostDriverSeed: () => ({ "relay-host.json": {} }), HOST_DRIVER: "relay-host.json" }),
  } };
}

const actionsAuth = "../src/lib/control/actions-auth.ts";
const actionsConfig = "../src/lib/control/actions-config.ts";
test("saveConfig rejects weak plaintext before hashing or persisting", async () => {
  for (const pin of ["1234", "0000", "12", "9876"]) {
    const f = fixture({ configPin: hashPin("8492"), panelAccess: "open" });
    const run = handler(actionsConfig, "saveConfig", f.bindings);
    const result = await run({ data: { token: "test-config-session", config: { room: { configPin: pin, panelAccess: "open" } } } });
    assert.equal(result.ok, false);
    assert.match(result.message, /Choose a PIN/);
    assert.equal(f.writes(), 0);
    assert.equal(verifyStoredPin("8492", f.mem.config.room.configPin), true);
  }
});

test("clearConfig accepts correct plaintext against a stored hash and rejects wrong PIN", async () => {
  const f = fixture({ configPin: hashPin("8492") });
  const run = handler(actionsConfig, "clearConfig", f.bindings);
  assert.equal((await run({ data: { token: "test-config-session", pin: "7613" } })).ok, false);
  assert.equal(f.writes(), 0);
  assert.equal((await run({ data: { token: "test-config-session", pin: "8492" } })).ok, true);
  assert.equal(f.writes(), 1);
  assert.equal(verifyStoredPin("8492", f.mem.config.room.configPin), true);
});

for (const route of [false, true]) {
  test(`${route ? "HTTP" : "server function"} panel migration preserves panel PIN on config fallback`, async () => {
    const f = fixture({ panelAccess: "pin", panelPin: "8492", configPin: hashPin("7613"), panelAcceptsConfigPin: true });
    const run = handler(route ? "../src/routes/api/panel-unlock.ts" : actionsAuth, route ? "POST" : "verifyPanelPin", f.bindings);
    const response = await run(route ? { request: new Request("http://localhost/api/panel-unlock", { method: "POST", body: JSON.stringify({ pin: "7613" }) }) } : { data: { pin: "7613" } });
    const result = route ? await response.json() : response;
    assert.equal(result.ok, true);
    assert.equal(isHashedPin(f.mem.config.room.panelPin), true);
    assert.equal(verifyStoredPin("8492", f.mem.config.room.panelPin), true);
    assert.equal(verifyStoredPin("7613", f.mem.config.room.panelPin), false);
  });
}

test("API/export redaction removes PIN credentials without mutating device auth", () => {
  const auth = { pin: "8492", pairingPIN: "7613", password: "test-password", token: "test-token", user: "ptz-admin", username: "wall", mac: "00:11:22:33:44:55" };
  assert.deepEqual(redactAuth(auth), { pin: "", pairingPIN: "", password: "", token: "", user: "", username: "", mac: auth.mac });
  assert.equal(auth.pin, "8492");
  assert.deepEqual(redactAuth(), {});
});

test("weak unlock persists pinChangeRequired so getEditorConfig keeps mustChange after hash", async () => {
  const f = fixture({ configPin: "1234", panelAccess: "open" });
  const unlock = handler(actionsAuth, "verifyConfigPin", f.bindings);
  const unlocked = await unlock({ data: { pin: "1234" } });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.mustChange, true);
  assert.equal(f.mem.pinChangeRequired, true);
  assert.equal(isHashedPin(f.mem.config.room.configPin), true);
  assert.equal(isWeakPin(f.mem.config.room.configPin), false, "hash must not look weak to isWeakPin");

  const editor = handler(actionsConfig, "getEditorConfig", f.bindings);
  const ed = await editor({ data: { token: "test-config-session" } });
  assert.equal(ed.ok, true);
  assert.equal(ed.mustChange, true, "mustChange must survive reload after PIN is hashed");

  const save = handler(actionsConfig, "saveConfig", f.bindings);
  const saved = await save({ data: { token: "test-config-session", config: { room: { configPin: "8492", panelAccess: "open" }, devices: [], variables: [] } } });
  assert.equal(saved.ok, true);
  assert.equal(f.mem.pinChangeRequired, false);
  const ed2 = await editor({ data: { token: "test-config-session" } });
  assert.equal(ed2.mustChange, false);
});

test("HTTP config-unlock sets pinChangeRequired for already-hashed weak PIN", async () => {
  const f = fixture({ configPin: hashPin("1234"), panelAccess: "open" });
  const run = handler("../src/routes/api/config-unlock.ts", "POST", f.bindings);
  const response = await run({ request: new Request("http://localhost/api/config-unlock", { method: "POST", body: JSON.stringify({ pin: "1234" }) }) });
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.mustChange, true);
  assert.equal(f.mem.pinChangeRequired, true);
});

test("HTTP unlock routes mint via shared mint() helper", async () => {
  const config = fixture({ configPin: hashPin("8492"), panelAccess: "open" });
  const configCalls = [];
  config.bindings.mint = (kind, label) => {
    configCalls.push({ kind, label });
    return "minted-config-token";
  };
  const configRun = handler("../src/routes/api/config-unlock.ts", "POST", config.bindings);
  const configRes = await (await configRun({
    request: new Request("http://localhost/api/config-unlock", { method: "POST", body: JSON.stringify({ pin: "8492" }) }),
  })).json();
  assert.equal(configRes.ok, true);
  assert.equal(configRes.token, "minted-config-token");
  assert.deepEqual(configCalls, [{ kind: "config", label: undefined }]);

  const panel = fixture({ panelAccess: "pin", panelPin: hashPin("7613"), configPin: hashPin("8492") });
  const panelCalls = [];
  panel.bindings.mint = (kind, label) => {
    panelCalls.push({ kind, label });
    return "minted-panel-token";
  };
  const panelRun = handler("../src/routes/api/panel-unlock.ts", "POST", panel.bindings);
  const panelRes = await (await panelRun({
    request: new Request("http://localhost/api/panel-unlock", { method: "POST", body: JSON.stringify({ pin: "7613" }) }),
  })).json();
  assert.equal(panelRes.ok, true);
  assert.equal(panelRes.token, "minted-panel-token");
  assert.deepEqual(panelCalls, [{ kind: "panel", label: undefined }]);

  const openLan = fixture({ panelAccess: "open", configPin: hashPin("8492") });
  const openCalls = [];
  openLan.bindings.mint = (kind, label) => {
    openCalls.push({ kind, label });
    return "minted-open-lan-token";
  };
  const openRun = handler("../src/routes/api/panel-unlock.ts", "POST", openLan.bindings);
  const openRes = await (await openRun({
    request: new Request("http://localhost/api/panel-unlock", { method: "POST", body: JSON.stringify({}) }),
  })).json();
  assert.equal(openRes.ok, true);
  assert.equal(openRes.token, "minted-open-lan-token");
  assert.deepEqual(openCalls, [{ kind: "panel", label: "open-lan" }]);
});

test("HTTP unlock sources no longer hand-roll __relayTokens__", () => {
  for (const file of ["../src/routes/api/config-unlock.ts", "../src/routes/api/panel-unlock.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /\bmint\b/);
    assert.doesNotMatch(src, /__relayTokens__/);
    assert.doesNotMatch(src, /function randomHex/);
  }
});

test("importBundle with blank peerSecret preserves prior secret", async () => {
  const prior = "live-peer-hmac-secret-keep-me";
  const f = fixture({
    configPin: hashPin("8492"),
    panelAccess: "open",
    peerSecret: prior,
  });
  const run = handler(actionsConfig, "importBundle", {
    ...f.bindings,
    validateDriver: () => null,
  });
  const result = await run({
    data: {
      token: "test-config-session",
      bundle: {
        config: {
          room: { name: "Imported", configPin: "", panelAccess: "open", peerSecret: "" },
          pages: [],
          devices: [],
        },
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(f.mem.config.room.peerSecret, prior);
});
