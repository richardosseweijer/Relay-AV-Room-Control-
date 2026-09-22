import { defaultDeviceState, emptyRoomConfig, hostDriverSeed, workingSetNames } from "./defaults";
import { readMonitorValue, runMacro, traces, scrubSecret, socketStats } from "./engine";
import { syncMidiWatchers } from "./midi-in";
import type { DeviceHealth, DeviceStateMap, DriverIndex, DriverSpec, LogEntry, Macro, MonitorStatus, RoomConfig, RoomSnapshot } from "./types";
import { indexDriver } from "./types";
import { applyMonitors, clampVar, resolveTemplate, seedVars, monitorVarId, type VarMap } from "./vars";
import { scheduleShouldRun, TriggerReservations, triggerPathHit, triggerStep } from "./logic-policy";
import { retainSacnCidKeys } from "./sacn";
import { retainPaceDevices, pruneIdlePaceDevices } from "./engine-wire";
import { MONITOR_DEVICE_CONCURRENCY, groupMonitorRulesByDevice, mapPool } from "./monitor-pool";
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
import { FILE_STORE, persist, persistNow } from "./store-persist";
import {
  normalize,
  normalizedConfig,
  installRoomConfig,
  rememberNormalized,
  bindNormalizeInstallDeps,
} from "./store-normalize";
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
export { persist, persistNow };

export {
  normalize,
  normalizedConfig,
  invalidateNormalizedConfig,
  installRoomConfig,
} from "./store-normalize";


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
const lastScheduleRun = new Map<string, string>();
/** Snapshot of schedule run stamps for durable persist (used by store-persist leaf). */
export function scheduleStamps(): Record<string, string> {
  return Object.fromEntries(lastScheduleRun);
}
let scheduleBusy = false;
const lastMonitorRun = new Map<string, number>();
const lastTriggerValue = new Map<string, string>();
const lastTriggerFire = new Map<string, number>();
const lastTriggerHeld = new Map<string, number>();
const goodPolls = new Map<string, number>();
const triggerQueue: { id: string; macroId: string; label: string; path: "t" | "f" }[] = [];
const pendingTriggers = new TriggerReservations();

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

  const triggerKeys = new Set<string>();
  for (const rule of config.triggers ?? []) {
    if (rule.macroId) triggerKeys.add(`${rule.id}:t`);
    if (rule.falseMacroId) triggerKeys.add(`${rule.id}:f`);
  }
  for (const key of [...lastTriggerValue.keys()]) {
    if (!triggerKeys.has(key)) {
      lastTriggerValue.delete(key);
      lastTriggerFire.delete(key);
      lastTriggerHeld.delete(key);
    }
  }
  const monitorIds = new Set((config.monitors ?? []).map((m) => m.id));
  for (const id of [...lastMonitorRun.keys()]) {
    if (!monitorIds.has(id)) lastMonitorRun.delete(id);
  }
  const deviceSet = new Set(deviceIds);
  for (const id of [...goodPolls.keys()]) {
    if (!deviceSet.has(id)) goodPolls.delete(id);
  }
  const scheduleKeep = new Set<string>();
  for (const job of config.schedules ?? []) {
    scheduleKeep.add(job.id);
    scheduleKeep.add(`empty:${job.id}`);
  }
  for (const id of [...lastScheduleRun.keys()]) {
    if (!scheduleKeep.has(id)) lastScheduleRun.delete(id);
  }
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

// Sync wire for store-normalize installRoomConfig (scheduler/monitor prune stays here).
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
      lastScheduleRun.clear();
      for (const [id, stamp] of Object.entries(saved.stamps ?? {})) lastScheduleRun.set(id, stamp);
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

async function runDueSchedules() {
  if (scheduleBusy) return;
  scheduleBusy = true;
  try {
  const mem = memory();
  const tz = mem.config.room.network?.timezone;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: !tz || tz === "system" ? undefined : tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const time = `${hour}:${minute}`;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday] ?? 0;
  const now = new Date();
  const stamp = `${tz}-${now.toISOString().slice(0, 10)}T${time}`;
  for (const job of mem.config.schedules ?? []) {
    if (!job.enabled || job.time !== time) continue;
    if (!scheduleShouldRun(job, time, day)) {
      if (!job.days.length) {
        const skipKey = `empty:${job.id}`;
        if (lastScheduleRun.get(skipKey) !== stamp) {
          lastScheduleRun.set(skipKey, stamp);
          pushLog({ kind: "macro", ok: true, title: `Schedule ${job.label}`, detail: "skipped empty days" });
        }
      }
      continue;
    }
    if (lastScheduleRun.get(job.id) === stamp) continue;
    const macro = mem.config.macros.find((m) => m.id === job.macroId);
    if (!macro) continue;
    mem.runningMacro = macro.id;
    const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro, host: mem.host });
    mem.runningMacro = null;
    if (!result.ok && mem.host?.block) mem.host.block = null;
    if (result.ok) {
      mem.activeScene = macro.id;
      lastScheduleRun.set(job.id, stamp);
      if (lastScheduleRun.size > 200) {
        const first = lastScheduleRun.keys().next().value;
        if (first) lastScheduleRun.delete(first);
      }
      await persistNow();
    }
    mem.lastError = result.ok ? null : result.message;
    pushLog({ kind: "macro", ok: result.ok, title: `Schedule ${job.label}`, detail: result.message });
    await drainQueuedTriggers();
  }
  } finally {
    scheduleBusy = false;
  }
}


