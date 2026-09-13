import test from "node:test";
import assert from "node:assert/strict";
import { applyOccupancy, buildPeerGet, occupancyFromVarValue, occupancyOf, occupancyVarSpec, withOccupancyVar } from "../src/lib/control/peer-payload.ts";

const roomBase = {
  id: "room-a",
  name: "Conference A",
  panelAccess: "pin",
  panelPin: "1",
  configPin: "1",
  theme: "dark",
  idleDimSeconds: 0,
  grid: { cols: 1, rows: 1 },
  network: { mode: "dhcp", address: "", prefix: 24, gateway: "", dns: "", ntp: "", timezone: "system", hostname: "" },
};

test("aliases map to occupancy values including DND", () => {
  assert.equal(occupancyFromVarValue("idle"), "available");
  assert.equal(occupancyFromVarValue("OCCUPIED"), "in-session");
  assert.equal(occupancyFromVarValue("busy"), "busy");
  assert.equal(occupancyFromVarValue("off"), "closed");
  assert.equal(occupancyFromVarValue("dnd"), "do-not-disturb");
  assert.equal(occupancyFromVarValue("nope"), null);
});

test("buildPeerGet occupancy is the room field, not a var", () => {
  const body = buildPeerGet({
    room: { ...roomBase, occupancy: "busy" },
    host: { dim: false, locked: true, pageId: null },
    variables: [occupancyVarSpec()],
    vars: { occupancy: "available" },
    macros: [{ id: "m1", label: "Start" }],
  });
  assert.equal(typeof body.room, "object");
  assert.equal(body.room.name, "Conference A");
  assert.equal(body.room.id, "room-a");
  assert.equal(body.v, 1);
  assert.equal(body.occupancy, "busy");
  assert.equal(body.host.locked, true);
  assert.equal(body.vars.occupancy.name, "Occupancy");
  assert.equal(body.macros.m1.name, "Start");
});

test("occupancyOf ignores vars and room names", () => {
  assert.equal(occupancyOf({ occupancy: "closed" }), "closed");
  assert.equal(occupancyOf({}), "available");
  assert.equal(occupancyOf({ occupancy: "nope" }), "available");
  assert.equal(occupancyOf({ occupancy: "dnd" }), "do-not-disturb");
});

test("applyOccupancy writes field and baked occupancy var, including DND", () => {
  const config = {
    room: { occupancy: "available" },
    variables: [occupancyVarSpec()],
  };
  const vars = { occupancy: "available" };
  const res = applyOccupancy(config, vars, "do-not-disturb");
  assert.equal(res.ok, true);
  assert.equal(config.room.occupancy, "do-not-disturb");
  assert.equal(vars.occupancy, "do-not-disturb");
});

test("withOccupancyVar bakes a fixed occupancy list", () => {
  const next = withOccupancyVar({ room: {}, variables: [{ id: "scene", label: "Scene", kind: "text", default: "idle" }] });
  const occ = next.variables.find((item) => item.id === "occupancy");
  assert.ok(occ);
  assert.equal(occ.kind, "enum");
  assert.deepEqual(occ.values, ["available", "in-session", "busy", "do-not-disturb", "closed"]);
  assert.equal(next.room.occupancy, "available");
  assert.equal(next.variables.some((item) => item.id === "scene"), true);
});

test("withOccupancyVar overwrites a hijacked occupancy var", () => {
  const next = withOccupancyVar({
    room: { occupancy: "busy" },
    variables: [{ id: "occupancy", label: "Status", kind: "text", default: "idle" }],
  });
  const occ = next.variables.find((item) => item.id === "occupancy");
  assert.equal(occ.kind, "enum");
  assert.equal(occ.label, "Occupancy");
  assert.deepEqual(occ.values, ["available", "in-session", "busy", "do-not-disturb", "closed"]);
  assert.equal(next.room.occupancy, "busy");
});
