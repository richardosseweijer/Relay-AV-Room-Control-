/**
 * Default/control base URL for panel + Foyer Relay URL hints.
 * Prefers live AV-LAN IPv4 (same address HTTP listens on). Never advertises
 * loopback as the production default when AV is unset / has no IPv4 — soft-fail
 * with a clear reason instead. Lab escape: RELAY_LISTEN_HOST=127.0.0.1.
 *
 * Does not widen listen; listen stays AV-only (or the env override).
 */
import {
  httpListenHostFrom,
  listLanNicsFrom,
  avLanPickFromRoomStore,
} from "./http-listen-host.mjs";

export const DEFAULT_PRODUCTION_CONTROL_PORT = 8081;

export const AV_UNSET_CONTROL_URL_REASON =
  "AV-LAN NIC is unset — no panel/Foyer control URL until AV-LAN has an IPv4 (lab: RELAY_LISTEN_HOST=127.0.0.1).";

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

function pickSet(/** @type {NicPick} */ pick) {
  if (String(pick?.name ?? "").trim()) return true;
  return pick?.index != null && Number.isFinite(Number(pick.index));
}

function resolveNic(/** @type {LanNic[]} */ nics, /** @type {NicPick} */ pick) {
  const name = String(pick?.name ?? "").trim();
  if (name) {
    const hit = nics.find((nic) => nic.name === name);
    if (hit) return hit;
  }
  if (pick?.index != null && Number.isFinite(Number(pick.index))) {
    const hit = nics.find((nic) => nic.index === Number(pick.index));
    if (hit) return hit;
  }
  return null;
}

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
  if (!pickSet(pick)) {
    return { ok: false, reason: AV_UNSET_CONTROL_URL_REASON };
  }
  const nic = resolveNic(opts.nics, pick);
  if (!nic) {
    return { ok: false, reason: "AV-LAN NIC not found — no panel/Foyer control URL." };
  }
  if (!nic.ipv4) {
    return { ok: false, reason: avNoIpv4ControlUrlReason(nic.name) };
  }
  return {
    ok: true,
    url: `${protocol}://${nic.ipv4}:${port}`,
    host: nic.ipv4,
  };
}

/**
 * Same selection as listen host when env override is set; otherwise AV live IPv4
 * for the advertised URL (soft-fail when AV unset / no IPv4 — unlike listen, which
 * falls back to 127.0.0.1 with a warning).
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
