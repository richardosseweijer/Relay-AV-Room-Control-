/**
 * Phase A2 — HTTP panel/API listen host from AV-LAN.
 * Never returns 0.0.0.0. Outbound / NIC2 is ignored (None/down must not block AV listen).
 * RELAY_LISTEN_HOST env override is honored when set (documented escape hatch).
 *
 * Kept as plain .mjs so boot wrappers (with-app-env, update-relay) and nics.ts share one implementation.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export const AV_UNSET_LISTEN_WARNING =
  "AV-LAN NIC is unset — HTTP listen bound to 127.0.0.1 (loopback only). Set AV-LAN for production panel access.";

/** @typedef {{ index: number, name: string, ipv4: string | null, cidr?: string | null, label?: string }} LanNic */
/** @typedef {{ name?: string | null, index?: number | null }} NicPick */
/**
 * @typedef {{ ok: true, host: string, warning?: string } | { ok: false, reason: string }} HttpListenHostResult
 */

function pickSet(/** @type {NicPick} */ pick) {
  if (String(pick?.name ?? "").trim()) return true;
  return pick?.index != null && Number.isFinite(Number(pick.index));
}

/**
 * @param {LanNic[]} nics
 * @param {NicPick} pick
 * @returns {LanNic | null}
 */
function resolveNic(nics, pick) {
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

/**
 * Pure: given NIC list + AV pick → listen host.
 * AV unset → 127.0.0.1 + warning; AV set missing/no IPv4 → refuse (not 0.0.0.0).
 * @param {LanNic[]} nics
 * @param {NicPick} [pick]
 * @returns {HttpListenHostResult}
 */
export function httpListenHostFrom(nics, pick = {}) {
  if (!pickSet(pick)) {
    return { ok: true, host: "127.0.0.1", warning: AV_UNSET_LISTEN_WARNING };
  }
  const nic = resolveNic(nics, pick);
  if (!nic) {
    return {
      ok: false,
      reason: "AV-LAN NIC not found — refusing HTTP listen (will not bind 0.0.0.0).",
    };
  }
  if (!nic.ipv4) {
    return {
      ok: false,
      reason: `AV-LAN NIC ${nic.name} has no IPv4 — refusing HTTP listen (will not bind 0.0.0.0).`,
    };
  }
  return { ok: true, host: nic.ipv4 };
}

/**
 * Extract AV-LAN pick from persisted relay-room.json shape (`{ config: { room } }`) or bare config.
 * @param {unknown} raw
 * @returns {NicPick}
 */
export function avLanPickFromRoomStore(raw) {
  if (!raw || typeof raw !== "object") return {};
  const root = /** @type {Record<string, unknown>} */ (raw);
  const config =
    root.config && typeof root.config === "object"
      ? /** @type {Record<string, unknown>} */ (root.config)
      : root;
  const room =
    config.room && typeof config.room === "object"
      ? /** @type {Record<string, unknown>} */ (config.room)
      : null;
  if (!room) return {};
  const name = room.avLanNicName;
  const index = room.avLanNicIndex;
  return {
    name: typeof name === "string" || name == null ? /** @type {string | null} */ (name ?? null) : null,
    index: typeof index === "number" || index == null ? /** @type {number | null} */ (index ?? null) : null,
  };
}

/**
 * @param {string} rootDir
 * @returns {unknown | null}
 */
export function readRoomStoreSync(rootDir) {
  try {
    return JSON.parse(readFileSync(join(rootDir, "data", "relay-room.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Boot resolver: RELAY_LISTEN_HOST wins; else AV pick from room store + NIC list.
 * @param {{ envHost?: string | null, roomJson?: unknown, nics: LanNic[] }} opts
 * @returns {HttpListenHostResult}
 */
export function resolveHttpListenHost(opts) {
  const override = String(opts.envHost ?? "").trim();
  if (override) return { ok: true, host: override };
  return httpListenHostFrom(opts.nics, avLanPickFromRoomStore(opts.roomJson));
}

/**
 * Same shape as nics.ts listLanNicsFrom — kept here so boot wrappers stay plain .mjs.
 * @param {Record<string, Array<{ address?: string, family?: string | number, internal?: boolean, cidr?: string | null }> | undefined>} [ifaces]
 * @returns {LanNic[]}
 */
export function listLanNicsFrom(ifaces = /** @type {any} */ (os.networkInterfaces())) {
  const names = Object.keys(ifaces).filter((name) => {
    const addrs = ifaces[name] ?? [];
    if (!addrs.length) return false;
    return !addrs.every((addr) => addr.internal === true);
  });
  names.sort((a, b) => a.localeCompare(b, "en"));
  return names.map((name, index) => {
    const addrs = ifaces[name] ?? [];
    const v4 = addrs.find(
      (addr) => (addr.family === "IPv4" || addr.family === 4) && addr.internal !== true,
    );
    const ipv4 = v4?.address?.trim() || null;
    const cidr = v4?.cidr?.trim() || null;
    return {
      index,
      name,
      ipv4,
      cidr,
      label: `${index} — ${name} (${ipv4 ?? "no IPv4"})`,
    };
  });
}

/**
 * Resolve listen host for process boot from cwd room store + live NICs / RELAY_LISTEN_HOST.
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {HttpListenHostResult}
 */
export function bootResolveHttpListenHost(rootDir, env = process.env) {
  return resolveHttpListenHost({
    envHost: env.RELAY_LISTEN_HOST,
    roomJson: readRoomStoreSync(rootDir),
    nics: listLanNicsFrom(),
  });
}
