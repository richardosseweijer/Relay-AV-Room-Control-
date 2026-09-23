/**
 * Phase A2 — HTTP panel/API listen host from AV-LAN.
 * Never returns 0.0.0.0. Outbound / NIC2 is ignored (None/down must not block AV listen).
 * RELAY_LISTEN_HOST env override is honored when set (documented escape hatch).
 *
 * Fresh install: if AV-LAN pick is unset/blank/invalid, auto-map to the first
 * scanned NIC (physical eth/en* before docker/veth/bridges; same listLanNicsFrom
 * scan order). Persist that pick so Networks UI and later boots keep it.
 *
 * Kept as plain .mjs so boot wrappers (with-app-env, update-relay) and nics.ts share one implementation.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { writeAtomicFile } from "./write-atomic.mjs";

export const AV_UNSET_LISTEN_WARNING =
  "AV-LAN NIC is unset and no scanned NICs are available — HTTP listen bound to 127.0.0.1 (loopback only).";

export const AV_AUTOMAP_LISTEN_WARNING_PREFIX =
  "AV-LAN was unset/invalid — auto-mapped to first scanned NIC";

/** @typedef {{ index: number, name: string, ipv4: string | null, cidr?: string | null, label?: string }} LanNic */
/** @typedef {{ name?: string | null, index?: number | null }} NicPick */
/**
 * @typedef {{ ok: true, host: string, warning?: string, autoMapped?: boolean, pick?: NicPick } | { ok: false, reason: string, autoMapped?: boolean, pick?: NicPick }} HttpListenHostResult
 */

/**
 * Virtual / non-physical iface names to skip when auto-mapping AV-LAN,
 * unless they are the only scanned NICs. `lo` is already excluded by listLanNicsFrom.
 * @param {string} name
 */
export function isVirtualLanNicName(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return true;
  if (n === "lo" || n.startsWith("lo:")) return true;
  if (/^(docker|veth|virbr|cni|flannel|weave|tun|tap|wg|dummy|vmnet|vboxnet|zt|tailscale|nerdctl)/i.test(n)) {
    return true;
  }
  // Linux bridge devices: br0, br-*, bridge*
  if (/^br[0-9]/.test(n) || n.startsWith("br-") || n.startsWith("bridge")) return true;
  return false;
}

/**
 * First available scanned NIC for AV-LAN auto-map.
 * Prefers non-virtual ifaces in listLanNicsFrom order (A–Z); falls back to first
 * of all scanned (including docker/veth/bridges) if that is all that exists.
 * @param {LanNic[]} nics
 * @returns {LanNic | null}
 */
export function firstScannedAvLanNic(nics) {
  if (!Array.isArray(nics) || nics.length === 0) return null;
  const physical = nics.filter((nic) => !isVirtualLanNicName(nic.name));
  const pool = physical.length > 0 ? physical : nics;
  return pool[0] ?? null;
}

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
 * Resolve the effective AV-LAN pick: keep a valid saved iface; if unset/blank/invalid,
 * auto-map to firstScannedAvLanNic. Does not auto-assign outbound/NIC2.
 * @param {LanNic[]} nics
 * @param {NicPick} [pick]
 * @returns {{ pick: NicPick, autoMapped: boolean, nic: LanNic | null, warning?: string }}
 */
export function effectiveAvLanPick(nics, pick = {}) {
  if (pickSet(pick)) {
    const nic = resolveNic(nics, pick);
    if (nic) {
      return {
        pick: { name: nic.name, index: nic.index },
        autoMapped: false,
        nic,
      };
    }
  }
  const first = firstScannedAvLanNic(nics);
  if (!first) {
    return { pick: {}, autoMapped: false, nic: null };
  }
  return {
    pick: { name: first.name, index: first.index },
    autoMapped: true,
    nic: first,
    warning: `${AV_AUTOMAP_LISTEN_WARNING_PREFIX} ${first.name}.`,
  };
}

/**
 * Pure: given NIC list + AV pick → listen host.
 * Valid saved AV → that IPv4; unset/invalid → first scanned (auto-map);
 * mapped/saved iface with no IPv4 → refuse (not 0.0.0.0);
 * no NICs at all → 127.0.0.1 + warning.
 * @param {LanNic[]} nics
 * @param {NicPick} [pick]
 * @returns {HttpListenHostResult}
 */
