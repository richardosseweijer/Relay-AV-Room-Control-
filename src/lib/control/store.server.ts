import { defaultDeviceState, emptyRoomConfig, hostDriverSeed, workingSetNames } from "./defaults";
import { traces, scrubSecret, socketStats } from "./engine";
import { syncMidiWatchers } from "./midi-in";
import type { DeviceHealth, DeviceStateMap, DriverIndex, DriverSpec, LogEntry, MonitorStatus, RoomConfig, RoomSnapshot } from "./types";
import { indexDriver } from "./types";
import { applyMonitors, seedVars, type VarMap } from "./vars";
import { retainSacnCidKeys } from "./sacn";
import { retainPaceDevices, pruneIdlePaceDevices } from "./engine-wire";
import {
  DRIVER_DIR,
  loadDriverFiles,
  loadLibraryIndex,
  readLibrarySpec,
  readRoomSpec,
  writeDriverFile,
} from "./store-drivers";
import {
  SECRET_STORE,
  pickSecrets,
  applySecrets,
  readSecretCandidate,
} from "./store-secrets";
import { FILE_STORE, persist } from "./store-persist";
import { listLanNics, effectiveAvLanPick } from "./nics";
import {
  normalize,
  normalizedConfig,
  installRoomConfig,
  rememberNormalized,
  bindNormalizeInstallDeps,
} from "./store-normalize";
import { runDueMonitors, applyDueMonitor, pruneMonitorMaps } from "./store-monitors";
import {
  scheduleStamps,
  loadScheduleStamps,
  pruneScheduleMaps,
  runDueSchedules,
  runDueTriggers,
  drainQueuedTriggers,
} from "./store-schedules";
import { recoverPersistPair } from "../../../scripts/write-atomic.mjs";
import { readFile, readdir, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { occupancyOf, occupancyCode, OCCUPANCY_VAR_ID } from "./peer-payload";
import { applyFoyerSession, fetchFoyerSession, DEFAULT_FOYER_PEER_URL } from "./foyer-peer";
import { peerKey } from "./peer-auth";

export {
  safeDriverName,
  writeDriverFile,
  removeDriverFile,
  readLibrarySpec,
  loadLibraryIndex,
  loadDriverFiles,
  pruneRoomDrivers,
} from "./store-drivers";

export { reloadSecretsFromDisk } from "./store-secrets";
export { persist, persistNow } from "./store-persist";

export {
  normalize,
  normalizedConfig,
  invalidateNormalizedConfig,
  installRoomConfig,
} from "./store-normalize";

export { runDueMonitors, applyDueMonitor, pruneMonitorMaps };

export {
  scheduleStamps,
  loadScheduleStamps,
  pruneScheduleMaps,
  runDueSchedules,
  runDueTriggers,
  drainQueuedTriggers,
};

type Memory = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  library: Record<string, DriverIndex>;
  state: DeviceStateMap;
  vars: VarMap;
  health: DeviceHealth;
  log: LogEntry[];
  monitorStatus: Record<string, MonitorStatus>;
  lastError: string | null;
  runningMacro: string | null;
  activeScene: string | null;
  latches: Record<string, string>;
  host: { dim: boolean; locked: boolean; toast: string | null; block: string | null; pageId: string | null; fullscreenAt?: number };
  sessions: Record<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  /** Set when a weak config PIN is unlocked/hashed; cleared only after a strong PIN save. */
  pinChangeRequired?: boolean;
};

const g = globalThis as typeof globalThis & {
  __relayMemory__?: Memory;
  __relaySched__?: ReturnType<typeof setInterval>;
  __relayMon__?: ReturnType<typeof setInterval>;
  __relayFoyer__?: ReturnType<typeof setInterval>;
};
/** F8: drop process-global map rows for removed devices / monitors / triggers / schedules. */
function pruneRuntimeMaps(config: RoomConfig) {
  const deviceIds = (config.devices ?? []).map((d) => d.id).filter(Boolean);
  const paceKeep = [
    ...deviceIds,
    ...(config.interfaces ?? []).map((iface) => `gw:${iface.id}`),
  ];
  retainPaceDevices(paceKeep);
  pruneIdlePaceDevices();
  retainSacnCidKeys(deviceIds);

  pruneMonitorMaps(config);
  pruneScheduleMaps(config);
}

function emptyMemory(): Memory {
  const config = normalize(emptyRoomConfig());
  rememberNormalized(config);
  return {
    config,
    drivers: { ...hostDriverSeed() },
    library: Object.fromEntries(Object.entries(hostDriverSeed()).map(([name, spec]) => [name, indexDriver(name, spec)])),
    state: defaultDeviceState(),
    vars: seedVars(config),
    health: {},
    log: [],
    monitorStatus: {},
    lastError: null,
    runningMacro: null,
    activeScene: null,
    host: { dim: false, locked: false, toast: null, block: null, pageId: null },
    latches: {},
    sessions: {},
    pinChangeRequired: false,
  };
}

