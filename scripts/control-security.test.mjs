import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPin, isHashedPin, verifyStoredPin } from "../src/lib/control/pins.server.ts";
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
