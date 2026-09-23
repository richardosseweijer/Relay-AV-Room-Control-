/**
 * Phase B3 — plan Relay↔Relay peer transport: AV-LAN HTTP vs venue/NIC2 HTTPS.
 * B4 nicFace (device-face.ts) is the general device bind face; peerFace stays here
 * for HMAC peers (auto | av | outbound + HTTP/HTTPS). Do not regress auto.
 * LE/ACME PARKED (was B2). Never cleartext on the venue face.
 *
 * Strict peer TLS (venue HTTPS):
 * - Fail-closed: venue peer requires a configured trusted peer CA (remote room’s
 *   Download CA PEM). Happy path is rejectUnauthorized:true + ca=that PEM.
 * - AV-LAN HTTP peers unchanged (no TLS). Soft rejectUnauthorized is not the
 *   venue peer happy path.
 *
 * Operator model:
 * - Point a remote relay-host device at the other room’s AV IP:8081 → AV HTTP + HMAC.
 * - Point it at the other room’s live NIC2 IP (Networks UI) with port 8443 (or
 *   RELAY_HTTPS_PORT), or set peerFace=outbound → venue HTTPS + outbound bind + HMAC.
 * - Exchange CAs: remote Networks → Download CA → save PEM → set Trusted peer CA
 *   path on this relay-host (or paste PEM / RELAY_PEER_TRUSTED_CA). Same-install
 *   loop: point at this room’s data/tls/venue/ca.cert.pem.
 * - Auto: host on outbound NIC subnet (not AV) ⇒ venue; else AV.
 * - nicFace on non-peer devices selects AV vs venue bind only; for relay-host use Peer face.
 */
import { readFileSync } from "node:fs";
import type { DeviceInstance, RoomConfig } from "./types";
import { allowedLanHost } from "./engine-policy.ts";
import {
  type LanNic,
  type NicPick,
  OUTBOUND_NONE_NAME,
  cidrContains,
  isOutboundNonePick,
  listLanNics,
  outboundBindFrom,
  resolveNic,
  avLanBind,
} from "./nics.ts";
import {
  DEFAULT_HTTPS_PORT,
  resolveHttpsPort,
  resolveTlsPaths,
} from "../../../scripts/https-venue-listen.mjs";

export type PeerFace = "av" | "outbound";

export const PEER_VENUE_SKIP_OUTBOUND_NONE =
  "Venue peer skipped: outbound NIC is None (air-gap / no venue NIC). AV-LAN peers still work.";

export const PEER_VENUE_SKIP_NO_BIND =
  "Venue peer skipped: outbound NIC has no usable IPv4 bind. AV-LAN peers still work.";

export const PEER_VENUE_SKIP_NO_TLS =
  "Venue peer skipped: TLS cert/key not configured (set RELAY_TLS_CERT + RELAY_TLS_KEY, or room tlsCertPath + tlsKeyPath). AV-LAN peers still work.";

export const PEER_VENUE_SKIP_BAD_HOST =
  "Venue peer skipped: host must be an IPv4 address on the venue face.";

export const PEER_VENUE_SKIP_NO_PEER_CA =
  "Venue peer skipped: trusted peer CA not configured. On the remote room: Networks → Download CA, save the PEM, then set Trusted peer CA path (or paste) on this relay-host device. Same-install loop: use this room’s data/tls/venue/ca.cert.pem. AV-LAN peers still work.";

export const PEER_VENUE_SKIP_BAD_PEER_CA =
  "Venue peer skipped: trusted peer CA PEM missing, unreadable, or not a certificate. Fix the path/paste (Download CA again if needed). AV-LAN peers still work.";

export const PEER_AV_SKIP_BAD_HOST = "Host not on room LAN";

/** Default AV listen / peer port when device.port unset. */
export const DEFAULT_AV_PEER_PORT = 8081;

export function isIpv4Literal(host: string): boolean {
  const raw = String(host ?? "").trim();
  const m = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).map(Number).every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

function nicHolds(nic: LanNic | null | undefined, ip: string): boolean {
  if (!nic?.ipv4) return false;
  if (nic.cidr) return cidrContains(ip, nic.cidr);
  return nic.ipv4 === ip;
}

