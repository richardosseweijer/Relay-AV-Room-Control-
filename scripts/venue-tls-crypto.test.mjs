import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, X509Certificate } from "node:crypto";
import https from "node:https";
import {
  generateVenueTlsMaterial,
  isValidIpv4,
  ipv4ToOctets,
  VENUE_TLS_KEY_TYPE,
  VENUE_TLS_CA_YEARS,
  VENUE_TLS_LEAF_YEARS,
} from "./venue-tls-crypto.mjs";

test("isValidIpv4 / ipv4ToOctets", () => {
  assert.equal(isValidIpv4("203.0.113.9"), true);
  assert.equal(isValidIpv4("0.0.0.0"), true);
  assert.equal(isValidIpv4("999.1.1.1"), false);
  assert.equal(isValidIpv4("host"), false);
  assert.deepEqual([...ipv4ToOctets("10.20.30.40")], [10, 20, 30, 40]);
});

test("generateVenueTlsMaterial: ECDSA P-256 leaf with IP SAN; CA issues leaf", () => {
  const m = generateVenueTlsMaterial({ sanIp: "203.0.113.9" });
  assert.equal(m.keyType, VENUE_TLS_KEY_TYPE);
  assert.equal(m.sanIp, "203.0.113.9");
  const leaf = new X509Certificate(m.leafCertPem);
  const ca = new X509Certificate(m.caCertPem);
  assert.equal(ca.ca, true);
  assert.equal(leaf.checkIP("203.0.113.9"), "203.0.113.9");
  assert.equal(leaf.checkIssued(ca), true);
  assert.equal(leaf.checkPrivateKey(createPrivateKey(m.leafKeyPem)), true);
  assert.equal(VENUE_TLS_CA_YEARS, 10);
  assert.equal(VENUE_TLS_LEAF_YEARS, 2);
  const years =
    (leaf.validToDate.getTime() - leaf.validFromDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  assert.ok(years > 1.5 && years < 2.5, `leaf lifetime ~2y, got ${years}`);
});

test("generateVenueTlsMaterial rejects empty / 0.0.0.0 SAN", () => {
  assert.throws(() => generateVenueTlsMaterial({ sanIp: "" }));
  assert.throws(() => generateVenueTlsMaterial({ sanIp: "0.0.0.0" }));
});

test("generated PEMs serve HTTPS", async () => {
  const m = generateVenueTlsMaterial({ sanIp: "198.51.100.7" });
  const server = https.createServer(
    { cert: m.leafCertPem, key: m.leafKeyPem },
    (_req, res) => {
      res.end("ok");
    },
  );
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      https
        .get({ hostname: "127.0.0.1", port, rejectUnauthorized: false }, (res) => {
          assert.equal(res.statusCode, 200);
          server.close();
          resolve(undefined);
        })
        .on("error", (err) => {
          server.close();
          reject(err);
        });
    });
  });
});
