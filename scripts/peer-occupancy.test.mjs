import test from "node:test";
import assert from "node:assert/strict";
import { applyOccupancy, buildPeerGet, occupancyFromVarValue } from "../src/lib/control/peer-payload.ts";

test("var aliases map to Foyer live statuses", () => {
  assert.equal(occupancyFromVarValue("idle"), "available");
  assert.equal(occupancyFromVarValue("OCCUPIED"), "in-session");
  assert.equal(occupancyFromVarValue("busy"), "busy");
  assert.equal(occupancyFromVarValue("off"), "closed");
  assert.equal(occupancyFromVarValue("dnd"), null);
});

test("buildPeerGet emits room object, occupancy, and vars", () => {
  const body = buildPeerGet({
    room: { id: "room-a", name: "Conference A", occupancy: "busy", occupancyVarId: "occ", panelAccess: "pin", panelPin: "1", configPin: "1", theme: "dark", idleDimSeconds: 0, grid: { cols: 1, rows: 1 }, network: { mode: "dhcp", address: "", prefix: 24, gateway: "", dns: "", ntp: "", timezone: "system", hostname: "" } },
    host: { dim: false, locked: true, pageId: null },
    variables: [{ id: "occ", label: "Conference A", kind: "text", default: "available" }],
    vars: { occ: "busy" },
    macros: [{ id: "m1", label: "Start" }],
  });
  assert.equal(typeof body.room, "object");
  assert.equal(body.room.name, "Conference A");
  assert.equal(body.room.id, "room-a");
  assert.equal(body.v, 1);
  assert.equal(body.occupancy, "busy");
  assert.equal(body.host.locked, true);
  assert.equal(body.vars.occ.name, "Conference A");
  assert.equal(body.vars.occ.value, "busy");
  assert.equal(body.macros.m1.name, "Start");
});

test("applyOccupancy writes field and bound var", () => {
  const config = {
    room: { occupancy: "available", occupancyVarId: "occ" },
    variables: [{ id: "occ", label: "Conference A", kind: "text", default: "available" }],
  };
  const vars = { occ: "available" };
  const res = applyOccupancy(config, vars, "in-session");
  assert.equal(res.ok, true);
  assert.equal(config.room.occupancy, "in-session");
  assert.equal(vars.occ, "in-session");
});

test("applyOccupancy dnd is stored but not written to the Foyer var", () => {
  const config = {
    room: { occupancy: "available", occupancyVarId: "occ" },
    variables: [{ id: "occ", label: "Conference A", kind: "text", default: "available" }],
  };
  const vars = { occ: "available" };
  const res = applyOccupancy(config, vars, "do-not-disturb");
  assert.equal(res.ok, true);
  assert.equal(config.room.occupancy, "do-not-disturb");
  assert.equal(vars.occ, "available");
});

test("occupancy falls back to var alias when field unset", () => {
  const body = buildPeerGet({
    room: { id: "r", name: "Hall", panelAccess: "pin", panelPin: "1", configPin: "1", theme: "dark", idleDimSeconds: 0, grid: { cols: 1, rows: 1 }, network: { mode: "dhcp", address: "", prefix: 24, gateway: "", dns: "", ntp: "", timezone: "system", hostname: "" } },
    host: { dim: false, locked: false, pageId: null },
    variables: [{ id: "occupancy", label: "occupancy", kind: "text", default: "idle" }],
    vars: {},
    macros: [],
  });
  assert.equal(body.occupancy, "available");
});
