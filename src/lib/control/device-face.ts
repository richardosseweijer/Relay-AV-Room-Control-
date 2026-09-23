/**
 * Phase B4 — per-device nicFace: av | outbound (default av).
 *
 * peerFace (B3, peer-venue.ts) remains the narrow relay-host HMAC transport
 * selector (auto | av | outbound) and switches HTTP↔HTTPS for peers.
 * nicFace is the general device I/O bind face: which NIC supplies localAddress.
 * It has no auto (unset = av for back-compat). It does not rewrite peerFace.
 *
 * Venue rules (same soft-fail spirit as B3):
 * - outbound None / no IPv4 → soft-fail that device only; AV devices keep working.
 * - No cleartext HTTP/WS on venue (http / websocket → clear error).
 * - Multicast AV protocols (sACN, ipMIDI multicast) stay AV-only.
 * - Cast stays AV-only (Google Cast TLS cannot be verified with a normal CA;
 *   soft verify only on AV — never venue).
 * - HTTPS / tls-websocket: explicit device trust (CA PEM/path or sha256 pin).
 *   Venue without trust → fail-closed. Soft rejectUnauthorized:false is not the
 *   happy path for third-party device HTTPS.
 * - LE/ACME PARKED (was B2). No IP forward. No 0.0.0.0 listen.
 */
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { PeerCertificate } from "node:tls";
import type { DeviceInstance, LanProtocol, RoomConfig } from "./types";
import { allowedLanHost } from "./engine-policy.ts";
import {
  type LanNic,
  type NicPick,
  OUTBOUND_NONE_NAME,
  isOutboundNonePick,
  listLanNics,
  outboundBindFrom,
  avLanBind,
} from "./nics.ts";
import { isIpv4Literal } from "./peer-venue.ts";

export type NicFace = "av" | "outbound";

export const DEVICE_VENUE_SKIP_OUTBOUND_NONE =
  "Device venue face skipped: outbound NIC is None (air-gap / no venue NIC). AV-face devices still work.";

export const DEVICE_VENUE_SKIP_NO_BIND =
  "Device venue face skipped: outbound NIC has no usable IPv4 bind. AV-face devices still work.";

export const DEVICE_VENUE_SKIP_CLEARTEXT =
  "nicFace=outbound forbids cleartext on venue; use https / tls-websocket, or relay-host Peer face (peerFace) for HMAC peers.";

/** Inventory resource.httpPath is always cleartext HTTP today — refuse on venue with a pointed reason. */
export const DEVICE_VENUE_SKIP_INVENTORY_CLEARTEXT =
  "Inventory httpPath is cleartext HTTP — nicFace=outbound forbids cleartext on venue. Use nicFace=av for inventory HTTP, or an HTTPS / Peer-face path for venue.";

export const DEVICE_VENUE_AV_ONLY =
  "Protocol stays on AV-LAN (multicast / AV-only by design); nicFace=outbound is invalid for this driver.";

export const DEVICE_VENUE_SKIP_BAD_HOST =
  "Venue device face: host must be an IPv4 address (no DNS; LE/FQDN PARKED).";

export const DEVICE_TLS_SKIP_NO_TRUST =
  "Device HTTPS/TLS skipped: configure device trusted CA (path or PEM paste) or sha256 cert pin. Soft TLS verify is not allowed on the venue face (and prefer pin/CA on AV for self-signed gear).";

export const DEVICE_TLS_SKIP_BAD_TRUST =
  "Device HTTPS/TLS skipped: trusted CA PEM missing, unreadable, or not a certificate; or sha256 pin is malformed. Fix path/paste/pin.";

/** Normalize device.nicFace / auth.nicFace. Empty = av (back-compat). */
export function readNicFace(device: {
  nicFace?: string | null;
  auth?: Record<string, string>;
}): NicFace {
  const raw = String(device.nicFace ?? device.auth?.nicFace ?? "").trim().toLowerCase();
  if (raw === "outbound" || raw === "venue" || raw === "nic2") return "outbound";
  return "av";
}