export function memory(): Memory {
  if (!g.__relayMemory__) g.__relayMemory__ = emptyMemory();
  return g.__relayMemory__;
}

// Sync wire for store-normalize installRoomConfig (monitors + schedules prune via leaves).
bindNormalizeInstallDeps({ memory, pruneRuntimeMaps });

export async function loadPersisted(): Promise<Memory> {
  const mem = memory();
  try { recoverPersistPair(SECRET_STORE, FILE_STORE); } catch { /* keep last-good files */ }
  const files = [FILE_STORE, `${FILE_STORE}.good`];
  for (const file of files) {
  try {
    const raw = await readFile(file, "utf8");
    const saved = JSON.parse(raw) as { config?: RoomConfig; drivers?: Record<string, DriverSpec>; state?: DeviceStateMap; vars?: VarMap; latches?: Record<string, string>; stamps?: Record<string, string> };
    if (saved.config) {
      const secretFile = file === FILE_STORE ? SECRET_STORE : `${SECRET_STORE}.good`;
      // A missing secrets file is valid for a legacy room. A corrupt one is
      // not: reject this candidate so its matching last-good pair is tried.
      const fromDisk = await readSecretCandidate(secretFile);
      const fromRoom = pickSecrets(saved.config);
      installRoomConfig(applySecrets(normalize(saved.config), {
        configPin: fromDisk.configPin || fromRoom.configPin,
        panelPin: fromDisk.panelPin || fromRoom.panelPin,
        peerSecret: fromDisk.peerSecret || fromRoom.peerSecret,
        devices: { ...fromRoom.devices, ...fromDisk.devices },
      }), { alreadyNormalized: true });
      mem.library = await loadLibraryIndex();
      mem.drivers = {};
      const roomFiles = (await readdir(DRIVER_DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
      const names = workingSetNames(mem.config.devices, roomFiles);
      for (const name of names) {
        const fromRoom = await readRoomSpec(name);
        if (fromRoom) {
          mem.drivers[name] = fromRoom;
          continue;
        }
        const fromLib = await readLibrarySpec(name);
        if (fromLib) {
          mem.drivers[name] = fromLib;
          await writeDriverFile(name, fromLib);
          continue;
        }
        if (saved.drivers?.[name]) {
          mem.drivers[name] = saved.drivers[name]!;
          await writeDriverFile(name, saved.drivers[name]!);
        }
      }
      mem.state = saved.state ?? defaultDeviceState();
      mem.vars = seedVars(mem.config, saved.vars);
      mem.vars[OCCUPANCY_VAR_ID] = occupancyCode(occupancyOf(mem.config.room));
      mem.latches = saved.latches ?? {};
      mem.sessions = fromDisk.sessions ?? {};
      mem.pinChangeRequired = fromDisk.pinChangeRequired === true;
      const nextSessions: Memory["sessions"] = {};
      const now = Date.now();
      for (const [key, row] of Object.entries(mem.sessions)) {
        if (row.exp && row.exp < now) continue;
        const id = row.id || (row.secret ? key : key.length === 16 ? key : undefined) || key.slice(-16);
        nextSessions[id] = { ...row, secret: row.secret || key };
      }
      mem.sessions = nextSessions;
      mem.health = {};
      loadScheduleStamps(saved.stamps);
      applyMonitors(mem.config, mem.state, mem.vars);
      return mem;
    }
  } catch {
    if (file === FILE_STORE) {
      await rename(FILE_STORE, `${FILE_STORE}.bad`).catch(() => undefined);
    }
  }
  }
  mem.drivers = await loadDriverFiles();
  mem.library = await loadLibraryIndex();
  return mem;
}

let cachedRelayVersion = "";

export function relayVersion() {
  if (cachedRelayVersion) return cachedRelayVersion;
  let ver = "dev";
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    ver = pkg.version || ver;
  } catch { /* ignore */ }
  let sha = "";
  try {
    const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), encoding: "utf8", timeout: 1500 });
    if (git.status === 0) sha = git.stdout.trim();
  } catch { /* ignore */ }
  cachedRelayVersion = sha ? `${ver} (${sha})` : ver;
  return cachedRelayVersion;
}

export function pushLog(entry: Omit<LogEntry, "id" | "at"> & { at?: number }) {
  const mem = memory();
  mem.log = mem.log ?? [];
  mem.log.unshift({
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    ok: entry.ok,
    title: scrubSecret(entry.title),
    detail: scrubSecret(entry.detail).slice(0, 400),
  });
  if (mem.log.length > 300) mem.log.length = 300;
}

export function clearLog() {
  memory().log = [];
}