/** Normalize device.peerFace / auth.peerFace. Empty = auto. */
export function readPeerFaceHint(device: {
  peerFace?: string | null;
  auth?: Record<string, string>;
}): PeerFace | null {
  const raw = String(device.peerFace ?? device.auth?.peerFace ?? "").trim().toLowerCase();
  if (raw === "outbound" || raw === "venue" || raw === "nic2") return "outbound";
  if (raw === "av" || raw === "lan" || raw === "nic1") return "av";
  return null;
}

/**
 * Auto face: host on outbound subnet (and not AV) → outbound; else AV.
 * Explicit peerFace wins.
 */
export function resolvePeerFace(opts: {
  host: string;
  hint?: PeerFace | null;
  nics: LanNic[];
  avPick: NicPick;
  outboundPick: NicPick;
}): PeerFace {
  if (opts.hint === "av" || opts.hint === "outbound") return opts.hint;
  const host = String(opts.host ?? "").trim();
  if (!isIpv4Literal(host)) return "av";
  const avNic = resolveNic(opts.nics, opts.avPick);
  const outNic = resolveNic(opts.nics, opts.outboundPick);
  const onAv = nicHolds(avNic, host);
  const onOut = nicHolds(outNic, host);
  if (onOut && !onAv) return "outbound";
  return "av";
}

export type PeerTransportPlan =
  | {
      ok: true;
      face: PeerFace;
      scheme: "http" | "https";
      host: string;
      port: number;
      localAddress?: string;
      /**
       * Venue peers: always true (strict verify against trusted peer CA).
       * AV HTTP peers: true (unused for http).
       */
      rejectUnauthorized: boolean;
      /** PEM of the trusted peer CA (venue HTTPS only). */
      ca?: string;
    }
  | { ok: false; face: PeerFace; message: string };

export type PeerTrustedCaSource = "pem" | "path" | "env";

export type PeerTrustedCaResult =
  | { ok: true; pem: string; source: PeerTrustedCaSource }
  | { ok: false; message: string; reason: "missing" | "bad" };

function looksLikeCertPem(pem: string): boolean {
  return (
    pem.includes("BEGIN CERTIFICATE") &&
    !/BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY/i.test(pem)
  );
}

/**
 * Resolve trusted peer CA for venue HTTPS.
 * Precedence: inline PEM → path → env RELAY_PEER_TRUSTED_CA (file path).
 * Fail-closed when nothing usable is configured.
 */
export function resolvePeerTrustedCa(opts: {
  pem?: string | null;
  path?: string | null;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string | null;
}): PeerTrustedCaResult {
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
      return { ok: false, message: PEER_VENUE_SKIP_BAD_PEER_CA, reason: "bad" };
    }
    return { ok: true, pem: inline, source: "pem" };
  }

  const pathRaw = String(opts.path ?? "").trim();
  if (pathRaw) {
    const body = readFile(pathRaw);
    if (!body || !looksLikeCertPem(body)) {
      return { ok: false, message: PEER_VENUE_SKIP_BAD_PEER_CA, reason: "bad" };
    }
    return { ok: true, pem: body, source: "path" };
  }

  const envPath = String(opts.env?.RELAY_PEER_TRUSTED_CA ?? "").trim();
  if (envPath) {
    const body = readFile(envPath);
    if (!body || !looksLikeCertPem(body)) {
      return { ok: false, message: PEER_VENUE_SKIP_BAD_PEER_CA, reason: "bad" };
    }
    return { ok: true, pem: body, source: "env" };
  }

  return { ok: false, message: PEER_VENUE_SKIP_NO_PEER_CA, reason: "missing" };
}

/** Read peerTrustedCaPath / peerTrustedCaPem from device fields or auth bag. */
export function readPeerTrustedCaHints(device: {
  peerTrustedCaPath?: string | null;
  peerTrustedCaPem?: string | null;
  auth?: Record<string, string>;
}): { path?: string | null; pem?: string | null } {
  const path =
    String(device.peerTrustedCaPath ?? device.auth?.peerTrustedCaPath ?? "").trim() || null;
  const pem =
    String(device.peerTrustedCaPem ?? device.auth?.peerTrustedCaPem ?? "").trim() || null;
  return { path, pem };
}

/**
 * Pure planner for one peer call. Soft-fail venue when outbound None / no bind.
 * Venue always HTTPS + strict CA verify (fail-closed if CA missing).
 * AV always HTTP. HMAC stays the caller's job.
 */