export type DeviceBindPlan =
  | {
      ok: true;
      face: NicFace;
      localAddress?: string;
      /**
       * TLS verify for device HTTPS / tls-websocket.
       * Always true when CA configured; pin-only may use false + checkServerIdentity.
       * Never blanket soft on venue.
       */
      rejectUnauthorized: boolean;
      /** Trusted CA PEM when configured. */
      ca?: string;
      /** SHA-256 pin (lowercase hex, no colons) when configured. */
      fingerprintSha256?: string;
      /** Node tls checkServerIdentity when pinning. */
      checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
    }
  | { ok: false; face: NicFace; message: string };

function looksLikeCertPem(pem: string): boolean {
  return (
    pem.includes("BEGIN CERTIFICATE") &&
    !/BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY/i.test(pem)
  );
}

/** Normalize sha256 fingerprint: allow colon-hex or bare hex; return lowercase bare hex or null. */
export function normalizeTlsFingerprintSha256(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (s.length !== 64) return null;
  return s;
}

export type DeviceTlsTrustSource = "pem" | "path" | "pin" | "system";

export type DeviceTlsTrustResult =
  | {
      ok: true;
      source: DeviceTlsTrustSource;
      rejectUnauthorized: boolean;
      ca?: string;
      fingerprintSha256?: string;
      checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
    }
  | { ok: false; message: string; reason: "missing" | "bad" };

/** Read deviceTrustedCa* / tlsFingerprintSha256 from device fields or auth bag. */
export function readDeviceTlsTrustHints(device: {
  deviceTrustedCaPath?: string | null;
  deviceTrustedCaPem?: string | null;
  tlsFingerprintSha256?: string | null;
  auth?: Record<string, string>;
}): { path?: string | null; pem?: string | null; fingerprint?: string | null } {
  const path =
    String(device.deviceTrustedCaPath ?? device.auth?.deviceTrustedCaPath ?? "").trim() || null;
  const pem =
    String(device.deviceTrustedCaPem ?? device.auth?.deviceTrustedCaPem ?? "").trim() || null;
  const fingerprint =
    String(device.tlsFingerprintSha256 ?? device.auth?.tlsFingerprintSha256 ?? "").trim() || null;
  return { path, pem, fingerprint };
}

function pinChecker(expectedBareHex: string): (host: string, cert: PeerCertificate) => Error | undefined {
  return (_host, cert) => {
    const got = normalizeTlsFingerprintSha256(cert.fingerprint256);
    if (!got || got !== expectedBareHex) {
      return new Error(
        `TLS certificate pin mismatch (expected sha256 ${expectedBareHex.slice(0, 12)}…, got ${got ? got.slice(0, 12) + "…" : "none"})`,
      );
    }
    return undefined;
  };
}

/**
 * Resolve device TLS trust for https / tls-websocket.
 * Precedence: inline PEM → path → sha256 pin → (AV only) system CAs.
 * Venue (outbound) without CA/pin → fail-closed.
 */
export function resolveDeviceTlsTrust(opts: {
  face: NicFace;
  /** When false, skip TLS trust (non-TLS protocols). */
  needsTls: boolean;
  pem?: string | null;
  path?: string | null;
  fingerprint?: string | null;
  readFile?: (path: string) => string | null;
}): DeviceTlsTrustResult {
  if (!opts.needsTls) {
    return { ok: true, source: "system", rejectUnauthorized: true };
  }

  const readFile =
    opts.readFile ??
    ((p: string) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });

  const inline = String(opts.pem ?? "").trim();
  if (inline) {
    if (!looksLikeCertPem(inline)) {
      return { ok: false, message: DEVICE_TLS_SKIP_BAD_TRUST, reason: "bad" };
    }
    try {
      // Validate parseable cert
      new X509Certificate(inline);
    } catch {
      return { ok: false, message: DEVICE_TLS_SKIP_BAD_TRUST, reason: "bad" };
    }
    return { ok: true, source: "pem", rejectUnauthorized: true, ca: inline };
  }

  const pathRaw = String(opts.path ?? "").trim();
  if (pathRaw) {
    const body = readFile(pathRaw);
    if (!body || !looksLikeCertPem(body)) {
      return { ok: false, message: DEVICE_TLS_SKIP_BAD_TRUST, reason: "bad" };
    }
    try {
      new X509Certificate(body);
    } catch {
      return { ok: false, message: DEVICE_TLS_SKIP_BAD_TRUST, reason: "bad" };
    }
    return { ok: true, source: "path", rejectUnauthorized: true, ca: body };
  }

  const pinRaw = String(opts.fingerprint ?? "").trim();
  if (pinRaw) {
    const pin = normalizeTlsFingerprintSha256(pinRaw);
    if (!pin) {
      return { ok: false, message: DEVICE_TLS_SKIP_BAD_TRUST, reason: "bad" };
    }
    // Explicit pin: checkServerIdentity verifies fingerprint (self-signed OK).
    // applyDeviceTlsTrustToConnect sets rejectUnauthorized:false ONLY with this pin checker.
    return {
      ok: true,
      source: "pin",
      rejectUnauthorized: true,
      fingerprintSha256: pin,
      checkServerIdentity: pinChecker(pin),
    };
  }

  // No explicit trust configured.
  if (opts.face === "outbound") {
    return { ok: false, message: DEVICE_TLS_SKIP_NO_TRUST, reason: "missing" };
  }
  // AV: system trust store (public CAs). Self-signed AV gear must set CA or pin.
  return { ok: true, source: "system", rejectUnauthorized: true };
}

