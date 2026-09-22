/**
 * Secrets pick/apply/disk I/O leaf extracted from store.server.ts.
 * store.server keeps the public façade (re-exports) so callers stay stable.
 */
import type { RoomConfig } from "./types";
import { isSecretKey } from "./secrets";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const SECRET_STORE = process.env.RELAY_SECRETS_FILE || path.join(process.cwd(), "data", "relay-secrets.json");

export type SecretFile = {
  configPin?: string;
  panelPin?: string | null;
  peerSecret?: string;
  pinChangeRequired?: boolean;
  sessions?: Record<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  devices?: Record<string, Record<string, string>>;
};

export function pickSecrets(config: RoomConfig): SecretFile {
  const devices: Record<string, Record<string, string>> = {};
  for (const device of config.devices) {
    const hide: Record<string, string> = {};
    for (const [key, value] of Object.entries(device.auth ?? {})) {
      if (isSecretKey(key) && String(value ?? "").trim()) hide[key] = String(value);
    }
    if (Object.keys(hide).length) devices[device.id] = hide;
  }
  return {
    configPin: config.room.configPin,
    panelPin: config.room.panelPin,
    peerSecret: config.room.peerSecret,
    devices,
  };
}

export function publicConfig(config: RoomConfig): RoomConfig {
  const next = structuredClone(config);
  next.room.configPin = "";
  next.room.peerSecret = "";
  next.room.panelPin = next.room.panelAccess === "pin" ? "" : null;
  for (const device of next.devices) {
    const keep: Record<string, string> = {};
    for (const [key, value] of Object.entries(device.auth ?? {})) {
      if (!isSecretKey(key)) keep[key] = value;
    }
    device.auth = keep;
  }
  return next;
}

export function applySecrets(config: RoomConfig, secrets?: SecretFile | null): RoomConfig {
  const next = structuredClone(config);
  if (secrets?.configPin) next.room.configPin = secrets.configPin;
  if (secrets?.peerSecret) next.room.peerSecret = secrets.peerSecret;
  if (next.room.panelAccess === "pin" && secrets?.panelPin) next.room.panelPin = secrets.panelPin;
  for (const device of next.devices) {
    const extra = secrets?.devices?.[device.id];
    if (extra) device.auth = { ...device.auth, ...extra };
  }
  return next;
}

export async function readSecretCandidate(file: string): Promise<SecretFile> {
  try {
    await access(file);
  } catch {
    return {};
  }
  return JSON.parse(await readFile(file, "utf8")) as SecretFile;
}

export async function readSecretFile(): Promise<SecretFile> {
  // Same contract as readSecretCandidate: missing file → {}; corrupt JSON throws.
  // Prefer refuse-to-apply over silently continuing with blank secrets (#8).
  return readSecretCandidate(SECRET_STORE);
}

export async function reloadSecretsFromDisk() {
  // Deferred import: memory/installRoomConfig live on store.server; call-time
  // load avoids a module-init cycle with this leaf.
  const { memory, installRoomConfig } = await import("./store.server");
  const secrets = await readSecretFile();
  const mem = memory();
  // applySecrets clones — install seeds memo; shape is already live-normalized.
  installRoomConfig(applySecrets(mem.config, secrets), { alreadyNormalized: true });
  mem.sessions = { ...(secrets.sessions ?? {}), ...(mem.sessions ?? {}) };
  mem.pinChangeRequired = secrets.pinChangeRequired === true;
  return secrets;
}