export function httpListenHostFrom(nics, pick = {}) {
  const eff = effectiveAvLanPick(nics, pick);
  if (!eff.nic) {
    return { ok: true, host: "127.0.0.1", warning: AV_UNSET_LISTEN_WARNING, autoMapped: false, pick: {} };
  }
  if (!eff.nic.ipv4) {
    const waitHint = eff.autoMapped
      ? " Waiting for an address on the auto-mapped NIC (will not bind 0.0.0.0)."
      : " — refusing HTTP listen (will not bind 0.0.0.0).";
    return {
      ok: false,
      reason: `AV-LAN NIC ${eff.nic.name} has no IPv4${waitHint}`,
      autoMapped: eff.autoMapped,
      pick: eff.pick,
    };
  }
  /** @type {{ ok: true, host: string, warning?: string, autoMapped?: boolean, pick?: NicPick }} */
  const ok = {
    ok: true,
    host: eff.nic.ipv4,
    autoMapped: eff.autoMapped,
    pick: eff.pick,
  };
  if (eff.autoMapped && eff.warning) ok.warning = eff.warning;
  return ok;
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
 * Persist auto-mapped AV-LAN into an existing relay-room.json (name+index only).
 * No-op when the file is missing (ensureLoaded seeds after first empty config).
 * Never touches outbound/NIC2.
 * @param {string} rootDir
 * @param {NicPick} pick
 * @param {unknown} [roomJson]
 * @returns {boolean} true when a write happened
 */
export function persistAvLanAutoMap(rootDir, pick, roomJson) {
  const name = String(pick?.name ?? "").trim();
  if (!name) return false;
  const index =
    pick?.index != null && Number.isFinite(Number(pick.index)) ? Number(pick.index) : null;
  const path = join(rootDir, "data", "relay-room.json");
  if (!existsSync(path)) return false;
  let raw = roomJson;
  if (!raw || typeof raw !== "object") {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return false;
    }
  }
  if (!raw || typeof raw !== "object") return false;
  const root = /** @type {Record<string, unknown>} */ (raw);
  const hasConfigWrapper = root.config && typeof root.config === "object";
  const config = hasConfigWrapper
    ? /** @type {Record<string, unknown>} */ (root.config)
    : root;
  const room =
    config.room && typeof config.room === "object"
      ? /** @type {Record<string, unknown>} */ (config.room)
      : null;
  if (!room) return false;
  const prevName = typeof room.avLanNicName === "string" ? room.avLanNicName : null;
  const prevIndex =
    typeof room.avLanNicIndex === "number" || room.avLanNicIndex == null
      ? room.avLanNicIndex ?? null
      : null;
  if (prevName === name && prevIndex === index) return false;
  room.avLanNicName = name;
  room.avLanNicIndex = index;
  writeAtomicFile(path, `${JSON.stringify(root, null, 2)}\n`);
  return true;
}

/**
 * Boot resolver: RELAY_LISTEN_HOST wins; else AV pick from room store + NIC list
 * (auto-maps + persists when unset/invalid).
 * @param {{ envHost?: string | null, roomJson?: unknown, nics: LanNic[], rootDir?: string, persist?: boolean }} opts
 * @returns {HttpListenHostResult}
 */
export function resolveHttpListenHost(opts) {
  const override = String(opts.envHost ?? "").trim();
  if (override) return { ok: true, host: override };
  const pick = avLanPickFromRoomStore(opts.roomJson);
  const result = httpListenHostFrom(opts.nics, pick);
  if (
    opts.persist !== false &&
    opts.rootDir &&
    result.autoMapped &&
    result.pick &&
    String(result.pick.name ?? "").trim()
  ) {
    try {
      persistAvLanAutoMap(opts.rootDir, result.pick, opts.roomJson);
    } catch {
      /* boot must not die on persist; ensureLoaded will retry */
    }
  }
  return result;
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
 * Auto-maps + persists AV-LAN when unset/invalid.
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {HttpListenHostResult}
 */
export function bootResolveHttpListenHost(rootDir, env = process.env) {
  return resolveHttpListenHost({
    envHost: env.RELAY_LISTEN_HOST,
    roomJson: readRoomStoreSync(rootDir),
    nics: listLanNicsFrom(),
    rootDir,
    persist: true,
  });
}