/** Park a trigger while runningMacro is held (same push runDueTriggers uses). */
function parkTriggerBehindMacro(job: { id: string; macroId: string; label: string; path: "t" | "f" }) {
  triggerQueue.push(job);
  pendingTriggers.reserve(`${job.id}:${job.path}`);
}

/** Same post-macro drain schedule uses — call after clearing runningMacro. */
export async function drainQueuedTriggers() {
  const mem = memory();
  const queued = triggerQueue.shift();
  if (queued) {
    const nested = mem.config.macros.find((m) => m.id === queued.macroId);
    if (nested) await runQueuedTrigger(queued, nested);
  }
}

export async function runDueTriggers() {
  const mem = memory();
  const now = Date.now();
  const value = (raw: string) => String(resolveTemplate(raw, mem.vars, mem.config.variables) ?? raw);
  for (const rule of mem.config.triggers ?? []) {
    if (!rule.enabled || !rule.variable) continue;
    const paths: { path: "t" | "f"; macroId: string }[] = [];
    if (rule.macroId) paths.push({ path: "t", macroId: rule.macroId });
    if (rule.falseMacroId) paths.push({ path: "f", macroId: rule.falseMacroId });
    for (const { path, macroId } of paths) {
      const key = `${rule.id}:${path}`;
      const hit = triggerPathHit(rule, mem.vars, path, value);
      const prev = lastTriggerValue.get(key);
      const step = triggerStep(rule.mode, prev, hit);
      if (step === "reset") {
        lastTriggerValue.set(key, "false:");
        lastTriggerHeld.delete(key);
        continue;
      }
      const holdMs = Math.min(Math.max((rule.holdSec ?? 0) * 1000, 0), 7_200_000);
      if (holdMs) {
        const since = lastTriggerHeld.get(key);
        if (since === undefined) {
          lastTriggerHeld.set(key, now);
          continue;
        }
        if (now - since < holdMs) continue;
      } else {
        lastTriggerHeld.set(key, now);
      }
      if (step === "arm") {
        lastTriggerValue.set(key, "true:");
        continue;
      }
      if (step === "hold") continue;
      const wait = Math.max(500, (rule.intervalSec || 1) * 1000);
      if (rule.mode === "interval" && now - (lastTriggerFire.get(key) ?? 0) < wait) continue;
      if (rule.mode === "change" && now - (lastTriggerFire.get(key) ?? 0) < 400) continue;
      const macro = mem.config.macros.find((m) => m.id === macroId);
      if (!macro) continue;
      if (pendingTriggers.has(key) || triggerQueue.some((item) => item.id === rule.id && item.path === path)) continue;
      const job = { id: rule.id, macroId, label: rule.label, path };
      if (mem.runningMacro) {
        parkTriggerBehindMacro(job);
        lastTriggerValue.set(key, "true:");
        continue;
      }
      const waitMs = Math.min((rule.delaySec || 0) * 1000, 120_000);
      if (!pendingTriggers.reserve(key)) continue;
      lastTriggerValue.set(key, "true:");
      void (async () => {
        try {
          if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
          const live = memory();
          const current = live.config.macros.find((item) => item.id === macro.id);
          if (current) await runQueuedTrigger(job, current);
        } catch (err) {
          pushLog({ kind: "macro", ok: false, title: `Trigger ${job.label}`, detail: err instanceof Error ? err.message : "trigger failed" });
        } finally {
          if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) pendingTriggers.release(key);
        }
      })();
    }
  }
}

async function runQueuedTrigger(job: { id: string; macroId: string; label: string; path: "t" | "f" }, macro: Macro) {
  const live = memory();
  const rule = (live.config.triggers ?? []).find((item) => item.id === job.id);
  const key = `${job.id}:${job.path}`;
  if (!rule?.enabled || !rule.variable || (rule.macroId !== job.macroId && rule.falseMacroId !== job.macroId)) {
    pendingTriggers.release(key);
    return;
  }
  if (rule.variable) {
    const value = (raw: string) => String(resolveTemplate(raw, live.vars, live.config.variables) ?? raw);
    if (!triggerPathHit(rule, live.vars, job.path, value)) {
      lastTriggerValue.set(key, "false:");
      lastTriggerHeld.delete(key);
      pendingTriggers.release(key);
      return;
    }
  }
  if (live.runningMacro) {
    if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) {
      triggerQueue.push(job);
      pendingTriggers.reserve(key);
    }
    return;
  }
  live.runningMacro = macro.id;
  try {
    const result = await runMacro({ config: live.config, drivers: live.drivers, state: live.state, vars: live.vars, health: live.health ?? (live.health = {}), macro, host: live.host });
    if (result.ok) {
      lastTriggerValue.set(key, "true:");
      lastTriggerFire.set(key, Date.now());
      live.activeScene = macro.id;
    }
    if (!result.ok && live.host?.block) live.host.block = null;
    pushLog({ kind: "macro", ok: result.ok, title: `Trigger ${job.label}`, detail: result.message });
  } catch (err) {
    pushLog({ kind: "macro", ok: false, title: `Trigger ${job.label}`, detail: err instanceof Error ? err.message : "trigger failed" });
  } finally {
    live.runningMacro = null;
    pendingTriggers.release(key);
  }
  const next = triggerQueue.shift();
  if (!next) return;
  const nested = live.config.macros.find((m) => m.id === next.macroId);
  if (nested) await runQueuedTrigger(next, nested);
  else pendingTriggers.release(`${next.id}:${next.path}`);
}

