/**
 * Local DRM video connectors (HDMI/DP) for panel kiosk output pick.
 * Pure helpers + injectable DRM root for tests. Never shell-out.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DRM_CLASS_PATH = "/sys/class/drm";

/**
 * @typedef {{ index: number, name: string, connected: boolean, label: string }} VideoOutputRow
 */

/** @param {string} entry */
export function isPhysicalConnector(entry) {
  return !/writeback|virtual|tv-/i.test(entry);
}

/**
 * Parse connector status files under a DRM class directory.
 * @param {string} [drmRoot]
 * @returns {{ name: string, connected: boolean }[]}
 */
export function scanDrmConnectors(drmRoot = DRM_CLASS_PATH) {
  /** @type {{ name: string, connected: boolean }[]} */
  const found = [];
  if (!existsSync(drmRoot)) return found;
  let entries = [];
  try {
    entries = readdirSync(drmRoot);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!isPhysicalConnector(entry)) continue;
    const statusPath = join(drmRoot, entry, "status");
    if (!existsSync(statusPath)) continue;
    let status = "unknown";
    try {
      status = readFileSync(statusPath, "utf8").trim();
    } catch {
      /* keep unknown */
    }
    found.push({
      name: entry.replace(/^card\d+-/, ""),
      connected: status === "connected",
    });
  }
  found.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  return found;
}

/**
 * Indexed local video outputs. Connected first. Fallback: single "local" row.
 * @param {string} [drmRoot]
 * @returns {VideoOutputRow[]}
 */
export function listVideoOutputs(drmRoot = DRM_CLASS_PATH) {
  const found = scanDrmConnectors(drmRoot);
  /** @type {VideoOutputRow[]} */
  const rows = found.map((row, index) => ({
    index,
    name: row.name,
    connected: row.connected,
    label: `${index} — ${row.name}${row.connected ? "" : " (unplugged)"}`,
  }));
  if (!rows.length) {
    rows.push({
      index: 0,
      name: "local",
      connected: true,
      label: "0 — Local video output",
    });
  }
  return rows;
}

/**
 * Resolve by name (preferred), then index, then first connected / first row.
 * @param {{ panelHdmiOutputName?: string | null, panelHdmiOutputIndex?: number | null }} room
 * @param {VideoOutputRow[]} [outputs]
 * @returns {VideoOutputRow | null}
 */
export function resolveVideoOutput(room, outputs = listVideoOutputs()) {
  const name = String(room?.panelHdmiOutputName ?? "").trim();
  if (name) {
    const byName = outputs.find((row) => row.name === name);
    if (byName) return byName;
  }
  if (room?.panelHdmiOutputIndex != null && Number.isFinite(Number(room.panelHdmiOutputIndex))) {
    const byIndex = outputs.find((row) => row.index === Number(room.panelHdmiOutputIndex));
    if (byIndex) return byIndex;
  }
  return outputs.find((row) => row.connected) ?? outputs[0] ?? null;
}

/**
 * Build data/relay-kiosk.env body. URL must already be a concrete http(s) panel root (never 0.0.0.0).
 * @param {{
 *   panelHdmiOutputName?: string | null,
 *   panelHdmiOutputIndex?: number | null,
 * }} room
 * @param {string} kioskUrl
 * @param {VideoOutputRow[]} [outputs]
 */
export function kioskEnvBody(room, kioskUrl, outputs = listVideoOutputs()) {
  const row = resolveVideoOutput(room, outputs);
  const name = row && row.name !== "local" ? row.name : "";
  const url = String(kioskUrl ?? "").trim();
  return `RELAY_VIDEO_OUTPUT=${name}\nRELAY_KIOSK_URL=${url}\n`;
}

/**
 * Refuse unspecified / all-interfaces listen hosts for the Chromium kiosk URL.
 * @param {string} host
 */
export function isForbiddenKioskHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  return !h || h === "0.0.0.0" || h === "::" || h === "[::]";
}
