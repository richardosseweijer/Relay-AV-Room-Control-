/**
 * Strict venue peer TLS: success with trusted CA, reject wrong CA, fail-closed when CA missing.
 * Uses in-box generateVenueTlsMaterial + requestHttpExact (same path as signedPeerFetch).
 */
import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { generateVenueTlsMaterial } from "./venue-tls-crypto.mjs";
import { requestHttpExact } from "../src/lib/control/http-client.ts";
import {
  PEER_VENUE_SKIP_NO_PEER_CA,
  planPeerTransport,
} from "../src/lib/control/peer-venue.ts";
import { listLanNicsFrom } from "../src/lib/control/nics.ts";

const fixture = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp1s0: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
};
const nics = listLanNicsFrom(fixture);
const avPick = { name: "enp1s0" };
const outPick = { name: "enp2s0" };
const tlsEnv = { RELAY_TLS_CERT: "/tmp/cert.pem", RELAY_TLS_KEY: "/tmp/key.pem", RELAY_HTTPS_PORT: "8443" };

/** @param {{ cert: string, key: string }} pems */
function listenHttps(pems) {
  const server = https.createServer(
    { cert: pems.cert, key: pems.key },
    (_req, res) => {
      res.statusCode = 200;
      res.end("peer-ok");
    },
  );
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

test("strict peer TLS: verifies against trusted CA (happy path)", async () => {
  const m = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const { server, port } = await listenHttps({ cert: m.leafCertPem, key: m.leafKeyPem });
  try {
    const res = await requestHttpExact(
      `https://127.0.0.1:${port}/api/peer`,
      "GET",
      "",
      {},
      5000,
      64 * 1024,
      undefined,
      true,
      m.caCertPem,
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.text, "peer-ok");
  } finally {
    server.close();
  }
});

test("strict peer TLS: rejects cert not chained to configured CA", async () => {
  const good = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const other = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const { server, port } = await listenHttps({ cert: good.leafCertPem, key: good.leafKeyPem });
  try {
    const res = await requestHttpExact(
      `https://127.0.0.1:${port}/api/peer`,
      "GET",
      "",
      {},
      5000,
      64 * 1024,
      undefined,
      true,
      other.caCertPem,
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.match(res.text, /certificate|unable to verify|self-signed|UNABLE_TO_VERIFY|auth/i);
  } finally {
    server.close();
  }
});

test("planner fail-closed when venue CA missing (clear install-peer-CA error)", () => {
  const plan = planPeerTransport({
    host: "192.168.1.55",
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, PEER_VENUE_SKIP_NO_PEER_CA);
  assert.match(plan.message, /Download CA|trusted peer CA/i);
});

test("planner strict success wires rejectUnauthorized + ca PEM", () => {
  const m = generateVenueTlsMaterial({ sanIp: "192.168.1.55" });
  const plan = planPeerTransport({
    host: "192.168.1.55",
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    env: tlsEnv,
    peerTrustedCaPem: m.caCertPem,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.ca?.trim(), m.caCertPem.trim());
  assert.equal(plan.scheme, "https");
});
