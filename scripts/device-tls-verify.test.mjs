/**
 * Strict venue device HTTPS: success with trusted CA, reject wrong CA,
 * fail-closed when trust missing on outbound, pin success / mismatch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { generateVenueTlsMaterial } from "./venue-tls-crypto.mjs";
import { requestHttpExact } from "../src/lib/control/http-client.ts";
import {
  DEVICE_TLS_SKIP_NO_TRUST,
  DEVICE_VENUE_AV_ONLY,
  applyDeviceTlsTrustToConnect,
  normalizeTlsFingerprintSha256,
  nicFaceProtocolGate,
  planDeviceBind,
  resolveDeviceTlsTrust,
} from "../src/lib/control/device-face.ts";
import { listLanNicsFrom } from "../src/lib/control/nics.ts";
import { X509Certificate } from "node:crypto";

const fixture = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp1s0: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
  enp2s0: [{ address: "192.168.1.40", family: "IPv4", internal: false, cidr: "192.168.1.40/24" }],
};
const nics = listLanNicsFrom(fixture);
const avPick = { name: "enp1s0" };
const outPick = { name: "enp2s0" };

/** @param {{ cert: string, key: string }} pems */
function listenHttps(pems) {
  const server = https.createServer(
    { cert: pems.cert, key: pems.key },
    (_req, res) => {
      res.statusCode = 200;
      res.end("device-ok");
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

test("cast blocked on venue nicFace", () => {
  const gate = nicFaceProtocolGate("outbound", "cast");
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.match(gate.message, /Cast/);
    assert.match(gate.message, /AV-only|AV-LAN/);
  }
  assert.match(DEVICE_VENUE_AV_ONLY, /AV-LAN/);
});

test("outbound HTTPS fail-closed when device trust missing", () => {
  const plan = planDeviceBind({
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    needsTls: true,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.message, DEVICE_TLS_SKIP_NO_TRUST);
  assert.match(plan.message, /configure device|CA|pin/i);
});

test("outbound HTTPS strict success wires rejectUnauthorized + ca", () => {
  const m = generateVenueTlsMaterial({ sanIp: "192.168.1.9" });
  const plan = planDeviceBind({
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    needsTls: true,
    deviceTrustedCaPem: m.caCertPem,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.ca?.trim(), m.caCertPem.trim());
  assert.equal(plan.localAddress, "192.168.1.40");
});

test("AV without trust uses system store (rejectUnauthorized true, no soft)", () => {
  const plan = planDeviceBind({
    face: "av",
    nics,
    avPick,
    outboundPick: outPick,
    needsTls: true,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.ca, undefined);
});

test("non-TLS outbound bind does not require device trust", () => {
  const plan = planDeviceBind({
    face: "outbound",
    nics,
    avPick,
    outboundPick: outPick,
    needsTls: false,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.rejectUnauthorized, true);
  assert.equal(plan.localAddress, "192.168.1.40");
});

test("live HTTPS: verifies against device trusted CA", async () => {
  const m = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const { server, port } = await listenHttps({ cert: m.leafCertPem, key: m.leafKeyPem });
  try {
    const res = await requestHttpExact(
      `https://127.0.0.1:${port}/status`,
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
    assert.equal(res.text, "device-ok");
  } finally {
    server.close();
  }
});

test("live HTTPS: rejects cert not chained to configured CA", async () => {
  const good = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const other = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const { server, port } = await listenHttps({ cert: good.leafCertPem, key: good.leafKeyPem });
  try {
    const res = await requestHttpExact(
      `https://127.0.0.1:${port}/status`,
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

test("sha256 pin: success and mismatch", async () => {
  const m = generateVenueTlsMaterial({ sanIp: "127.0.0.1" });
  const leaf = new X509Certificate(m.leafCertPem);
  const pin = normalizeTlsFingerprintSha256(leaf.fingerprint256);
  assert.ok(pin);
  const trust = resolveDeviceTlsTrust({
    face: "outbound",
    needsTls: true,
    fingerprint: pin,
  });
  assert.equal(trust.ok, true);
  if (!trust.ok) return;
  const tls = applyDeviceTlsTrustToConnect(trust);
  assert.equal(tls.rejectUnauthorized, false);
  assert.ok(tls.checkServerIdentity);

  const { server, port } = await listenHttps({ cert: m.leafCertPem, key: m.leafKeyPem });
  try {
    const okRes = await requestHttpExact(
      `https://127.0.0.1:${port}/status`,
      "GET",
      "",
      {},
      5000,
      64 * 1024,
      undefined,
      tls.rejectUnauthorized,
      undefined,
      tls.checkServerIdentity,
    );
    assert.equal(okRes.ok, true, okRes.text);

    const badTrust = resolveDeviceTlsTrust({
      face: "outbound",
      needsTls: true,
      fingerprint: "aa".repeat(32),
    });
    assert.equal(badTrust.ok, true);
    if (!badTrust.ok) return;
    const badTls = applyDeviceTlsTrustToConnect(badTrust);
    const badRes = await requestHttpExact(
      `https://127.0.0.1:${port}/status`,
      "GET",
      "",
      {},
      5000,
      64 * 1024,
      undefined,
      badTls.rejectUnauthorized,
      undefined,
      badTls.checkServerIdentity,
    );
    assert.equal(badRes.ok, false);
    assert.match(badRes.text, /pin mismatch|fingerprint/i);
  } finally {
    server.close();
  }
});