export function processStatus() {
  const mem = memory();
  const mu = process.memoryUsage();
  const health = mem.health ?? {};
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    osUptimeSec: Math.round(os.uptime()),
    rssMb: Math.round(mu.rss / 1048576),
    heapMb: Math.round(mu.heapUsed / 1048576),
    heapTotalMb: Math.round(mu.heapTotal / 1048576),
    load: Math.round(os.loadavg()[0] * 100) / 100,
    sockets: socketStats(),
    log: (mem.log ?? []).length,
    runningMacro: mem.runningMacro,
    lastError: mem.lastError ? scrubSecret(mem.lastError) : null,
    healthFail: Object.values(health).filter((row) => !row.ok).length,
    monitors: Object.keys(mem.monitorStatus ?? {}).length,
  };
}

export function snapshot(): RoomSnapshot {
  const mem = memory();
  // F1: poll path must not re-normalize every GET /api/room — reuse memo until config install.
  mem.config = normalizedConfig(mem.config);
  mem.drivers = mem.drivers ?? {};
  mem.library = mem.library ?? {};
  mem.vars = seedVars(mem.config, mem.vars);
  mem.vars[OCCUPANCY_VAR_ID] = occupancyCode(occupancyOf(mem.config.room));
  return {
    config: mem.config,
    drivers: mem.drivers,
    library: mem.library ?? {},
    state: mem.state,
    vars: mem.vars,
    health: mem.health ?? {},
    log: mem.log ?? [],
    traces: typeof traces === "function" ? traces() : {},
    monitorStatus: mem.monitorStatus ?? {},
    lastError: mem.lastError,
    runningMacro: mem.runningMacro,
    activeScene: mem.activeScene,
    latches: mem.latches ?? {},
    host: mem.host ?? { dim: false, locked: false, toast: null, block: null, pageId: null },
    version: relayVersion(),
  };
}

let foyerBusy = false;
let lastFoyerPoll = 0;

async function pollFoyerSession() {
  if (foyerBusy) return;
  const now = Date.now();
  if (now - lastFoyerPoll < 3_500) return;
  lastFoyerPoll = now;
  foyerBusy = true;
  try {
    const mem = memory();
    const url = String(mem.config.room.foyerPeerUrl ?? DEFAULT_FOYER_PEER_URL).trim();
    if (!url) return;
    const res = await fetchFoyerSession({ url, secret: peerKey(mem.config.room) });
    if (!res.ok) return;
    applyFoyerSession(mem.vars, res.session);
  } finally {
    foyerBusy = false;
  }
}

function startScheduler() {
  if (!g.__relaySched__) {
    g.__relaySched__ = setInterval(() => {
      runDueSchedules().catch(() => undefined);
    }, 15000);
  }
  if (!g.__relayMon__) {
    g.__relayMon__ = setInterval(() => {
      syncMidiWatchers(memory());
      runDueMonitors().catch(() => undefined);
      runDueTriggers().catch(() => undefined);
    }, 500);
  }
  if (!g.__relayFoyer__) {
    g.__relayFoyer__ = setInterval(() => {
      pollFoyerSession().catch(() => undefined);
    }, 4000);
  }
  syncMidiWatchers(memory());
  pollFoyerSession().catch(() => undefined);
}

let boot: Promise<Memory> | null = null;
/** When AV-LAN is unset/blank/invalid, map to first scanned NIC and persist (not outbound). */
function seedAvLanFromScan(mem: Memory): boolean {
  const room = mem.config?.room;
  if (!room) return false;
  const nics = listLanNics();
  const eff = effectiveAvLanPick(nics, {
    name: room.avLanNicName,
    index: room.avLanNicIndex ?? null,
  });
  if (!eff.autoMapped || !eff.nic) return false;
  room.avLanNicName = eff.nic.name;
  room.avLanNicIndex = eff.nic.index;
  return true;
}

export function ensureLoaded() {
  if (!boot) {
    boot = loadPersisted()
      .then(async (mem) => {
        if (!Object.keys(mem.drivers ?? {}).length) {
          mem.drivers = hostDriverSeed();
        }
        if (!Object.keys(mem.library ?? {}).length) {
          mem.library = await loadLibraryIndex();
        }
        if (!mem.config?.room) installRoomConfig(emptyRoomConfig());
        if (seedAvLanFromScan(mem)) {
          try { await persist(); } catch { /* keep memory pick; next boot retries */ }
        }
        startScheduler();
        return mem;
      })
      .catch(async () => {
        const mem = memory();
        installRoomConfig(emptyRoomConfig());
        mem.drivers = hostDriverSeed();
        mem.library = await loadLibraryIndex();
        mem.vars = seedVars(mem.config, mem.vars);
        if (seedAvLanFromScan(mem)) {
          try { await persist(); } catch { /* keep memory pick; next boot retries */ }
        }
        startScheduler();
        return mem;
      });
  }
  return boot;
}
