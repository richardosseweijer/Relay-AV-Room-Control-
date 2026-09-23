/**
 * samsung-pair trust helper: fail-closed by default; CA / pin / discover modes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateVenueTlsMaterial } from "./venue-tls-crypto.mjs";
import {
  SAMSUNG_PAIR_BAD_TRUST,
  SAMSUNG_PAIR_DISCOVER_HINT,
  SAMSUNG_PAIR_NO_TRUST,
  fingerprintFromPeerCert,
  normalizeFingerprintSha256,
  parseSamsungPairArgv,
  resolveSamsungPairTls,
  samsungPairHelpText,
} from "./samsung-pair-trust.mjs";

test("help text mentions fail-closed and --insecure discover", () => {
  const h = samsungPairHelpText();
  assert.match(h, /--ca=/);
  assert.match(h, /--fingerprint=/);
  assert.match(h, /--insecure/);
  assert.match(h, /fail-closed|required for 8002/i);
});

test("parse positional host/port and flags", () => {
  const a = parseSamsungPairArgv([
    "10.0.25.234",
    "8002",
    "--ca=/tmp/tv.pem",
    "--fingerprint=Aa:Bb",
  ]);
  assert.equal(a.host, "10.0.25.234");
  assert.equal(a.port, 8002);
  assert.equal(a.caPath, "/tmp/tv.pem");
  assert.equal(a.fingerprint, "Aa:Bb");
  assert.equal(a.insecure, false);
});

test("parse --accept-fingerprint alias and --insecure", () => {
  const a = parseSamsungPairArgv([
    "node",
    "scripts/samsung-pair.mjs",
    "192.168.1.5",
    "--insecure",
    "--accept-fingerprint=deadbeef",
  ]);
  assert.equal(a.host, "192.168.1.5");
  assert.equal(a.port, 8002);
  assert.equal(a.insecure, true);
  assert.equal(a.fingerprint, "deadbeef");
});

test("parse --help", () => {
  const a = parseSamsungPairArgv(["--help"]);
  assert.equal(a.help, true);
});

test("normalizeFingerprintSha256 accepts colon or bare hex", () => {
  const bare = "a".repeat(64);
  assert.equal(normalizeFingerprintSha256(bare), bare);
  const colon = bare.match(/.{1,2}/g).join(":");
  assert.equal(normalizeFingerprintSha256(colon), bare);
  assert.equal(normalizeFingerprintSha256("short"), null);
  assert.equal(fingerprintFromPeerCert({ fingerprint256: colon }), bare);
});

test("plain (non-TLS) needs no trust", () => {
  const r = resolveSamsungPairTls({ secure: false });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "plain");
  assert.equal(r.tlsOptions, null);
});

test("TLS fail-closed when trust missing", () => {
  const r = resolveSamsungPairTls({ secure: true, env: {} });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "missing");
  assert.equal(r.message, SAMSUNG_PAIR_NO_TRUST);
});

test("TLS discover mode is explicit --insecure only", () => {
  const r = resolveSamsungPairTls({ secure: true, insecure: true, env: {} });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "discover");
  assert.equal(r.tlsOptions?.rejectUnauthorized, false);
  assert.equal(r.message, SAMSUNG_PAIR_DISCOVER_HINT);
});

test("TLS CA path success wires rejectUnauthorized true + ca", () => {
  const m = generateVenueTlsMaterial({ sanIp: "10.0.25.234" });
  const r = resolveSamsungPairTls({
    secure: true,
    caPath: "/virtual/tv-ca.pem",
    env: {},
    readFile: (p) => (p === "/virtual/tv-ca.pem" ? m.caCertPem : null),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "ca");
  assert.equal(r.tlsOptions?.rejectUnauthorized, true);
  assert.equal(r.tlsOptions?.ca?.trim(), m.caCertPem.trim());
});

test("TLS bad CA path fails closed", () => {
  const r = resolveSamsungPairTls({
    secure: true,
    caPath: "/missing.pem",
    env: {},
    readFile: () => null,
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "bad");
  assert.equal(r.message, SAMSUNG_PAIR_BAD_TRUST);
});

test("TLS pin mode wires pin checker (rejectUnauthorized false only with checker)", () => {
  const pin = "ab".repeat(32);
  const r = resolveSamsungPairTls({
    secure: true,
    fingerprint: pin.match(/.{1,2}/g).join(":"),
    env: {},
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "pin");
  assert.equal(r.fingerprintSha256, pin);
  assert.equal(r.tlsOptions?.rejectUnauthorized, false);
  assert.equal(typeof r.tlsOptions?.checkServerIdentity, "function");
  const ok = r.tlsOptions.checkServerIdentity("tv", {
    fingerprint256: pin.match(/.{1,2}/g).join(":").toUpperCase(),
  });
  assert.equal(ok, undefined);
  const bad = r.tlsOptions.checkServerIdentity("tv", {
    fingerprint256: "cd".repeat(32),
  });
  assert.ok(bad instanceof Error);
  assert.match(bad.message, /pin mismatch/i);
});

test("TLS malformed pin fails closed", () => {
  const r = resolveSamsungPairTls({
    secure: true,
    fingerprint: "not-a-fingerprint",
    env: {},
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "bad");
  assert.equal(r.message, SAMSUNG_PAIR_BAD_TRUST);
});

test("env SAMSUNG_PAIR_CA supplies CA when flag omitted", () => {
  const m = generateVenueTlsMaterial({ sanIp: "192.168.1.9" });
  const r = resolveSamsungPairTls({
    secure: true,
    env: { SAMSUNG_PAIR_CA: "/env/ca.pem" },
    readFile: (p) => (p === "/env/ca.pem" ? m.caCertPem : null),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "ca");
});

test("env SAMSUNG_PAIR_FINGERPRINT supplies pin when flag omitted", () => {
  const pin = "11".repeat(32);
  const r = resolveSamsungPairTls({
    secure: true,
    env: { SAMSUNG_PAIR_FINGERPRINT: pin },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mode, "pin");
  assert.equal(r.fingerprintSha256, pin);
});

test("happy path never soft-verifies without pin/discover", () => {
  const m = generateVenueTlsMaterial({ sanIp: "10.0.0.1" });
  const ca = resolveSamsungPairTls({
    secure: true,
    caPath: "x.pem",
    readFile: () => m.caCertPem,
    env: {},
  });
  assert.equal(ca.ok, true);
  if (ca.ok) assert.equal(ca.tlsOptions?.rejectUnauthorized, true);

  const missing = resolveSamsungPairTls({ secure: true, env: {} });
  assert.equal(missing.ok, false);
});
