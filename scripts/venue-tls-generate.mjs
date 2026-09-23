/**
 * C1 — orchestrate Generate: soft-skip when outbound None / no IPv4,
 * write PEMs, return status suitable for admin API + B1 path wiring.
 */
import { X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import {
  generateVenueTlsMaterial,
  isValidIpv4,
  VENUE_TLS_KEY_TYPE,
  VENUE_TLS_CA_YEARS,
  VENUE_TLS_LEAF_YEARS,
} from "./venue-tls-crypto.mjs";
import {
  readPemIfPresent,
  venueTlsPaths,
  venueTlsPemsPresent,
  writeVenueTlsPems,
  fileModeBits,
} from "./venue-tls-paths.mjs";
import { OUTBOUND_NONE_NAME } from "./https-venue-listen.mjs";

export const VENUE_TLS_SKIP_OUTBOUND_NONE =
  "Venue TLS Generate skipped: outbound NIC is None (air-gap / no venue NIC). AV HTTP unaffected.";

export const VENUE_TLS_SKIP_NO_IP =
  "Venue TLS Generate skipped: outbound NIC has no IPv4. AV HTTP unaffected.";

export const VENUE_TLS_SKIP_REFUSE_ALL_ZEROS =
  "Venue TLS Generate skipped: refusing SAN IP 0.0.0.0. AV HTTP unaffected.";

/**
 * @typedef {{
 *   present: boolean,
 *   keyType: string,
 *   sanIp: string | null,
 *   leafFingerprint256: string | null,
 *   caFingerprint256: string | null,
 *   leafNotAfter: string | null,
 *   caNotAfter: string | null,
 *   paths: {
 *     dir: string,
 *     caCertPath: string,
 *     caKeyPath: string,
 *     serverCertPath: string,
 *     serverKeyPath: string,
 *   },
 *   keyModes?: { caKey: number | null, serverKey: number | null },
 * }} VenueTlsStatus
 */

/**
 * @param {string} rootDir
 * @returns {VenueTlsStatus}
 */
export function readVenueTlsStatus(rootDir) {
  const paths = venueTlsPaths(rootDir);
  const leafPem = readPemIfPresent(paths.serverCertPath);
  const caPem = readPemIfPresent(paths.caCertPath);
  /** @type {VenueTlsStatus} */
  const base = {
    present: venueTlsPemsPresent(rootDir),
    keyType: VENUE_TLS_KEY_TYPE,
    sanIp: null,
    leafFingerprint256: null,
    caFingerprint256: null,
    leafNotAfter: null,
    caNotAfter: null,
    paths: {
      dir: paths.dir,
      caCertPath: paths.caCertPath,
      caKeyPath: paths.caKeyPath,
      serverCertPath: paths.serverCertPath,
      serverKeyPath: paths.serverKeyPath,
    },
    keyModes: {
      caKey: fileModeBits(paths.caKeyPath),
      serverKey: fileModeBits(paths.serverKeyPath),
    },
  };
  if (!leafPem || !caPem) return { ...base, present: false };
  try {
    const leaf = new X509Certificate(leafPem);
    const ca = new X509Certificate(caPem);
    const san = String(leaf.subjectAltName ?? "");
    const ipMatch = /IP Address:([0-9.]+)/i.exec(san);
    return {
      ...base,
      present: true,
      sanIp: ipMatch?.[1] ?? null,
      leafFingerprint256: leaf.fingerprint256,
      caFingerprint256: ca.fingerprint256,
      leafNotAfter: leaf.validToDate.toISOString(),
      caNotAfter: ca.validToDate.toISOString(),
    };
  } catch {
    return { ...base, present: existsSync(paths.serverCertPath) };
  }
}

/**
 * Pure soft-skip gate before crypto.
 * @param {{ outboundName?: string | null, outboundIpv4?: string | null }} opts
 * @returns {{ ok: true, ipv4: string } | { ok: false, reason: string }}
 */
export function planVenueTlsGenerate(opts) {
  const name = String(opts.outboundName ?? "").trim();
  if (!name || name === OUTBOUND_NONE_NAME) {
    return { ok: false, reason: VENUE_TLS_SKIP_OUTBOUND_NONE };
  }
  const ipv4 = String(opts.outboundIpv4 ?? "").trim();
  if (!ipv4) {
    return { ok: false, reason: VENUE_TLS_SKIP_NO_IP };
  }
  if (ipv4 === "0.0.0.0") {
    return { ok: false, reason: VENUE_TLS_SKIP_REFUSE_ALL_ZEROS };
  }
  if (!isValidIpv4(ipv4)) {
    return { ok: false, reason: VENUE_TLS_SKIP_NO_IP };
  }
  return { ok: true, ipv4 };
}

/**
 * Generate + persist PEMs. Does not mutate room JSON (caller wires tlsCertPath/tlsKeyPath).
 * @param {{
 *   rootDir: string,
 *   outboundName?: string | null,
 *   outboundIpv4?: string | null,
 *   now?: Date,
 * }} opts
 * @returns {{
 *   ok: true,
 *   status: VenueTlsStatus,
 *   tlsCertPath: string,
 *   tlsKeyPath: string,
 *   lifetimes: { caYears: number, leafYears: number },
 * } | { ok: false, skipped: true, reason: string }}
 */
export function generateAndPersistVenueTls(opts) {
  const plan = planVenueTlsGenerate({
    outboundName: opts.outboundName,
    outboundIpv4: opts.outboundIpv4,
  });
  if (!plan.ok) {
    return { ok: false, skipped: true, reason: plan.reason };
  }

  const material = generateVenueTlsMaterial({
    sanIp: plan.ipv4,
    now: opts.now,
  });
  const paths = writeVenueTlsPems(opts.rootDir, material);
  const status = readVenueTlsStatus(opts.rootDir);
  return {
    ok: true,
    status,
    tlsCertPath: paths.serverCertPath,
    tlsKeyPath: paths.serverKeyPath,
    lifetimes: { caYears: VENUE_TLS_CA_YEARS, leafYears: VENUE_TLS_LEAF_YEARS },
  };
}