/**
 * Pin-only connections need rejectUnauthorized:false + checkServerIdentity,
 * because self-signed leaves fail chain verify before the pin runs.
 * CA mode keeps rejectUnauthorized:true.
 */
export function applyDeviceTlsTrustToConnect(
  trust: Extract<DeviceTlsTrustResult, { ok: true }>,
): {
  rejectUnauthorized: boolean;
  ca?: string;
  fingerprintSha256?: string;
  checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
} {
  if (trust.source === "pin" && trust.fingerprintSha256 && trust.checkServerIdentity) {
    return {
      rejectUnauthorized: false,
      fingerprintSha256: trust.fingerprintSha256,
      checkServerIdentity: trust.checkServerIdentity,
    };
  }
  return {
    rejectUnauthorized: trust.rejectUnauthorized,
    ca: trust.ca,
    fingerprintSha256: trust.fingerprintSha256,
    checkServerIdentity: trust.checkServerIdentity,
  };
}

/**
 * Resolve bind localAddress for one device. Soft-fail outbound when None / no IPv4.
 * Does not change HTTP listen or peerFace planning.
 * TLS trust is applied when needsTls=true (https / tls-websocket / https status URLs).
 */
export function planDeviceBind(opts: {
  face: NicFace;
  nics: LanNic[];
  avPick: NicPick;
  outboundPick: NicPick;
  /** When true, resolve device TLS trust into the plan (default false for bind-only callers). */
  needsTls?: boolean;
  deviceTrustedCaPem?: string | null;
  deviceTrustedCaPath?: string | null;
  tlsFingerprintSha256?: string | null;
  readDeviceCaFile?: (path: string) => string | null;
}): DeviceBindPlan {
  let localAddress: string | undefined;
  if (opts.face === "outbound") {
    const name = String(opts.outboundPick?.name ?? "").trim();
    if (isOutboundNonePick(opts.outboundPick) || name === OUTBOUND_NONE_NAME) {
      return { ok: false, face: "outbound", message: DEVICE_VENUE_SKIP_OUTBOUND_NONE };
    }
    const bind = outboundBindFrom(opts.nics, opts.outboundPick);
    if (!bind.ok) {
      const msg = /no ipv4/i.test(bind.message) ? DEVICE_VENUE_SKIP_NO_BIND : bind.message;
      return { ok: false, face: "outbound", message: msg };
    }
    if (bind.none || !bind.localAddress) {
      return { ok: false, face: "outbound", message: DEVICE_VENUE_SKIP_NO_BIND };
    }
    localAddress = bind.localAddress;
  } else {
    const bind = avLanBind(opts.nics, opts.avPick);
    if (!bind.ok) return { ok: false, face: "av", message: bind.message };
    localAddress = bind.localAddress;
  }

  const needsTls = opts.needsTls === true;
  if (!needsTls) {
    // Non-TLS: rejectUnauthorized unused; keep true as safe default (no soft).
    return {
      ok: true,
      face: opts.face,
      localAddress,
      rejectUnauthorized: true,
    };
  }

  const trust = resolveDeviceTlsTrust({
    face: opts.face,
    needsTls: true,
    pem: opts.deviceTrustedCaPem,
    path: opts.deviceTrustedCaPath,
    fingerprint: opts.tlsFingerprintSha256,
    readFile: opts.readDeviceCaFile,
  });
  if (!trust.ok) {
    return { ok: false, face: opts.face, message: trust.message };
  }
  const tls = applyDeviceTlsTrustToConnect(trust);
  return {
    ok: true,
    face: opts.face,
    localAddress,
    rejectUnauthorized: tls.rejectUnauthorized,
    ca: tls.ca,
    fingerprintSha256: tls.fingerprintSha256,
    checkServerIdentity: tls.checkServerIdentity,
  };
}