export function planPeerTransport(opts: {
  host: string;
  port?: number | null;
  face: PeerFace;
  nics: LanNic[];
  avPick: NicPick;
  outboundPick: NicPick;
  httpsPort?: number | string | null;
  env?: NodeJS.ProcessEnv;
  roomJson?: unknown;
  /** Trusted peer CA (venue HTTPS). Prefer resolvePeerTrustedCa at call sites. */
  peerTrustedCaPem?: string | null;
  peerTrustedCaPath?: string | null;
  readPeerCaFile?: (path: string) => string | null;
}): PeerTransportPlan {
  const host = String(opts.host ?? "").trim();
  if (!host) return { ok: false, face: opts.face, message: "No peer host" };

  if (opts.face === "outbound") {
    const name = String(opts.outboundPick?.name ?? "").trim();
    if (isOutboundNonePick(opts.outboundPick) || name === OUTBOUND_NONE_NAME) {
      return { ok: false, face: "outbound", message: PEER_VENUE_SKIP_OUTBOUND_NONE };
    }
    const tls = resolveTlsPaths({ env: opts.env, roomJson: opts.roomJson });
    if (!tls) {
      return { ok: false, face: "outbound", message: PEER_VENUE_SKIP_NO_TLS };
    }
    const bind = outboundBindFrom(opts.nics, opts.outboundPick);
    if (!bind.ok) return { ok: false, face: "outbound", message: bind.message };
    if (bind.none || !bind.localAddress) {
      return { ok: false, face: "outbound", message: PEER_VENUE_SKIP_NO_BIND };
    }
    // Venue: raw IPv4 only (LE/FQDN PARKED). Never cleartext.
    if (!isIpv4Literal(host)) {
      return { ok: false, face: "outbound", message: PEER_VENUE_SKIP_BAD_HOST };
    }
    const ca = resolvePeerTrustedCa({
      pem: opts.peerTrustedCaPem,
      path: opts.peerTrustedCaPath,
      env: opts.env,
      readFile: opts.readPeerCaFile,
    });
    if (!ca.ok) {
      return { ok: false, face: "outbound", message: ca.message };
    }
    const port =
      opts.port != null && Number.isFinite(Number(opts.port)) && Number(opts.port) > 0
        ? Number(opts.port)
        : resolveHttpsPort(opts.httpsPort != null ? String(opts.httpsPort) : undefined);
    return {
      ok: true,
      face: "outbound",
      scheme: "https",
      host,
      port,
      localAddress: bind.localAddress,
      rejectUnauthorized: true,
      ca: ca.pem,
    };
  }

  // AV face — existing LAN gate (RFC1918).
  if (!allowedLanHost(host)) {
    return { ok: false, face: "av", message: PEER_AV_SKIP_BAD_HOST };
  }
  const bind = avLanBind(opts.nics, opts.avPick);
  if (!bind.ok) return { ok: false, face: "av", message: bind.message };
  const port =
    opts.port != null && Number.isFinite(Number(opts.port)) && Number(opts.port) > 0
      ? Number(opts.port)
      : DEFAULT_AV_PEER_PORT;
  return {
    ok: true,
    face: "av",
    scheme: "http",
    host,
    port,
    localAddress: bind.localAddress,
    rejectUnauthorized: true,
  };
}

/** Room-config convenience for engine call sites. */
export function planPeerTransportForDevice(
  device: Pick<
    DeviceInstance,
    "host" | "port" | "peerFace" | "auth" | "peerTrustedCaPath" | "peerTrustedCaPem"
  >,
  config?: RoomConfig,
  nics: LanNic[] = listLanNics(),
  env: NodeJS.ProcessEnv = process.env,
): PeerTransportPlan {
  const avPick: NicPick = {
    name: config?.room.avLanNicName,
    index: config?.room.avLanNicIndex ?? null,
  };
  const outboundPick: NicPick = {
    name: config?.room.outboundNicName,
    index: config?.room.outboundNicIndex ?? null,
  };
  const face = resolvePeerFace({
    host: device.host,
    hint: readPeerFaceHint(device),
    nics,
    avPick,
    outboundPick,
  });
  const caHints = readPeerTrustedCaHints(device);
  return planPeerTransport({
    host: device.host,
    port: device.port,
    face,
    nics,
    avPick,
    outboundPick,
    httpsPort: env.RELAY_HTTPS_PORT ?? DEFAULT_HTTPS_PORT,
    env,
    roomJson: config ? { config: { room: config.room } } : undefined,
    peerTrustedCaPem: caHints.pem,
    peerTrustedCaPath: caHints.path,
  });
}
