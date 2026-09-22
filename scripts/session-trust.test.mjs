import test from "node:test";
import assert from "node:assert/strict";
import { hashPin } from "../src/lib/control/pins.server.ts";
import { panelUnlockAllowed } from "../src/lib/control/panel-unlock-rule.ts";
import { applyRoomSession, PANEL_TOKEN_KEY } from "../src/lib/control/panel-token.ts";
import { readFileSync } from "node:fs";
import {
  dropExpiredSessions,
  SESSION_SLIDE_PERSIST_ADVANCE_MS,
  sessionSlideShouldPersist,
} from "../src/lib/control/session-expire.ts";

test("Forget clears client key", () => {
  const store = new Map([[PANEL_TOKEN_KEY, "panel-dead"]]);
  const storage = {
    removeItem(key) { store.delete(key); },
  };
  applyRoomSession(storage, false);
  assert.equal(store.has(PANEL_TOKEN_KEY), false);
});

test("config PIN rejected on panel when flag is false", () => {
  const room = {
    panelPin: hashPin("8492"),
    configPin: hashPin("7613"),
    panelAcceptsConfigPin: false,
  };
  assert.equal(panelUnlockAllowed("8492", room), true);
  assert.equal(panelUnlockAllowed("7613", room), false);
  room.panelAcceptsConfigPin = true;
  assert.equal(panelUnlockAllowed("7613", room), true);
});

test("open LAN panel does not need a PIN", () => {
  assert.equal(panelUnlockAllowed("", { panelAccess: "open", panelPin: hashPin("8492") }), true);
  assert.equal(panelUnlockAllowed("anything", { panelAccess: "open" }), true);
  assert.equal(panelUnlockAllowed("", { panelAccess: "pin", panelPin: hashPin("8492") }), false);
});

test("expired token rejected", () => {
  const sessions = {
    live: { secret: "panel-live", kind: "panel", exp: Date.now() + 60_000 },
    dead: { secret: "panel-dead", kind: "panel", exp: Date.now() - 1000 },
  };
  const { kept, dropped } = dropExpiredSessions(sessions);
  assert.equal(kept.live?.secret, "panel-live");
  assert.equal(kept.dead, undefined);
  assert.deepEqual(dropped, ["panel-dead"]);
});

test("F7 sessions without exp are dropped (fail closed)", () => {
  const now = Date.now();
  const sessions = {
    live: { secret: "panel-live", kind: "panel", exp: now + 60_000 },
    orphan: { secret: "panel-orphan", kind: "panel" },
    invalid: { secret: "panel-invalid", kind: "panel", exp: Number.NaN },
  };
  const { kept, dropped } = dropExpiredSessions(sessions, now);
  assert.equal(kept.live?.secret, "panel-live");
  assert.equal(kept.orphan, undefined);
  assert.equal(kept.invalid, undefined);
  assert.deepEqual(dropped, ["panel-orphan", "panel-invalid"]);
});

test("F8 validToken slides exp then may persist (throttled)", () => {
  const src = readFileSync(new URL("../src/lib/control/session.server.ts", import.meta.url), "utf8");
  const fn = src.match(/export function validToken\([\s\S]*?\n\}/);
  assert.ok(fn, "validToken present");
  // Success path: slide exp, refresh tokenStore, then F2 throttled slide persist (not bare persist every poll).
  assert.match(
    fn[0],
    /row\.exp\s*=\s*Date\.now\(\)\s*\+\s*SESSION_TTL_MS;\s*\n\s*tokenStore\(\)\.set\(token,\s*row\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*maybePersistSessionSlide\(token,\s*row\.exp\);\s*\n\s*return\s+true;/,
  );
  assert.match(src, /function maybePersistSessionSlide/);
  assert.match(src, /markSlidePersisted\(secret,\s*row\.exp\)/);
  // Mint / expire-delete still call persist() immediately (not only the slide throttle).
  assert.match(src, /markSlidePersisted\(secret,\s*row\.exp\);\s*\n\s*persist\(\);/);
});

test("F2 sessionSlideShouldPersist gates on ≥N minute exp advance", () => {
  assert.equal(SESSION_SLIDE_PERSIST_ADVANCE_MS, 10 * 60 * 1000);
  const base = 1_000_000;
  assert.equal(sessionSlideShouldPersist(undefined, base + 1), true, "first slide (no last) persists");
  assert.equal(sessionSlideShouldPersist(base, base + 60_000), false, "1m advance must not persist");
  assert.equal(sessionSlideShouldPersist(base, base + 4_000), false, "~4s poll must not persist");
  assert.equal(
    sessionSlideShouldPersist(base, base + SESSION_SLIDE_PERSIST_ADVANCE_MS - 1),
    false,
    "just under threshold must not persist",
  );
  assert.equal(
    sessionSlideShouldPersist(base, base + SESSION_SLIDE_PERSIST_ADVANCE_MS),
    true,
    "≥10m advance persists",
  );
});

test("F2 maybePersistSessionSlide protocol: poll churn vs threshold", () => {
  // Mirrors maybePersistSessionSlide + sessionSlideShouldPersist without disk I/O.
  const map = new Map();
  let persistCalls = 0;
  function maybePersistSessionSlide(token, nextExp) {
    if (!sessionSlideShouldPersist(map.get(token), nextExp)) return;
    map.set(token, nextExp);
    persistCalls += 1;
  }
  const token = "panel-test";
  const ttl = 30 * 24 * 60 * 60 * 1000;
  // Mint seeds last persisted exp (immediate persist elsewhere).
  const mintedExp = Date.now() + ttl;
  map.set(token, mintedExp);
  // ~4s polls for 9 minutes: exp advances but stays under 10m — no dirty persist.
  for (let i = 1; i <= 135; i++) {
    maybePersistSessionSlide(token, mintedExp + i * 4_000);
  }
  assert.equal(persistCalls, 0, "sub-threshold slides must not persist");
  // Cross 10m advance from minted seed.
  maybePersistSessionSlide(token, mintedExp + SESSION_SLIDE_PERSIST_ADVANCE_MS);
  assert.equal(persistCalls, 1, "threshold crossing persists once");
  maybePersistSessionSlide(token, mintedExp + SESSION_SLIDE_PERSIST_ADVANCE_MS + 4_000);
  assert.equal(persistCalls, 1, "another 4s poll after persist must not re-dirty");
});

test("ping route uses validToken for config auth (rejects expired)", () => {
  const src = readFileSync(new URL("../src/routes/api/ping.ts", import.meta.url), "utf8");
  assert.match(src, /validToken\(\s*token\s*,\s*["']config["']\s*\)/);
  assert.doesNotMatch(src, /memory\(\)\.sessions/);
  assert.match(src, /from\s+["']@\/lib\/control\/session\.server["']/);
});

test("room route uses validToken for session auth (no local hasSession)", () => {
  const src = readFileSync(new URL("../src/routes/api/room.ts", import.meta.url), "utf8");
  assert.match(src, /validToken\(\s*token\s*,\s*["']panel["']\s*\)\s*\|\|\s*validToken\(\s*token\s*,\s*["']config["']\s*\)/);
  assert.doesNotMatch(src, /\bhasSession\b/);
  assert.doesNotMatch(src, /row\.exp\s*&&\s*row\.exp\s*<\s*Date\.now\(\)/);
  assert.match(src, /from\s+["']@\/lib\/control\/session\.server["']/);
});
