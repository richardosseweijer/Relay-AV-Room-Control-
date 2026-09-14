import test from "node:test";
import assert from "node:assert/strict";
import { applyOccupancy, buildPeerGet, occupancyCode, occupancyFromVarValue, occupancyOf, occupancyVarSpec, withOccupancyVar } from "../src/lib/control/peer-payload.ts";

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
  assert.equal(occupancyFromVarValue("0"), "closed");
  assert.equal(occupancyFromVarValue("1"), "available");
  assert.equal(occupancyFromVarValue("2"), "in-session");
  assert.equal(occupancyFromVarValue("3"), "do-not-disturb");
  assert.equal(occupancyFromVarValue("idle"), "available");
  assert.equal(occupancyFromVarValue("open"), "available");
  assert.equal(occupancyFromVarValue("OCCUPIED"), "in-session");
  assert.equal(occupancyFromVarValue("busy"), "in-session");
  assert.equal(occupancyFromVarValue("off"), "closed");
  assert.equal(occupancyFromVarValue("dnd"), "do-not-disturb");
  assert.equal(occupancyFromVarValue("nope"), null);
  assert.equal(occupancyCode("closed"), "0");
  assert.equal(occupancyCode("available"), "1");
  assert.equal(occupancyCode("in-session"), "2");
  assert.equal(occupancyCode("busy"), "2");
  assert.equal(occupancyCode("do-not-disturb"), "3");
});

test("buildPeerGet occupancy is the room field, not a var", () => {
  const body = buildPeerGet({
    room: { ...roomBase, occupancy: "in-session" },
    host: { dim: false, locked: true, pageId: null },
    variables: [occupancyVarSpec()],
    vars: { occupancy: "1" },
    macros: [{ id: "m1", label: "Start" }],
  });
  assert.equal(typeof body.room, "object");
  assert.equal(body.room.name, "Conference A");
  assert.equal(body.room.id, "room-a");
  assert.equal(body.v, 1);
  assert.equal(body.occupancy, "in-session");
  assert.equal(body.host.locked, true);
  assert.equal(body.vars.occupancy.name, "Occupancy");
  assert.equal(body.vars.occupancy.value, "1");
  assert.equal(body.macros.m1.name, "Start");
});

test("occupancyOf ignores vars and room names", () => {
  assert.equal(occupancyOf({ occupancy: "closed" }), "closed");
  assert.equal(occupancyOf({}), "available");
  assert.equal(occupancyOf({ occupancy: "nope" }), "available");
  assert.equal(occupancyOf({ occupancy: "dnd" }), "do-not-disturb");
  assert.equal(occupancyOf({ occupancy: "busy" }), "in-session");
});

test("applyOccupancy writes field as Foyer string and var as 0-3", () => {
  const config = {
    room: { occupancy: "available" },
    variables: [occupancyVarSpec()],
  };
  const vars = { occupancy: "1" };
  const res = applyOccupancy(config, vars, "3");
  assert.equal(res.ok, true);
  assert.equal(config.room.occupancy, "do-not-disturb");
  assert.equal(vars.occupancy, "3");
  assert.equal(applyOccupancy(config, vars, "busy").ok, true);
  assert.equal(config.room.occupancy, "in-session");
  assert.equal(vars.occupancy, "2");
});

test("withOccupancyVar bakes a fixed occupancy list", () => {
  const next = withOccupancyVar({ room: {}, variables: [{ id: "scene", label: "Scene", kind: "text", default: "idle" }] });
  const occ = next.variables.find((item) => item.id === "occupancy");
  assert.ok(occ);
  assert.equal(occ.kind, "enum");
  assert.deepEqual(occ.values, ["0", "1", "2", "3"]);
  assert.equal(occ.default, "1");
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
  assert.deepEqual(occ.values, ["0", "1", "2", "3"]);
  assert.equal(next.room.occupancy, "in-session");
});
