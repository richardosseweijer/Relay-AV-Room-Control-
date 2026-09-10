import test from "node:test";
import assert from "node:assert/strict";
import { signPeer, verifyPeerRequest } from "../src/lib/control/peer-auth.ts";
import { actionPermitted } from "../src/lib/control/control-policy.ts";
import { matchesTrigger, scheduleShouldRun, triggerPathHit, triggerStep } from "../src/lib/control/logic-policy.ts";
import { monitorVarId } from "../src/lib/control/vars.ts";

test("hmac good signature", () => {
  const key = "peer-secret-key-aaaaaaaaaaaa";
  const ts = String(Date.now());
  const body = `{"n":${Math.random()}}`;
  const sig = signPeer(key, "POST", "/api/peer", ts, body);
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body, sig }), true);
});

test("hmac replay of same ts+body rejected", () => {
  const key = "peer-secret-key-bbbbbbbbbbbb";
  const ts = String(Date.now());
  const body = "{\"replay\":1}";
  const sig = signPeer(key, "POST", "/api/peer", ts, body);
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body, sig }), true);
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body, sig }), false);
});

test("hmac uppercase hex rejected", () => {
  const key = "peer-secret-key-cccccccccccc";
  const ts = String(Date.now());
  const body = "{\"case\":1}";
  const sig = signPeer(key, "POST", "/api/peer", ts, body).toUpperCase();
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body, sig }), false);
});

test("hmac empty key rejected", () => {
  const ts = String(Date.now());
  const sig = signPeer("x", "POST", "/api/peer", ts, "{}");
  assert.equal(verifyPeerRequest({ key: "", method: "POST", path: "/api/peer", ts, body: "{}", sig }), false);
});

test("hmac skew over 90s rejected", () => {
  const key = "peer-secret-key-dddddddddddd";
  const ts = String(Date.now() - 91_000);
  const sig = signPeer(key, "POST", "/api/peer", ts, "{}");
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/peer", ts, body: "{}", sig }), false);
});

test("hmac wrong path rejected", () => {
  const key = "peer-secret-key-eeeeeeeeeeee";
  const ts = String(Date.now());
  const sig = signPeer(key, "POST", "/api/peer", ts, "{}");
  assert.equal(verifyPeerRequest({ key, method: "POST", path: "/api/other", ts, body: "{}", sig }), false);
});

test("allowLanControl off without token denies", () => {
  assert.equal(actionPermitted({ externalControl: false, tokenKind: null, commandId: "power.on" }), false);
});

test("allowLanControl off with panel token allows fireCommand/fireMacro", () => {
  assert.equal(actionPermitted({ externalControl: false, tokenKind: "panel", commandId: "power.on" }), true);
  assert.equal(actionPermitted({ externalControl: false, tokenKind: "panel" }), true);
});

test("allowLanControl on without token allows those three only", () => {
  assert.equal(actionPermitted({ externalControl: true, tokenKind: null, commandId: "power.on" }), true);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: null }), true);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: null, commandId: "system.restart" }), false);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: null, commandId: "system.update" }), false);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: null, commandId: "system.reboot" }), false);
});

test("system admin commands need a config token even with open LAN", () => {
  assert.equal(actionPermitted({ externalControl: true, tokenKind: "panel", commandId: "system.restart" }), false);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: "config", commandId: "system.restart" }), true);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: "config", commandId: "system.update" }), true);
  assert.equal(actionPermitted({ externalControl: true, tokenKind: "config", commandId: "system.reboot" }), true);
});

test("trigger change fires once per edge; interval may re-fire", () => {
  assert.equal(triggerStep("change", undefined, true), "arm");
  assert.equal(triggerStep("change", "true:on", true), "hold");
  assert.equal(triggerStep("change", "false:off", true), "ready");
  assert.equal(triggerStep("change", "true:on", false), "reset");
  assert.equal(triggerStep("interval", "true:on", true), "ready");
  assert.equal(triggerStep("interval", "false:off", true), "ready");
  assert.equal(matchesTrigger("on", "eq", "on"), true);
});

test("trigger extras AND after the primary true/false", () => {
  const rule = {
    variable: "occ",
    compare: "eq",
    equals: "on",
    whenTrue: [{ variable: "tv", compare: "eq", equals: "on" }],
    whenFalse: [{ variable: "scene", compare: "eq", equals: "idle" }],
  };
  const vars = { occ: "on", tv: "on", scene: "present" };
  assert.equal(triggerPathHit(rule, vars, "t"), true);
  assert.equal(triggerPathHit(rule, { ...vars, tv: "off" }, "t"), false);
  assert.equal(triggerPathHit(rule, vars, "f"), false);
  assert.equal(triggerPathHit(rule, { occ: "off", tv: "on", scene: "idle" }, "f"), true);
  assert.equal(triggerPathHit({ variable: "occ", compare: "eq", equals: "on" }, { occ: "on" }, "t"), true);
});

test("monitor auto var id from label", () => {
  assert.equal(monitorVarId({ id: "mon-1", label: "projectorOn" }), "MON_projectorOn");
  assert.equal(monitorVarId({ id: "mon-2", label: "var Watcher" }), "MON_varWatcher");
  assert.equal(monitorVarId({ id: "mon-3", label: "Display power" }), "MON_displayPower");
});

test("empty schedule days never run", () => {
  assert.equal(scheduleShouldRun({ enabled: true, time: "09:00", days: [] }, "09:00", 1), false);
  assert.equal(scheduleShouldRun({ enabled: true, time: "09:00", days: [1] }, "09:00", 1), true);
  assert.equal(scheduleShouldRun({ enabled: true, time: "09:00", days: [1] }, "09:00", 2), false);
});
