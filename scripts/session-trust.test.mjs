import test from "node:test";
import assert from "node:assert/strict";
import { hashPin } from "../src/lib/control/pins.server.ts";
import { panelUnlockAllowed } from "../src/lib/control/panel-unlock-rule.ts";
import { applyRoomSession, PANEL_TOKEN_KEY } from "../src/lib/control/panel-token.ts";
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
