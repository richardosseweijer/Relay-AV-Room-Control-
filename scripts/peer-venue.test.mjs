import test from "node:test";
import assert from "node:assert/strict";
import { listLanNicsFrom } from "../src/lib/control/nics.ts";
import {
  DEFAULT_AV_PEER_PORT,
  PEER_AV_SKIP_BAD_HOST,
  PEER_VENUE_SKIP_BAD_PEER_CA,
  PEER_VENUE_SKIP_NO_PEER_CA,
  PEER_VENUE_SKIP_NO_TLS,
  PEER_VENUE_SKIP_OUTBOUND_NONE,
  isIpv4Literal,
  planPeerTransport,
  planPeerTransportForDevice,
  readPeerFaceHint,
  readPeerTrustedCaHints,
  resolvePeerFace,
  resolvePeerTrustedCa,
} from "../src/lib/control/peer-venue.ts";
import { OUTBOUND_NONE_NAME } from "../src/lib/control/nics.ts";

const fixture = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
  ],
  enp1s0: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
};

const nics = listLanNicsFrom(fixture);
const avPick = { name: "enp1s0" };
const outPick = { name: "enp2s0" };
const tlsEnv = { RELAY_TLS_CERT: "/tmp/cert.pem", RELAY_TLS_KEY: "/tmp/key.pem", RELAY_HTTPS_PORT: "8443" };

test("isIpv4Literal accepts dotted quads only", () => {
  assert.equal(isIpv4Literal("10.0.25.20"), true);
  assert.equal(isIpv4Literal("203.0.113.9"), true);
  assert.equal(isIpv4Literal("10.0.25.256"), false);
  assert.equal(isIpv4Literal("host.example"), false);
  assert.equal(isIpv4Literal("file:///etc/passwd"), false);
});

test("readPeerFaceHint maps aliases; empty is auto", () => {
  assert.equal(readPeerFaceHint({}), null);
  assert.equal(readPeerFaceHint({ peerFace: "outbound" }), "outbound");
  assert.equal(readPeerFaceHint({ peerFace: "venue" }), "outbound");
  assert.equal(readPeerFaceHint({ auth: { peerFace: "av" } }), "av");
  assert.equal(readPeerFaceHint({ peerFace: "nic2" }), "outbound");
});

test("resolvePeerFace auto: host on outbound subnet (not AV) → outbound", () => {
  assert.equal(
    resolvePeerFace({ host: "192.168.1.55", nics, avPick, outboundPick: outPick }),
    "outbound",
  );
  assert.equal(
    resolvePeerFace({ host: "10.0.25.20", nics, avPick, outboundPick: outPick }),
    "av",
  );
  assert.equal(
    resolvePeerFace({ host: "192.168.1.55", hint: "av", nics, avPick, outboundPick: outPick }),
    "av",
  );
});

