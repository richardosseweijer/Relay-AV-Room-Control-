/**
 * LAN (venue) Wi‑Fi via NetworkManager (nmcli) on Linux.
 * Dial-in only: join an SSID on the selected outbound/LAN NIC (USB WLAN stick).
 * Does not host an AP or touch AV-LAN Apply.
 * Pure helpers + injectable runners. No shell; argv only.
 */

import {
  createNmcliRunner,
  classifyNmcliFailure,
  platformGate as avPlatformGate,
  AV_LAN_IP_NMCLI_MISSING,
  AV_LAN_IP_SUDOERS,
} from "./av-lan-ip.mjs";
import {
  isWirelessIfaceName,
  listSysfsNetNames,
  listWirelessIfaceNames,
} from "./wireless-iface.mjs";

export { isWirelessIfaceName, listSysfsNetNames, listWirelessIfaceNames };
export const isWirelessIface = isWirelessIfaceName;

export const LAN_WIFI_LINUX_ONLY =
  "LAN Wi‑Fi join is Linux-only (NetworkManager / nmcli). Join the venue SSID via the OS or SSH.";

export const LAN_WIFI_NMCLI_MISSING = AV_LAN_IP_NMCLI_MISSING;

export const LAN_WIFI_SUDOERS = AV_LAN_IP_SUDOERS;

export const LAN_WIFI_LAN_UNSET =
  "LAN (internet) NIC is not set. Pick a Wi‑Fi NIC under Room → Networks, Save all, then Connect.";

export const LAN_WIFI_LAN_MISSING =
  "LAN (internet) NIC not found on this host. Refresh NICs or pick a listed interface.";

export const LAN_WIFI_NOT_WIRELESS =
  "Selected LAN NIC is not a wireless interface. Pick a Wi‑Fi adapter (e.g. wlan0 / USB stick).";

export const LAN_WIFI_SSID_REQUIRED = "Enter an SSID (network name).";

export const LAN_WIFI_PSK_REQUIRED =
  "Password required for this network. Enter the Wi‑Fi password, or leave blank only if a password was saved before.";

export const RELAY_LAN_WIFI_CONNECTION_ID = "relay-lan-wifi";

/**
 * Normalize / validate SSID (1–32 chars; reject control chars).
 * @param {unknown} raw
 * @returns {{ ok: true, ssid: string } | { ok: false, message: string }}
 */
export function normalizeWifiSsid(raw) {
  const ssid = String(raw ?? "").trim();
  if (!ssid) return { ok: false, message: LAN_WIFI_SSID_REQUIRED };
  if (ssid.length > 32) return { ok: false, message: "SSID must be 32 characters or fewer." };
  if (/[\x00-\x1f\x7f]/.test(ssid)) {
    return { ok: false, message: "SSID contains invalid control characters." };
  }
  return { ok: true, ssid };
}

/**
 * Normalize PSK: empty allowed (open / reuse saved). WPA PSK 8–63 chars or 64 hex.
 * @param {unknown} raw
 * @param {{ required?: boolean }} [opts]
 * @returns {{ ok: true, psk: string } | { ok: false, message: string }}
 */
export function normalizeWifiPsk(raw, opts = {}) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    if (opts.required) return { ok: false, message: LAN_WIFI_PSK_REQUIRED };
    return { ok: true, psk: "" };
  }
  if (trimmed.length === 64 && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { ok: true, psk: trimmed };
  }
  if (trimmed.length < 8 || trimmed.length > 63) {
    return { ok: false, message: "Wi‑Fi password must be 8–63 characters (or 64 hex digits)." };
  }
  return { ok: true, psk: trimmed };
}

/** @param {string} device */
export function buildNmcliWifiRescanArgv(device) {
  return ["device", "wifi", "rescan", "ifname", String(device)];
}

/** @param {string} device */
export function buildNmcliWifiListArgv(device) {
  return ["-t", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "device", "wifi", "list", "ifname", String(device)];
}

/**
 * `nmcli device wifi connect` — creates/updates a profile and activates it.
 * Password omitted for open networks.
 * @param {string} ssid
 * @param {string} device
 * @param {string} [psk]
 */
export function buildNmcliWifiConnectArgv(ssid, device, psk) {
  const argv = ["device", "wifi", "connect", String(ssid), "ifname", String(device)];
  const pass = String(psk ?? "");
  if (pass) argv.push("password", pass);
  return argv;
}

/**
 * Escape a literal for use inside RegExp.
 * @param {string} s
 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub PSK material from nmcli error text.
 * @param {string} text
 * @param {string} [psk]
 */
export function scrubWifiSecret(text, psk) {
  let out = String(text ?? "");
  out = out.replace(/\spassword\s+\S+/gi, " password ***");
  const pass = String(psk ?? "");
  if (pass) out = out.split(pass).join("***");
  return out;
}

/**
 * Parse `nmcli -t -f SSID,SIGNAL,SECURITY,IN-USE device wifi list` output.
 * Soft-dedupes by SSID (keep strongest signal). Empty SSID rows dropped (hidden).
 * @param {string} text
 * @returns {{ ssid: string, signal: number, security: string, inUse: boolean }[]}
 */
