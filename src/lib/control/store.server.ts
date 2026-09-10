import { bundledDrivers, defaultDeviceState, emptyRoomConfig } from "./defaults";
import { readMonitorValue, runMacro, traces, scrubSecret } from "./engine";
import type { DeviceHealth, DeviceStateMap, DriverSpec, LogEntry, Macro, MonitorStatus, RoomConfig, RoomSnapshot } from "./types";
import { NONE_MACRO_ID, noneMacro } from "./types";
import { applyMonitors, clampVar, resolveTemplate, seedVars, withMonitorVars, monitorVarId, type VarMap } from "./vars";
import { scheduleShouldRun, triggerPathHit, triggerStep } from "./logic-policy";
import { persistPair } from "../../../scripts/write-atomic.mjs";
import { mkdir, readFile, writeFile, readdir, unlink, access, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isSecretKey } from "./secrets";

const FILE_STORE = path.join(process.cwd(), "data", "relay-room.json");
const SECRET_STORE = process.env.RELAY_SECRETS_FILE || path.join(process.cwd(), "data", "relay-secrets.json");
const DRIVER_DIR = path.join(process.cwd(), "data", "drivers");

export function safeDriverName(name: string) {
  const base = String(name || "driver.json").split(/[/\\]/).pop() || "driver.json";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "-");
  return clean.toLowerCase().endsWith(".json") ? clean : `${clean}.json`;
}

export async function writeDriverFile(name: string, spec: DriverSpec) {
  await mkdir(DRIVER_DIR, { recursive: true });
  await writeFile(path.join(DRIVER_DIR, safeDriverName(name)), JSON.stringify(spec, null, 2));
}

export async function removeDriverFile(name: string) {
  const file = safeDriverName(name);
  await unlink(path.join(DRIVER_DIR, file)).catch(() => undefined);
  await unlink(path.join(process.cwd(), "public", "drivers", file)).catch(() => undefined);
}

export async function loadDriverFiles(): Promise<Record<string, DriverSpec>> {
  const bundled = { ...bundledDrivers };
  try {
    await mkdir(DRIVER_DIR, { recursive: true });
  } catch {
    return bundled;
  }
  try {
    const existing = await readdir(DRIVER_DIR).catch(() => [] as string[]);
    if (!existing.some((n) => n.endsWith(".json"))) {
      for (const [name, spec] of Object.entries(bundledDrivers)) {
        await writeFile(path.join(DRIVER_DIR, name), JSON.stringify(spec, null, 2)).catch(() => undefined);
      }
    }
    const out: Record<string, DriverSpec> = {};
    for (const name of await readdir(DRIVER_DIR).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      try {
        out[name] = JSON.parse(await readFile(path.join(DRIVER_DIR, name), "utf8")) as DriverSpec;
      } catch {
        /* skip bad file */
      }
    }
    return Object.keys(out).length ? out : bundled;
  } catch {
    return bundled;
  }
}

type Memory = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  library: Record<string, DriverSpec>;
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
};

const g = globalThis as typeof globalThis & {
  __relayMemory__?: Memory;
  __relaySched__?: ReturnType<typeof setInterval>;
  __relayMon__?: ReturnType<typeof setInterval>;
};
const lastScheduleRun = new Map<string, string>();
let scheduleBusy = false;
const lastMonitorRun = new Map<string, number>();
const lastTriggerValue = new Map<string, string>();
const lastTriggerFire = new Map<string, number>();
const lastTriggerHeld = new Map<string, number>();
const goodPolls = new Map<string, number>();
const triggerQueue: { id: string; macroId: string; label: string; path: "t" | "f" }[] = [];

type SecretFile = {
  configPin?: string;
  panelPin?: string | null;
  peerSecret?: string;
  sessions?: Record<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  devices?: Record<string, Record<string, string>>;
};


