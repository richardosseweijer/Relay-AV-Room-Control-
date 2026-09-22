import test from "node:test";
import assert from "node:assert/strict";
import { hashPin } from "../src/lib/control/pins.server.ts";
import { panelUnlockAllowed } from "../src/lib/control/panel-unlock-rule.ts";
import { applyRoomSession, PANEL_TOKEN_KEY } from "../src/lib/control/panel-token.ts";
import { readFileSync } from "node:fs";
import { dropExpiredSessions } from "../src/lib/control/session-expire.ts";

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