let monitorsBusy = false;

/** Apply one due monitor rule; returns whether vars were dirtied. Same-device callers stay serial via F6 pool. */
async function applyDueMonitor(mem: Memory, rule: NonNullable<RoomConfig["monitors"]>[number], now: number): Promise<boolean> {
  let dirty = false;
  const result = await readMonitorValue({
    config: mem.config,
    drivers: mem.drivers,
    state: mem.state,
    deviceId: rule.device,
    feedbackId: rule.feedback,
    interfaceId: rule.interfaceId,
    query: rule.query,
    parsePattern: rule.parsePattern,
    host: mem.host,
  });
  mem.monitorStatus = mem.monitorStatus ?? {};
  if (!result.ok) {
    mem.monitorStatus[rule.id] = { at: now, ok: false, value: "", message: result.message };
    goodPolls.set(rule.device, 0);
    const errVar = rule.errorVar || rule.writeVar;
    if (errVar && rule.errorValue !== undefined && rule.errorValue !== "") {
      const def = mem.config.variables.find((v) => v.id === errVar);
      const next = def ? clampVar(def, rule.errorValue) : rule.errorValue;
      if (String(mem.vars[errVar]) !== String(next)) {
        mem.vars[errVar] = next;
        dirty = true;
      }
      mem.monitorStatus[rule.id] = { at: now, ok: false, value: String(next), message: result.message };
    }
    pushLog({ kind: "monitor", ok: false, title: rule.label, detail: result.message });
    return dirty;
  }
  const wins = (goodPolls.get(rule.device) ?? 0) + 1;
  goodPolls.set(rule.device, wins);
  if (wins >= 2 && mem.health[rule.device] && !mem.health[rule.device]!.ok) {
    delete mem.health[rule.device];
    pushLog({ kind: "system", ok: true, title: rule.label, detail: "Device recovered" });
  }
  let value = result.value;
  if (rule.mapMode === "map") {
    const hit = (rule.map ?? []).find((row) => row.from === value);
    if (hit) value = hit.to;
  }
  const autoId = monitorVarId(rule);
  const def = mem.config.variables.find((v) => v.id === rule.writeVar) || mem.config.variables.find((v) => v.id === autoId);
  const next = def ? clampVar(def, value) : value;
  mem.monitorStatus[rule.id] = { at: now, ok: true, value: String(next), message: result.message };
  const changedAuto = String(mem.vars[autoId] ?? "") !== String(next);
  const changedWrite = Boolean(rule.writeVar && rule.writeVar !== autoId && String(mem.vars[rule.writeVar]) !== String(next));
  if (changedAuto) {
    mem.vars[autoId] = next;
    dirty = true;
  }
  if (changedWrite && rule.writeVar) {
    mem.vars[rule.writeVar] = next;
    dirty = true;
  }
  if (changedAuto || changedWrite) {
    pushLog({ kind: "monitor", ok: true, title: rule.label, detail: String(next) });
  }
  return dirty;
}

async function runDueMonitors() {
  if (monitorsBusy) return;
  monitorsBusy = true;
  try {
    const mem = memory();
    const now = Date.now();
    const due: NonNullable<RoomConfig["monitors"]> = [];
    for (const rule of mem.config.monitors ?? []) {
      if (!rule.enabled) continue;
      const wait = Math.max(500, rule.pollMs || 8000);
      const last = lastMonitorRun.get(rule.id) ?? 0;
      if (now - last < wait) continue;
      lastMonitorRun.set(rule.id, now);
      due.push(rule);
    }
    if (!due.length) return;

    // F6: parallelize across devices (bounded); serialize rules that share a device.
    const groups = groupMonitorRulesByDevice(due);
    let dirty = false;
    await mapPool(groups, MONITOR_DEVICE_CONCURRENCY, async (rules) => {
      for (const rule of rules) {
        if (await applyDueMonitor(mem, rule, now)) dirty = true;
      }
    });
    if (dirty) await persist();
  } finally {
    monitorsBusy = false;
  }
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
        startScheduler();
        return mem;
      })
      .catch(async () => {
        const mem = memory();
        installRoomConfig(emptyRoomConfig());
        mem.drivers = hostDriverSeed();
        mem.library = await loadLibraryIndex();
        mem.vars = seedVars(mem.config, mem.vars);
        startScheduler();
        return mem;
      });
  }
  return boot;
}
