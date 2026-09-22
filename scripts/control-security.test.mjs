import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPin, isHashedPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "../src/lib/control/pins.server.ts";
import { isWeakPin } from "../src/lib/control/pins.ts";
import { signPeer, verifyPeerRequest, varsRequestAllowed } from "../src/lib/control/peer-auth.ts";

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