test("planPeerTransport AV: http + AV bind + LAN gate", () => {
  const plan = planPeerTransport({
    host: "10.0.25.20",
    face: "av",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.scheme, "http");
  assert.equal(plan.port, DEFAULT_AV_PEER_PORT);
  assert.equal(plan.localAddress, "10.0.25.10");
  assert.equal(plan.rejectUnauthorized, true);
});

test("planPeerTransport AV rejects non-LAN host", () => {
  const plan = planPeerTransport({
    host: "203.0.113.9",
    face: "av",
    nics,
    avPick,
    outboundPick: outPick,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PEER_AV_SKIP_BAD_HOST);
});

const peerCaPem = `-----BEGIN CERTIFICATE-----
MIIBtjCCAVugAwIBAgIUFRIENDLYCA000000000000000000wCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTUmVsYXkgVmVudWUgQ0EgdGVzdDAeFw0yNjAxMDEwMDAwMDBa
Fw0zNjAxMDEwMDAwMDBaMB4xHDAaBgNVBAMME1JlbGF5IFZlbnVlIENBIHRlc3Qw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACjUzBRMB0GA1UdDgQW
BBT/////////////////////////////////////////MB8GA1UdIwQYMBaAFP//
////////////////////////////////////MA8GA1UdEwEB/wQFMAMBAf8wCgYI
KoZIzj0EAwIDSAAwRQIhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
-----END CERTIFICATE-----`;

test("resolvePeerTrustedCa fail-closed when missing", () => {
  const r = resolvePeerTrustedCa({ env: {} });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "missing");
  assert.equal(r.message, PEER_VENUE_SKIP_NO_PEER_CA);
});

test("resolvePeerTrustedCa accepts inline PEM; rejects private key", () => {
  const ok = resolvePeerTrustedCa({ pem: peerCaPem });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.source, "pem");
  const bad = resolvePeerTrustedCa({
    pem: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.equal(bad.reason, "bad");
  assert.equal(bad.message, PEER_VENUE_SKIP_BAD_PEER_CA);
});

test("resolvePeerTrustedCa reads path via injectible readFile", () => {
  const r = resolvePeerTrustedCa({
    path: "/tmp/peer-ca.pem",
    readFile: (p) => (p === "/tmp/peer-ca.pem" ? peerCaPem : null),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.source, "path");
});

test("readPeerTrustedCaHints prefers device fields then auth", () => {
  assert.deepEqual(
    readPeerTrustedCaHints({ peerTrustedCaPath: "a.pem", auth: { peerTrustedCaPath: "b.pem" } }),
    { path: "a.pem", pem: null },
  );
  assert.deepEqual(
    readPeerTrustedCaHints({ auth: { peerTrustedCaPem: peerCaPem } }),
    { path: null, pem: peerCaPem },
  );
});

test("planPeerTransport venue: https + outbound bind + strict TLS when CA set", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    port: 8443,
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
    peerTrustedCaPem: peerCaPem,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.scheme, "https");
  assert.equal(plan.port, 8443);
  assert.equal(plan.localAddress, "192.168.1.40");
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.ca, peerCaPem);
});

test("planPeerTransport venue fail-closed when trusted CA missing", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    port: 8443,
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PEER_VENUE_SKIP_NO_PEER_CA);
});

test("planPeerTransport venue allows public IPv4 when face outbound + CA", () => {
  const plan = planPeerTransport({
    host: "203.0.113.9",
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
    peerTrustedCaPem: peerCaPem,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.scheme, "https");
  assert.equal(plan.port, 8443);
  assert.equal(plan.rejectUnauthorized, true);
});

test("planPeerTransport venue soft-skips when outbound None", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    face: "outbound",
    nics,
    avPick,
    outboundPick: { name: OUTBOUND_NONE_NAME },
    env: tlsEnv,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PEER_VENUE_SKIP_OUTBOUND_NONE);
});

test("planPeerTransport venue soft-skips when no TLS PEMs", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: {},
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PEER_VENUE_SKIP_NO_TLS);
});

test("planPeerTransport never returns http for outbound face", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    port: 8081,
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
    peerTrustedCaPem: peerCaPem,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.scheme, "https");
  assert.equal(plan.port, 8081); // operator override; still HTTPS
  assert.equal(plan.rejectUnauthorized, true);
});

test("planPeerTransportForDevice auto + room TLS paths + peer CA", () => {
  const plan = planPeerTransportForDevice(
    { host: "192.168.1.55", port: 8443, auth: {}, peerTrustedCaPem: peerCaPem },
    {
      configVersion: "1",
      exportedAt: null,
      sourceRoomId: null,
      room: {
        id: "r",
        name: "R",
        panelAccess: "pin",
        panelPin: null,
        configPin: "x",
        theme: "dark",
        idleDimSeconds: 0,
        grid: { cols: 1, rows: 1 },
        avLanNicName: "enp1s0",
        outboundNicName: "enp2s0",
        tlsCertPath: "/etc/relay/cert.pem",
        tlsKeyPath: "/etc/relay/key.pem",
        network: {
          mode: "dhcp",
          address: "",
          prefix: 24,
          gateway: "",
          dns: "",
          ntp: "",
          timezone: "",
          hostname: "",
        },
      },
      devices: [],
      pages: [],
      macros: [],
      variables: [],
      schedules: [],
      monitors: [],
    },
    nics,
    {},
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.face, "outbound");
  assert.equal(plan.scheme, "https");
  assert.equal(plan.rejectUnauthorized, true);
  assert.ok(plan.ca);
});

test("AV peers still plan when outbound None and no TLS", () => {
  const plan = planPeerTransport({
    host: "10.0.25.20",
    face: "av",
    nics,
    avPick,
    outboundPick: { name: OUTBOUND_NONE_NAME },
    env: {},
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.scheme, "http");
});
