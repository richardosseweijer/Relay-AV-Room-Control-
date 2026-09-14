import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFoyerSession,
  foyerPeerEndpoint,
  isLoopbackHostname,
  parseFoyerSession,
  withFoyerSessionVars,
  FOYER_KIND_ID,
  FOYER_TITLE_ID,
  FOYER_START_ID,
  FOYER_END_ID,
} from "../src/lib/control/foyer-peer.ts";
import { authorizePeerGet, isLoopbackIp, isTcpLoopback, tcpPeerAddress, signPeer } from "../src/lib/control/peer-auth.ts";
import { buildPeerOccupancyGet, occupancyOf } from "../src/lib/control/peer-payload.ts";

test("foyer peer URL is loopback /api/peer only", () => {
  assert.equal(foyerPeerEndpoint("http://127.0.0.1:8080")?.pathname, "/api/peer");
  assert.equal(foyerPeerEndpoint("http://127.0.0.1:8080/")?.host, "127.0.0.1:8080");
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("10.0.25.10"), false);
});

test("parseFoyerSession takes current or next and ignores junk", () => {
  const now = parseFoyerSession({
    ok: true,
    v: 1,
    session: { kind: "now", title: "Design review", startIso: "2026-09-11T10:00:00Z", endIso: "2026-09-11T11:00:00Z" },
  });
  assert.equal(now?.kind, "now");
  assert.equal(now?.title, "Design review");
  assert.equal(parseFoyerSession({ ok: true, session: null }), null);
  assert.equal(parseFoyerSession({ ok: true, session: { kind: "later", title: "x", startIso: "a", endIso: "b" } }), null);
});

test("applyFoyerSession writes baked vars, including empty", () => {
  const vars = {};
  applyFoyerSession(vars, { kind: "next", title: "Lunch", startIso: "2026-09-11T12:00:00Z", endIso: "2026-09-11T13:00:00Z" });
  assert.equal(vars[FOYER_KIND_ID], "next");
  assert.equal(vars[FOYER_TITLE_ID], "Lunch");
  assert.equal(vars[FOYER_START_ID], "2026-09-11T12:00:00Z");
  assert.equal(vars[FOYER_END_ID], "2026-09-11T13:00:00Z");
  applyFoyerSession(vars, null);
  assert.equal(vars[FOYER_KIND_ID], "none");
  assert.equal(vars[FOYER_TITLE_ID], "");
});

test("withFoyerSessionVars bakes the four foyer fields", () => {
  const next = withFoyerSessionVars({ room: {}, variables: [{ id: "scene", label: "Scene", kind: "text", default: "idle" }] });
  const ids = next.variables.map((item) => item.id);
  assert.equal(ids.includes(FOYER_KIND_ID), true);
  assert.equal(ids.includes(FOYER_TITLE_ID), true);
  assert.equal(ids.includes("scene"), true);
});

test("loopback GET is allowed unsigned; POST still needs HMAC", () => {
  const loop = new Request("http://10.0.25.10:8081/api/peer", { method: "GET" });
  const lan = new Request("http://127.0.0.1:8081/api/peer", {
    method: "GET",
    headers: { host: "127.0.0.1:8081", "x-forwarded-for": "127.0.0.1" },
  });
  Object.assign(loop, { runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } } });
  Object.assign(lan, { runtime: { node: { req: { socket: { remoteAddress: "10.0.25.10" } } } } });
  assert.equal(authorizePeerGet({ key: "", request: loop }), true);
  assert.equal(authorizePeerGet({ key: "secret", request: loop }), true);
  assert.equal(authorizePeerGet({ key: "secret", request: lan }), false);
});

test("Host and X-Forwarded-For are not loopback; TCP peer is", () => {
  assert.equal(isLoopbackIp("127.0.0.1"), true);
  assert.equal(isLoopbackIp("::1"), true);
  assert.equal(isLoopbackIp("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackIp("10.0.25.10"), false);
  const spoof = new Request("http://127.0.0.1:8081/api/peer", {
    method: "GET",
    headers: { host: "127.0.0.1:8081", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost" },
  });
  Object.assign(spoof, { runtime: { node: { req: { socket: { remoteAddress: "10.0.25.10" } } } } });
  assert.equal(tcpPeerAddress(spoof), "10.0.25.10");
  assert.equal(isTcpLoopback(spoof), false);
  assert.equal(authorizePeerGet({ key: "secret", request: spoof }), false);
  const none = new Request("http://127.0.0.1:8081/api/peer");
  assert.equal(tcpPeerAddress(none), null);
  assert.equal(isTcpLoopback(none), false);
  assert.equal(authorizePeerGet({ key: "secret", request: none }), false);
});

test("LAN GET with HMAC still works", () => {
  const key = "lan-hmac-peer-key";
  const ts = String(Date.now());
  const sig = signPeer(key, "GET", "/api/peer", ts, "");
  const headers = new Headers();
  headers.set("x-relay-ts", ts);
  headers.set("x-relay-auth", sig);
  const lan = new Request("http://10.0.25.10:8081/api/peer", { method: "GET", headers });
  Object.assign(lan, { runtime: { node: { req: { socket: { remoteAddress: "10.0.25.10" } } } } });
  // Do not call verifyPeerRequest first — the replay map would consume this digest:ts.
  assert.equal(authorizePeerGet({ key, request: lan }), true);
});

test("unsigned occupancy GET body has no vars or macros", () => {
  const body = buildPeerOccupancyGet({
    room: { occupancy: "in-session" },
    host: { locked: true },
  });
  const json = JSON.stringify(body);
  assert.equal(body.ok, true);
  assert.equal(body.occupancy, "in-session");
  assert.equal(body.host.locked, true);
  assert.equal(json.includes("vars"), false);
  assert.equal(json.includes("macros"), false);
  assert.equal(json.includes("pageId"), false);
  assert.equal(occupancyOf({ occupancy: "dnd" }), "do-not-disturb");
});
