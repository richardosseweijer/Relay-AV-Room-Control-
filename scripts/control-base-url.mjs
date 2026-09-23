/**
 * Default/control base URL for panel + Foyer Relay URL hints.
 * Prefers live AV-LAN IPv4 (same address HTTP listens on). When AV pick is
 * unset/invalid, uses the same first-scanned auto-map as HTTP listen. Soft-fail
 * only when no scanned NICs exist or the chosen iface has no IPv4 yet.
 * Never advertises loopback as the production default. Lab escape: RELAY_LISTEN_HOST=127.0.0.1.
 *
 * Does not widen listen; listen stays AV-only (or the env override).
 */
import {
  httpListenHostFrom,
  listLanNicsFrom,
  avLanPickFromRoomStore,
  effectiveAvLanPick,
} from "./http-listen-host.mjs";

export const DEFAULT_PRODUCTION_CONTROL_PORT = 8081;

export const AV_UNSET_CONTROL_URL_REASON =
  "No scanned NIC for AV-LAN — no panel/Foyer control URL (lab: RELAY_LISTEN_HOST=127.0.0.1).";

/**
 * @param {string} [name]
 */
export function avNoIpv4ControlUrlReason(name) {
  const nic = String(name ?? "").trim() || "AV-LAN";
  return `AV-LAN NIC ${nic} has no IPv4 — no panel/Foyer control URL (will not advertise loopback).`;
}

/**
 * @typedef {{ index: number, name: string, ipv4: string | null, cidr?: string | null, label?: string }} LanNic
 * @typedef {{ name?: string | null, index?: number | null }} NicPick
 * @typedef {{ ok: true, url: string, host: string, warning?: string } | { ok: false, reason: string }} ControlBaseUrlResult
 */

/** @param {string} host */
function isLoopbackHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/**
 * Pure: build http(s)://host:port for panel / Foyer Relay URL.
 * @param {{
 *   nics: LanNic[],
 *   pick?: NicPick,
 *   port?: number | string | null,
 *   envHost?: string | null,
 *   protocol?: "http" | "https",
 * }} opts
 * @returns {ControlBaseUrlResult}
 */
export function controlBaseUrlFrom(opts) {
  const portNum = Number(opts.port);
  const port = Number.isFinite(portNum) && portNum > 0 ? Math.floor(portNum) : DEFAULT_PRODUCTION_CONTROL_PORT;
  const protocol = opts.protocol === "https" ? "https" : "http";
  const envHost = String(opts.envHost ?? "").trim();
  if (envHost) {
    /** @type {{ ok: true, url: string, host: string, warning?: string }} */
    const ok = {
      ok: true,
      url: `${protocol}://${envHost}:${port}`,
      host: envHost,
    };
    if (isLoopbackHost(envHost)) {
      ok.warning = "RELAY_LISTEN_HOST is loopback (lab escape).";
    }
    return ok;
  }
  const pick = opts.pick ?? {};
  const eff = effectiveAvLanPick(opts.nics, pick);
  if (!eff.nic) {
    return { ok: false, reason: AV_UNSET_CONTROL_URL_REASON };
  }
  if (!eff.nic.ipv4) {
    return { ok: false, reason: avNoIpv4ControlUrlReason(eff.nic.name) };
  }
  /** @type {{ ok: true, url: string, host: string, warning?: string }} */
  const ok = {
    ok: true,
    url: `${protocol}://${eff.nic.ipv4}:${port}`,
    host: eff.nic.ipv4,
  };
  if (eff.autoMapped && eff.warning) ok.warning = eff.warning;
  return ok;
}

/**
 * Same selection as listen host when env override is set; otherwise AV live IPv4
 * for the advertised URL (same auto-map as listen when AV unset/invalid; soft-fail
 * when no scanned NICs / no IPv4).
 * @param {{ envHost?: string | null, roomJson?: unknown, nics: LanNic[], port?: number | string | null, protocol?: "http" | "https" }} opts
 * @returns {ControlBaseUrlResult}
 */
export function resolveControlBaseUrl(opts) {
  return controlBaseUrlFrom({
    nics: opts.nics,
    pick: avLanPickFromRoomStore(opts.roomJson),
    port: opts.port,
    envHost: opts.envHost,
    protocol: opts.protocol,
  });
}

/**
 * Normalize IPv4/IPv6-mapped peer for same-host hairpin compare.
 * @param {string} ip
 */
export function normalizePeerIp(ip) {
  const a = String(ip ?? "").trim().toLowerCase();
  if (a.startsWith("::ffff:")) return a.slice(7);
  return a;
}

/**
 * True when TCP peer is the HTTP listen host (same-PC hairpin to AV IPv4).
 * Loopback is handled separately by isLoopbackIp / isTcpLoopback.
 * @param {string | null | undefined} peerIp
 * @param {string | null | undefined} listenHost
 */
export function isListenHostPeer(peerIp, listenHost) {
  const peer = normalizePeerIp(peerIp ?? "");
  const host = normalizePeerIp(listenHost ?? "");
  if (!peer || !host) return false;
  if (isLoopbackHost(host)) return false;
  return peer === host;
}

// Re-export listen helpers used by tests that import this module as a one-stop.
export { httpListenHostFrom, listLanNicsFrom, avLanPickFromRoomStore };
