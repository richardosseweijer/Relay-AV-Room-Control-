/**
 * Detect wireless NICs via sysfs (nl80211: wireless / phy80211) + soft name heuristic.
 * No NetworkManager — safe to import from NIC listing paths.
 */
import { existsSync as fsExistsSync, readdirSync as fsReaddirSync } from "node:fs";

/**
 * @param {string} name
 * @param {{ existsSync?: (p: string) => boolean }} [opts]
 */
export function isWirelessIfaceName(name, opts = {}) {
  const exists = opts.existsSync ?? fsExistsSync;
  const n = String(name ?? "").trim();
  if (!n || n.includes("/") || n.includes("..")) return false;
  const base = `/sys/class/net/${n}`;
  if (exists(`${base}/wireless`)) return true;
  if (exists(`${base}/phy80211`)) return true;
  return /^(wlan|wlp|wlx|wifi)\d/i.test(n) || /^(wlan|wlp|wlx)$/i.test(n);
}

/**
 * @param {{ readdirSync?: (p: string) => string[] }} [opts]
 * @returns {string[]}
 */
export function listSysfsNetNames(opts = {}) {
  const readdir = opts.readdirSync ?? fsReaddirSync;
  try {
    const names = readdir("/sys/class/net");
    return Array.isArray(names) ? names.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ readdirSync?: (p: string) => string[], existsSync?: (p: string) => boolean }} [opts]
 */
export function listWirelessIfaceNames(opts = {}) {
  return listSysfsNetNames(opts)
    .filter((n) => n !== "lo" && isWirelessIfaceName(n, opts))
    .sort((a, b) => a.localeCompare(b, "en"));
}
