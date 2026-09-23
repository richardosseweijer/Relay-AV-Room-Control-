import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readVenueTlsCaCertPem,
  planVenueTlsCaDownload,
  venueTlsCaTokenFromRequest,
  VENUE_TLS_CA_DOWNLOAD_FILENAME,
  VENUE_TLS_CA_CONTENT_TYPE,
} from "./venue-tls-ca-download.mjs";
import { venueTlsPaths, writeVenueTlsPems } from "./venue-tls-paths.mjs";
import { generateVenueTlsMaterial } from "./venue-tls-crypto.mjs";

test("planVenueTlsCaDownload: 401 without auth", () => {
  const r = planVenueTlsCaDownload({ authorized: false, caPem: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n" });
  assert.equal(r.status, 401);
  assert.equal(r.json, true);
  assert.match(r.body, /Config lock/);
});

test("planVenueTlsCaDownload: 404 when CA missing", () => {
  const r = planVenueTlsCaDownload({ authorized: true, caPem: null });
  assert.equal(r.status, 404);
  assert.match(r.body, /Generate first/);
});

test("planVenueTlsCaDownload: 200 PEM attachment never looks like a key", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
  const r = planVenueTlsCaDownload({ authorized: true, caPem: pem });
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], VENUE_TLS_CA_CONTENT_TYPE);
  assert.match(r.headers["content-disposition"], new RegExp(VENUE_TLS_CA_DOWNLOAD_FILENAME));
  assert.equal(r.body, pem);
  assert.equal(/PRIVATE KEY/i.test(r.body), false);
});

test("readVenueTlsCaCertPem: returns CA cert only after generate", () => {
  const root = mkdtempSync(join(tmpdir(), "venue-ca-dl-"));
  const material = generateVenueTlsMaterial({ sanIp: "203.0.113.5" });
  writeVenueTlsPems(root, material);
  const pem = readVenueTlsCaCertPem(root);
  assert.ok(pem);
  assert.match(pem, /BEGIN CERTIFICATE/);
  assert.equal(/PRIVATE KEY/i.test(pem), false);
  const paths = venueTlsPaths(root);
  assert.ok(paths.caKeyPath.endsWith("ca.key.pem"));
});

test("readVenueTlsCaCertPem: null when absent; rejects key-shaped body", () => {
  const root = mkdtempSync(join(tmpdir(), "venue-ca-missing-"));
  assert.equal(readVenueTlsCaCertPem(root), null);
  const paths = venueTlsPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.caCertPath, "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n");
  assert.equal(readVenueTlsCaCertPem(root), null);
});

test("venueTlsCaTokenFromRequest: Bearer wins over query", () => {
  const req = new Request("https://203.0.113.9:8443/api/venue-tls-ca?token=query-tok", {
    headers: { authorization: "Bearer bearer-tok" },
  });
  assert.equal(venueTlsCaTokenFromRequest(req), "bearer-tok");
});

test("venueTlsCaTokenFromRequest: query fallback for same-origin click", () => {
  const req = new Request("https://203.0.113.9:8443/api/venue-tls-ca?token=click-tok");
  assert.equal(venueTlsCaTokenFromRequest(req), "click-tok");
});
