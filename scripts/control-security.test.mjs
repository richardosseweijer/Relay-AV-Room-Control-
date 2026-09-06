import test from "node:test";
import assert from "node:assert/strict";
import { hashPin, isHashedPin, verifyStoredPin } from "../src/lib/control/pins.server.ts";
import { isWeakPin } from "../src/lib/control/pins.ts";
import { signPeer, verifyPeerRequest } from "../src/lib/control/peer-auth.ts";

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