export function parseWifiListOutput(text) {
  const rows = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    // nmcli -t uses : ; SSID may contain \: escapes
    const parts = [];
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\" && i + 1 < line.length) {
        cur += line[i + 1];
        i++;
        continue;
      }
      if (ch === ":") {
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    const ssid = (parts[0] ?? "").trim();
    if (!ssid) continue;
    const signal = Number(parts[1]);
    const security = String(parts[2] ?? "").trim();
    const inUseRaw = String(parts[3] ?? "").trim();
    rows.push({
      ssid,
      signal: Number.isFinite(signal) ? signal : 0,
      security,
      inUse: inUseRaw === "*" || inUseRaw === "yes" || inUseRaw === "Yes",
    });
  }
  /** @type {Map<string, (typeof rows)[0]>} */
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.ssid);
    if (!prev || row.signal > prev.signal || (row.inUse && !prev.inUse)) {
      best.set(row.ssid, row);
    }
  }
  return [...best.values()].sort(
    (a, b) => b.signal - a.signal || a.ssid.localeCompare(b.ssid, "en"),
  );
}

/**
 * @param {{ name?: string | null, index?: number | null }} pick
 * @param {Array<{ name: string, index: number, wireless?: boolean }>} nics
 * @param {(nics: any[], pick: any) => any | null} resolveNic
 * @returns {{ ok: true, nic: any } | { ok: false, message: string }}
 */
export function resolveLanWifiTarget(pick, nics, resolveNic) {
  const name = String(pick?.name ?? "").trim();
  const indexSet = pick?.index != null && Number.isFinite(Number(pick.index));
  if (!name && !indexSet) return { ok: false, message: LAN_WIFI_LAN_UNSET };
  const nic = resolveNic(nics, {
    name: name || null,
    index: indexSet ? Number(pick.index) : null,
  });
  if (!nic) return { ok: false, message: LAN_WIFI_LAN_MISSING };
  if (!nic.wireless) return { ok: false, message: LAN_WIFI_NOT_WIRELESS };
  return { ok: true, nic };
}

/**
 * Scan nearby SSIDs on device. Soft-fails when radio down / NM missing.
 * @param {{
 *   device: string,
 *   runNmcli: (argv: string[], opts?: { sudo?: boolean, timeoutMs?: number }) => Promise<any>,
 *   rescan?: boolean,
 * }} opts
 */
export async function scanLanWifiViaNmcli(opts) {
  const device = String(opts.device ?? "").trim();
  if (!device) return { ok: false, networks: [], message: LAN_WIFI_LAN_MISSING };

  const probe = await opts.runNmcli(["networking"], { sudo: false });
  if (probe.error && /** @type {any} */ (probe.error).code === "ENOENT") {
    return { ok: false, networks: [], message: LAN_WIFI_NMCLI_MISSING };
  }
  if (classifyNmcliFailure(probe).kind === "missing") {
    return { ok: false, networks: [], message: LAN_WIFI_NMCLI_MISSING };
  }

  if (opts.rescan !== false) {
    // Rescan often needs privileges; soft-ignore failure (stale list still useful).
    await opts.runNmcli(buildNmcliWifiRescanArgv(device), { sudo: true, timeoutMs: 15_000 });
  }

  const list = await opts.runNmcli(buildNmcliWifiListArgv(device), {
    sudo: false,
    timeoutMs: 25_000,
  });
  if (list.error && /** @type {any} */ (list.error).code === "ENOENT") {
    return { ok: false, networks: [], message: LAN_WIFI_NMCLI_MISSING };
  }
  if (list.code !== 0) {
    const c = classifyNmcliFailure(list);
    return {
      ok: false,
      networks: [],
      message: scrubWifiSecret(c.message || "Wi‑Fi scan failed (radio down or device not ready)."),
    };
  }
  const networks = parseWifiListOutput(list.stdout || "");
  return {
    ok: true,
    networks,
    message: networks.length ? undefined : "No networks found (try again closer to the AP).",
  };
}

/**
 * Connect LAN NIC to SSID via nmcli.
 * @param {{
 *   device: string,
 *   ssid: string,
 *   psk?: string,
 *   runNmcli: (argv: string[], opts?: { sudo?: boolean, timeoutMs?: number }) => Promise<any>,
 * }} opts
 */
export async function applyLanWifiViaNmcli(opts) {
  const device = String(opts.device ?? "").trim();
  const ssidNorm = normalizeWifiSsid(opts.ssid);
  if (!ssidNorm.ok) return { ok: false, message: ssidNorm.message };
  const pskNorm = normalizeWifiPsk(opts.psk ?? "", { required: false });
  if (!pskNorm.ok) return { ok: false, message: pskNorm.message };

  const probe = await opts.runNmcli(["networking"], { sudo: false });
  if (
    (probe.error && /** @type {any} */ (probe.error).code === "ENOENT") ||
    classifyNmcliFailure(probe).kind === "missing"
  ) {
    return { ok: false, message: LAN_WIFI_NMCLI_MISSING };
  }

  const argv = buildNmcliWifiConnectArgv(ssidNorm.ssid, device, pskNorm.psk);
  const up = await opts.runNmcli(argv, { sudo: true, timeoutMs: 45_000 });
  if (up.code !== 0) {
    const c = classifyNmcliFailure(up);
    if (c.kind === "sudo") return { ok: false, message: LAN_WIFI_SUDOERS };
    return {
      ok: false,
      message: scrubWifiSecret(c.message || "nmcli wifi connect failed", pskNorm.psk),
    };
  }
  return {
    ok: true,
    ssid: ssidNorm.ssid,
    message: `Connected ${device} to “${ssidNorm.ssid}”.`,
  };
}

/**
 * @param {string} [platform]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function platformGate(platform = process.platform) {
  const base = avPlatformGate(platform);
  if (!base.ok) return { ok: false, message: LAN_WIFI_LINUX_ONLY };
  return { ok: true };
}

export { createNmcliRunner, classifyNmcliFailure, escapeRegExp };

