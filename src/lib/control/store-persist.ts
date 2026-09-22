/**
 * Persist leaf extracted from store.server.ts.
 * Owns FILE_STORE, writeFileStore, dirty-chain flush, persist / persistNow.
 * store.server keeps the public façade (re-exports) so callers stay stable.
 *
 * Deferred-imports memory / normalizedConfig / scheduleStamps from store.server
 * at call time to avoid a module-init cycle (#97 pattern).
 */
import type { DeviceStateMap, DriverSpec, RoomConfig } from "./types";
import type { VarMap } from "./vars";
import { SECRET_STORE, pickSecrets, publicConfig } from "./store-secrets";
import { persistPair } from "../../../scripts/write-atomic.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const FILE_STORE = path.join(process.cwd(), "data", "relay-room.json");

/** Minimal memory shape needed to serialize a durable room snapshot. */
type PersistMemory = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  latches?: Record<string, string>;
  sessions?: Record<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  pinChangeRequired?: boolean;
};

async function writeFileStore(mem: PersistMemory) {
  // Deferred: live memory helpers live on store.server; call-time load avoids
  // a module-init cycle with this leaf.
  const { normalizedConfig, scheduleStamps } = await import("./store.server");
  await mkdir(path.dirname(FILE_STORE), { recursive: true });
  const secrets = pickSecrets(mem.config);
  secrets.sessions = mem.sessions ?? {};
  if (mem.pinChangeRequired) secrets.pinChangeRequired = true;
  const body = JSON.stringify({
    // F7: reuse memoized normalized config — do not normalize again on every persist.
    config: publicConfig(normalizedConfig(mem.config)),
    drivers: mem.drivers,
    state: mem.state,
    vars: mem.vars,
    latches: mem.latches ?? {},
    stamps: scheduleStamps(),
  });
  persistPair(SECRET_STORE, FILE_STORE, JSON.stringify(secrets), body);
}

let persistChain = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

async function flushPersist() {
  // Clear dirty before await so persist()/persistNow during an in-flight write
  // re-sets the flag; loop until a write completes with dirty still clear.
  while (persistDirty) {
    persistDirty = false;
    const { memory } = await import("./store.server");
    const mem = memory();
    try {
      await writeFileStore(mem);
    } catch (err) {
      persistDirty = true;
      throw err;
    }
  }
}

export async function persistNow() {
  persistDirty = true;
  try {
    const run = persistChain.catch(() => undefined).then(flushPersist);
    persistChain = run.catch(() => undefined);
    await run;
  } catch (err) {
    persistDirty = true;
    throw err;
  }
}

export function persist() {
  persistDirty = true;
  if (persistTimer) return persistChain;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistChain = persistChain.then(flushPersist).catch(() => {
      persistDirty = true;
    });
  }, 800);
  return persistChain;
}