export function planDeviceBindForDevice(
  device: Pick<
    DeviceInstance,
    "nicFace" | "auth" | "deviceTrustedCaPath" | "deviceTrustedCaPem" | "tlsFingerprintSha256"
  >,
  config?: RoomConfig,
  nics: LanNic[] = listLanNics(),
  opts?: { needsTls?: boolean },
): DeviceBindPlan {
  const avPick: NicPick = {
    name: config?.room.avLanNicName,
    index: config?.room.avLanNicIndex ?? null,
  };
  const outboundPick: NicPick = {
    name: config?.room.outboundNicName,
    index: config?.room.outboundNicIndex ?? null,
  };
  const hints = readDeviceTlsTrustHints(device);
  return planDeviceBind({
    face: readNicFace(device),
    nics,
    avPick,
    outboundPick,
    needsTls: opts?.needsTls === true,
    deviceTrustedCaPem: hints.pem,
    deviceTrustedCaPath: hints.path,
    tlsFingerprintSha256: hints.fingerprint,
  });
}

/** True when the LAN protocol (or URL) uses TLS. */
export function protocolNeedsTls(protocol: string | undefined, url?: string): boolean {
  const proto = String(protocol || "").toLowerCase();
  if (proto === "https" || proto === "tls-websocket") return true;
  if (url && /^https:/i.test(url)) return true;
  return false;
}

/**
 * Protocols that must not be forced onto the venue face.
 * Multicast lighting/MIDI stay AV; cleartext HTTP/WS never on venue.
 * Cast stays AV-only (cannot do normal TLS verify).
 */
export function nicFaceProtocolGate(
  face: NicFace,
  protocol: string | undefined,
  lan?: { multicast?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (face !== "outbound") return { ok: true };
  const proto = String(protocol || "").toLowerCase() as LanProtocol | string;
  if (proto === "sacn") {
    return { ok: false, message: `${DEVICE_VENUE_AV_ONLY} (sACN multicast)` };
  }
  if (proto === "ipmidi" && lan?.multicast !== false) {
    return { ok: false, message: `${DEVICE_VENUE_AV_ONLY} (ipMIDI multicast)` };
  }
  if (proto === "cast") {
    return { ok: false, message: `${DEVICE_VENUE_AV_ONLY} (Cast TLS is AV-only; pin/CA not applicable — keep nicFace=av)` };
  }
  if (proto === "http" || proto === "websocket") {
    return { ok: false, message: DEVICE_VENUE_SKIP_CLEARTEXT };
  }
  return { ok: true };
}

/**
 * Host allow for device I/O. AV face = existing RFC1918 gate.
 * Outbound face = IPv4 literal (public or private) like B3 venue peer; no DNS (LE/FQDN PARKED).
 */
export function deviceHostAllowed(
  face: NicFace,
  host: string | undefined,
  opts?: { localOk?: boolean },
): { ok: true } | { ok: false; message: string } {
  const raw = String(host ?? "").trim();
  if (face === "av") {
    if (!allowedLanHost(raw, opts)) {
      return { ok: false, message: "Host not on room LAN" };
    }
    return { ok: true };
  }
  if (opts?.localOk && /^(localhost|127\.0\.0\.1|::1)$/i.test(raw)) return { ok: true };
  if (!isIpv4Literal(raw)) {
    return { ok: false, message: DEVICE_VENUE_SKIP_BAD_HOST };
  }
  return { ok: true };
}
