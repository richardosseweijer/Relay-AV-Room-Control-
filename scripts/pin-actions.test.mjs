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
  const mem = { config: { room, devices: [], variables: [] }, vars: {}, sessions: {} };
  let writes = 0;
  const io = {
    memory: () => mem, ensureLoaded: async () => {}, reloadSecretsFromDisk: async () => {},
    persist: () => { writes++; }, persistNow: async () => { writes++; },
    validToken: token => token === "test-config-session", hashPin, verifyStoredPin,
    checkLockout: () => ({ blocked: false }), lockoutKey: kind => kind,
    clearPinFail: () => {}, notePinFail: () => {}, mint: () => "test-panel-session",
  };
  return { mem, writes: () => writes, bindings: { ...io, S: async () => io, isWeakPin, isHashedPin, panelUnlockAllowed,
    randomHex: () => "test-id", loadDefaults: async () => ({ emptyRoomConfig: pin => ({ room: { configPin: pin }, devices: [] }), defaultDeviceState: () => ({}) }),
  } };
}

const actions = "../src/lib/control/actions.ts";
test("saveConfig rejects weak plaintext before hashing or persisting", async () => {
  for (const pin of ["1234", "0000", "12", "9876"]) {
    const f = fixture({ configPin: hashPin("8492"), panelAccess: "open" });
    const run = handler(actions, "saveConfig", f.bindings);
    const result = await run({ data: { token: "test-config-session", config: { room: { configPin: pin, panelAccess: "open" } } } });
    assert.equal(result.ok, false);
    assert.match(result.message, /Choose a PIN/);
    assert.equal(f.writes(), 0);
    assert.equal(verifyStoredPin("8492", f.mem.config.room.configPin), true);
  }
});

test("clearConfig accepts correct plaintext against a stored hash and rejects wrong PIN", async () => {
  const f = fixture({ configPin: hashPin("8492") });
  const run = handler(actions, "clearConfig", f.bindings);
  assert.equal((await run({ data: { token: "test-config-session", pin: "7613" } })).ok, false);
  assert.equal(f.writes(), 0);
  assert.equal((await run({ data: { token: "test-config-session", pin: "8492" } })).ok, true);
  assert.equal(f.writes(), 1);
  assert.equal(verifyStoredPin("8492", f.mem.config.room.configPin), true);
});

for (const route of [false, true]) {
  test(`${route ? "HTTP" : "server function"} panel migration preserves panel PIN on config fallback`, async () => {
    const f = fixture({ panelAccess: "pin", panelPin: "8492", configPin: hashPin("7613"), panelAcceptsConfigPin: true });
    const run = handler(route ? "../src/routes/api/panel-unlock.ts" : actions, route ? "POST" : "verifyPanelPin", f.bindings);
    const response = await run(route ? { request: new Request("http://localhost/api/panel-unlock", { method: "POST", body: JSON.stringify({ pin: "7613" }) }) } : { data: { pin: "7613" } });
    const result = route ? await response.json() : response;
    assert.equal(result.ok, true);
    assert.equal(isHashedPin(f.mem.config.room.panelPin), true);
    assert.equal(verifyStoredPin("8492", f.mem.config.room.panelPin), true);
    assert.equal(verifyStoredPin("7613", f.mem.config.room.panelPin), false);
  });
}

test("API/export redaction removes PIN credentials without mutating device auth", () => {
  const auth = { pin: "8492", pairingPIN: "7613", password: "test-password", token: "test-token", mac: "00:11:22:33:44:55" };
  assert.deepEqual(redactAuth(auth), { pin: "", pairingPIN: "", password: "", token: "", mac: auth.mac });
  assert.equal(auth.pin, "8492");
  assert.deepEqual(redactAuth(), {});
});