function pickSecrets(config: RoomConfig): SecretFile {
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

function publicConfig(config: RoomConfig): RoomConfig {
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

function applySecrets(config: RoomConfig, secrets?: SecretFile | null): RoomConfig {
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

async function readSecretFile(): Promise<SecretFile> {
  try {
    return JSON.parse(await readFile(SECRET_STORE, "utf8")) as SecretFile;
  } catch {
    return {};
  }
}

export async function reloadSecretsFromDisk() {
  const secrets = await readSecretFile();
  const mem = memory();
  mem.config = applySecrets(mem.config, secrets);
  mem.sessions = { ...(secrets.sessions ?? {}), ...(mem.sessions ?? {}) };
  return secrets;
}

export function normalize(config?: RoomConfig | null): RoomConfig {
  const demo = emptyRoomConfig();
  if (!config) return demo;
  return withMonitorVars({
    ...demo,
    ...config,
    room: {
      ...demo.room,
      ...(config.room ?? {}),
      network: { ...demo.room.network, ...(config.room?.network ?? {}) },
      grid: { ...demo.room.grid, ...(config.room?.grid ?? {}) },
      externalControl: config.room?.externalControl === true,
      panelAcceptsConfigPin: config.room?.panelAcceptsConfigPin === true,
      theme: config.room?.theme === "pastel" ? "pastel" : "dark",
    },
    variables: config.variables ?? demo.variables,
    schedules: config.schedules ?? demo.schedules,
    monitors: config.monitors ?? demo.monitors,
    triggers: (config.triggers ?? []).map((rule) => {
      const holdSec = rule.holdSec ?? Math.round((rule.holdMs || 0) / 1000);
      const delaySec = rule.delaySec ?? Math.round((rule.delayMs || 0) / 1000);
      const intervalSec = rule.intervalSec ?? Math.max(1, Math.round((rule.intervalMs || 5000) / 1000));
      const clip = (rows: typeof rule.whenTrue) => (rows ?? []).slice(0, 8).map((row) => ({
        variable: row.variable || "",
        compare: row.compare || "eq",
        equals: row.equals ?? "",
      }));
      return {
        ...rule,
        holdSec,
        delaySec,
        intervalSec,
        holdMs: undefined,
        delayMs: undefined,
        intervalMs: undefined,
        whenTrue: clip(rule.whenTrue),
        whenFalse: clip(rule.whenFalse),
        falseMacroId: rule.falseMacroId || "",
      };
    }),
    interfaces: config.interfaces ?? [],
    macros: [noneMacro(), ...(config.macros ?? demo.macros).filter((m) => m.id !== NONE_MACRO_ID)],
  });
}

function emptyMemory(): Memory {
  const config = emptyRoomConfig();
  return {
    config,
    drivers: { ...bundledDrivers },
    library: { ...bundledDrivers },
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
  };
}

export function memory(): Memory {
  if (!g.__relayMemory__) g.__relayMemory__ = emptyMemory();
  return g.__relayMemory__;
}

export async function loadPersisted(): Promise<Memory> {
  const mem = memory();
  const files = [FILE_STORE, `${FILE_STORE}.good`];
  for (const file of files) {
  try {
    const raw = await readFile(file, "utf8");
    const saved = JSON.parse(raw) as { config?: RoomConfig; drivers?: Record<string, DriverSpec>; state?: DeviceStateMap; vars?: VarMap; latches?: Record<string, string>; stamps?: Record<string, string> };
    if (saved.config) {
      const fromDisk = await readSecretFile();
      const fromRoom = pickSecrets(saved.config);
      mem.config = applySecrets(normalize(saved.config), {
        configPin: fromDisk.configPin || fromRoom.configPin,
        panelPin: fromDisk.panelPin || fromRoom.panelPin,
        peerSecret: fromDisk.peerSecret || fromRoom.peerSecret,
        devices: { ...fromRoom.devices, ...fromDisk.devices },
      });
      mem.library = await loadDriverFiles();
      mem.drivers = {};
      const savedNames = saved.drivers ? Object.keys(saved.drivers) : Object.keys(mem.library);
      for (const name of savedNames) {
        if (mem.library[name]) mem.drivers[name] = mem.library[name]!;
        else if (saved.drivers?.[name]) {
          mem.library[name] = saved.drivers[name]!;
          mem.drivers[name] = saved.drivers[name]!;
          await writeDriverFile(name, saved.drivers[name]!);
        }
      }
      mem.state = saved.state ?? defaultDeviceState();
      mem.vars = seedVars(mem.config, saved.vars);
      mem.latches = saved.latches ?? {};
      mem.sessions = fromDisk.sessions ?? {};
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
  mem.library = { ...mem.drivers };
  return mem;
}

async function writeFileStore(mem: Memory) {
  await mkdir(path.dirname(FILE_STORE), { recursive: true });
  const secrets = pickSecrets(mem.config);
  secrets.sessions = mem.sessions ?? {};
  const body = JSON.stringify({
    config: publicConfig(normalize(mem.config)),
    drivers: mem.drivers,
    state: mem.state,
    vars: mem.vars,
    latches: mem.latches ?? {},
    stamps: Object.fromEntries(lastScheduleRun),
  });
  persistPair(SECRET_STORE, FILE_STORE, JSON.stringify(secrets), body);
}

let persistChain = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

async function flushPersist() {
  if (!persistDirty) return;
  const mem = memory();
  await writeFileStore(mem);
  persistDirty = false;
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

export function snapshot(): RoomSnapshot {
  const mem = memory();
  mem.config = normalize(mem.config);
  mem.drivers = mem.drivers ?? {};
  mem.library = mem.library ?? {};
  mem.vars = seedVars(mem.config, mem.vars);
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
    const queued = triggerQueue.shift();
    if (queued) {
      const nested = mem.config.macros.find((m) => m.id === queued.macroId);
      if (nested) await runQueuedTrigger(queued, nested);
    }
  }
  } finally {
    scheduleBusy = false;
  }
}


async function runDueTriggers() {
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
      if (triggerQueue.some((item) => item.id === rule.id && item.path === path)) continue;
      const job = { id: rule.id, macroId, label: rule.label, path };
      if (mem.runningMacro) {
        triggerQueue.push(job);
        lastTriggerValue.set(key, "true:");
        continue;
      }
      const waitMs = Math.min((rule.delaySec || 0) * 1000, 120_000);
      void (async () => {
        if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
        await runQueuedTrigger(job, macro);
      })();
    }
  }
}

async function runQueuedTrigger(job: { id: string; macroId: string; label: string; path: "t" | "f" }, macro: Macro) {
  const live = memory();
  const rule = (live.config.triggers ?? []).find((item) => item.id === job.id);
  const key = `${job.id}:${job.path}`;
  if (rule?.variable) {
    const value = (raw: string) => String(resolveTemplate(raw, live.vars, live.config.variables) ?? raw);
    if (!triggerPathHit(rule, live.vars, job.path, value)) {
      lastTriggerValue.set(key, "false:");
      lastTriggerHeld.delete(key);
      return;
    }
  }
  if (live.runningMacro) {
    if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) triggerQueue.push(job);
    return;
  }
  live.runningMacro = macro.id;
  const result = await runMacro({ config: live.config, drivers: live.drivers, state: live.state, vars: live.vars, health: live.health ?? (live.health = {}), macro, host: live.host });
  live.runningMacro = null;
  if (result.ok) {
    lastTriggerValue.set(key, "true:");
    lastTriggerFire.set(key, Date.now());
    live.activeScene = macro.id;
  }
  if (!result.ok && live.host?.block) live.host.block = null;
  pushLog({ kind: "macro", ok: result.ok, title: `Trigger ${job.label}`, detail: result.message });
  const next = triggerQueue.shift();
  if (!next) return;
  const nested = live.config.macros.find((m) => m.id === next.macroId);
  if (nested) await runQueuedTrigger(next, nested);
}

let monitorsBusy = false;

async function runDueMonitors() {
  if (monitorsBusy) return;
  monitorsBusy = true;
  try {
  const mem = memory();
  const now = Date.now();
  let dirty = false;
  for (const rule of mem.config.monitors ?? []) {
    if (!rule.enabled) continue;
    const wait = Math.max(500, rule.pollMs || 8000);
    const last = lastMonitorRun.get(rule.id) ?? 0;
    if (now - last < wait) continue;
    lastMonitorRun.set(rule.id, now);
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
      continue;
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
    if (String(mem.vars[autoId] ?? "") !== String(next)) {
      mem.vars[autoId] = next;
      dirty = true;
    }
    if (rule.writeVar && rule.writeVar !== autoId && String(mem.vars[rule.writeVar]) !== String(next)) {
      mem.vars[rule.writeVar] = next;
      dirty = true;
      pushLog({ kind: "monitor", ok: true, title: rule.label, detail: String(next) });
    }
  }
  if (dirty) await persist();
  } finally {
    monitorsBusy = false;
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
      runDueMonitors().catch(() => undefined);
      runDueTriggers().catch(() => undefined);
    }, 500);
  }
}

let boot: Promise<Memory> | null = null;
export function ensureLoaded() {
  if (!boot) {
    boot = loadPersisted()
      .then((mem) => {
        if (!Object.keys(mem.drivers ?? {}).length) {
          mem.drivers = { ...bundledDrivers };
          mem.library = { ...bundledDrivers };
        }
        if (!mem.config?.room) mem.config = emptyRoomConfig();
        startScheduler();
        return mem;
      })
      .catch(() => {
        const mem = memory();
        mem.config = emptyRoomConfig();
        mem.drivers = { ...bundledDrivers };
        mem.library = { ...bundledDrivers };
        mem.vars = seedVars(mem.config, mem.vars);
        startScheduler();
        return mem;
      });
  }
  return boot;
}
