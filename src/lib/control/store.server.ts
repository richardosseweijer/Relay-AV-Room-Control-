import { bundledDrivers, defaultDeviceState, emptyRoomConfig } from "./defaults";
import { readMonitorValue, runMacro, traces, scrubSecret } from "./engine";
import type { DeviceHealth, DeviceStateMap, DriverSpec, LogEntry, Macro, MonitorStatus, RoomConfig, RoomSnapshot } from "./types";
import { applyMonitors, clampVar, resolveTemplate, seedVars, type VarMap } from "./vars";
import { mkdir, readFile, writeFile, readdir, unlink, access, rename } from "node:fs/promises";
import path from "node:path";

const ROW_ID = "current";
const FILE_STORE = path.join(process.cwd(), "data", "relay-room.json");
const SECRET_STORE = path.join(process.cwd(), "data", "relay-secrets.json");
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
  sessions: Record<string, { secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
};

const g = globalThis as typeof globalThis & {
  __relayMemory__?: Memory;
  __relaySched__?: ReturnType<typeof setInterval>;
  __relayMon__?: ReturnType<typeof setInterval>;
};
const lastScheduleRun = new Map<string, string>();
const lastMonitorRun = new Map<string, number>();
const lastTriggerValue = new Map<string, string>();
const lastTriggerFire = new Map<string, number>();
const lastTriggerHeld = new Map<string, number>();
const goodPolls = new Map<string, number>();
const triggerQueue: { id: string; macroId: string; label: string }[] = [];

type SecretFile = {
  configPin?: string;
  panelPin?: string | null;
  peerSecret?: string;
  sessions?: Record<string, { secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  devices?: Record<string, Record<string, string>>;
};

function isSecretKey(key: string) {
  return /token|password|secret|key|username|pin/i.test(key);
}

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

export function normalize(config?: RoomConfig | null): RoomConfig {
  const demo = emptyRoomConfig();
  if (!config) return demo;
  return {
    ...demo,
    ...config,
    room: {
      ...demo.room,
      ...(config.room ?? {}),
      network: { ...demo.room.network, ...(config.room?.network ?? {}) },
      grid: { ...demo.room.grid, ...(config.room?.grid ?? {}) },
      externalControl: config.room?.externalControl === true,
      theme: config.room?.theme === "pastel" || config.room?.theme === "light" ? "pastel" : "dark",
    },
    variables: config.variables ?? demo.variables,
    schedules: config.schedules ?? demo.schedules,
    monitors: config.monitors ?? demo.monitors,
    triggers: (config.triggers ?? []).map((rule) => {
      const holdSec = rule.holdSec ?? Math.round((rule.holdMs || 0) / 1000);
      const delaySec = rule.delaySec ?? Math.round((rule.delayMs || 0) / 1000);
      const intervalSec = rule.intervalSec ?? Math.max(1, Math.round((rule.intervalMs || 5000) / 1000));
      return { ...rule, holdSec, delaySec, intervalSec, holdMs: undefined, delayMs: undefined, intervalMs: undefined };
    }),
    interfaces: config.interfaces ?? [],
  };
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

async function sqlOrNull() {
  const url = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
  const prodWithoutDb = process.env.NODE_ENV === "production" && !url;
  if (prodWithoutDb) return null;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await Promise.race([
      getSql(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return sql;
  } catch {
    return null;
  }
}


export async function loadPersisted(): Promise<Memory> {
  const mem = memory();
  try {
    const raw = await readFile(FILE_STORE, "utf8");
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
      for (const [key, row] of Object.entries(mem.sessions)) {
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
    /* fall through to sql / demo */
  }
  mem.drivers = await loadDriverFiles();
  mem.library = { ...mem.drivers };
  const sql = await sqlOrNull();
  if (!sql) return mem;
  try {
    const rows = await sql<{
      config_json: string;
      drivers_json: string;
      state_json: string;
    }>`select config_json, drivers_json, state_json from room_store where id = ${ROW_ID}`;
    const row = rows[0];
    if (!row) {
      persist();
      return mem;
    }
    mem.config = applySecrets(normalize(JSON.parse(row.config_json) as RoomConfig), await readSecretFile());
    mem.library = await loadDriverFiles();
    mem.drivers = { ...mem.library };
    mem.state = JSON.parse(row.state_json) as DeviceStateMap;
    const storedVars = mem.state.__vars as unknown as VarMap | undefined;
    delete mem.state.__vars;
    mem.vars = seedVars(mem.config, storedVars);
    mem.health = mem.health ?? {};
    applyMonitors(mem.config, mem.state, mem.vars);
    await writeFileStore(mem);
  } catch {
    /* keep memory defaults */
  }
  return mem;
}

async function writeFileStore(mem: Memory) {
  try {
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
    const tmp = `${FILE_STORE}.tmp`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, FILE_STORE);
    const secretTmp = `${SECRET_STORE}.tmp`;
    await writeFile(secretTmp, JSON.stringify(secrets), "utf8");
    await rename(secretTmp, SECRET_STORE);
  } catch {
    /* disk missing or not writable */
  }
}

let persistChain = Promise.resolve();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

async function flushPersist() {
  if (!persistDirty) return;
  const mem = memory();
  await writeFileStore(mem);
  persistDirty = false;
  const sql = await sqlOrNull();
  if (!sql) return;
  try {
    const configJson = JSON.stringify(normalize(mem.config));
    const driversJson = JSON.stringify(mem.drivers);
    const stateJson = JSON.stringify({ ...mem.state, __vars: mem.vars });
    await sql`
      insert into room_store (id, config_json, drivers_json, state_json, updated_at)
      values (${ROW_ID}, ${configJson}, ${driversJson}, ${stateJson}, now())
      on conflict (id) do update set
        config_json = excluded.config_json,
        drivers_json = excluded.drivers_json,
        state_json = excluded.state_json,
        updated_at = now()
    `;
  } catch {
    /* file store already committed */
  }
}

export async function persistNow() {
  persistDirty = true;
  const run = persistChain.catch(() => undefined).then(flushPersist);
  persistChain = run.catch(() => undefined);
  await run;
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
  };
}

async function runDueSchedules() {
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
    if (!job.days.length || !job.days.includes(day)) continue;
    if (lastScheduleRun.get(job.id) === stamp) continue;
    const macro = mem.config.macros.find((m) => m.id === job.macroId);
    if (!macro) continue;
    lastScheduleRun.set(job.id, stamp);
    if (lastScheduleRun.size > 200) {
      const first = lastScheduleRun.keys().next().value;
      if (first) lastScheduleRun.delete(first);
    }
    mem.runningMacro = macro.id;
    const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro, host: mem.host });
    mem.runningMacro = null;
    if (!result.ok && mem.host?.block) mem.host.block = null;
    if (result.ok) mem.activeScene = macro.id;
    mem.lastError = result.ok ? null : result.message;
    pushLog({ kind: "macro", ok: result.ok, title: `Schedule ${job.label}`, detail: result.message });
    await persist();
    const queued = triggerQueue.shift();
    if (queued) {
      const nested = mem.config.macros.find((m) => m.id === queued.macroId);
      if (nested) await runQueuedTrigger(queued, nested);
    }
  }
}

function matchesTrigger(left: string, compare: string, right: string) {
  if (compare === "gt" || compare === "lt") {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return compare === "gt" ? a > b : a < b;
  }
  const same = left.trim().toLowerCase() === right.trim().toLowerCase();
  return compare === "neq" ? !same : same;
}

async function runDueTriggers() {
  const mem = memory();
  const now = Date.now();
  for (const rule of mem.config.triggers ?? []) {
    if (!rule.enabled || !rule.variable || !rule.macroId) continue;
    const raw = mem.vars[rule.variable];
    if (raw === undefined) continue;
    const left = String(raw);
    const right = String(resolveTemplate(rule.equals, mem.vars, mem.config.variables) ?? rule.equals);
    const hit = matchesTrigger(left, rule.compare || "eq", right);
    const prev = lastTriggerValue.get(rule.id);
    if (!hit) {
      lastTriggerValue.set(rule.id, `false:${left}`);
      lastTriggerHeld.delete(rule.id);
      continue;
    }
    const holdMs = Math.min(Math.max((rule.holdSec ?? 0) * 1000, 0), 7_200_000);
    if (holdMs) {
      const since = lastTriggerHeld.get(rule.id);
      if (since === undefined) {
        lastTriggerHeld.set(rule.id, now);
        continue;
      }
      if (now - since < holdMs) continue;
    } else {
      lastTriggerHeld.set(rule.id, now);
    }
    if (rule.mode === "change") {
      if (prev === undefined) {
        lastTriggerValue.set(rule.id, `true:${left}`);
        continue;
      }
      if (prev.startsWith("true:")) continue;
    }
    const wait = Math.max(500, (rule.intervalSec || 1) * 1000);
    if (rule.mode === "interval" && now - (lastTriggerFire.get(rule.id) ?? 0) < wait) continue;
    if (rule.mode === "change" && now - (lastTriggerFire.get(rule.id) ?? 0) < 400) continue;
    const macro = mem.config.macros.find((m) => m.id === rule.macroId);
    if (!macro) continue;
    if (mem.runningMacro) {
      if (!triggerQueue.some((item) => item.id === rule.id)) triggerQueue.push({ id: rule.id, macroId: rule.macroId, label: rule.label });
      continue;
    }
    lastTriggerValue.set(rule.id, `true:${left}`);
    lastTriggerFire.set(rule.id, now);
    const waitMs = Math.min((rule.delaySec || 0) * 1000, 120_000);
    const job = { id: rule.id, macroId: rule.macroId, label: rule.label };
    const macroRef = macro;
    void (async () => {
      if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
      await runQueuedTrigger(job, macroRef, prev);
    })();
  }
}

async function runQueuedTrigger(job: { id: string; macroId: string; label: string }, macro: Macro, prev?: string) {
  const live = memory();
  if (live.runningMacro) {
    if (!triggerQueue.some((item) => item.id === job.id)) triggerQueue.push(job);
    if (prev !== undefined) lastTriggerValue.set(job.id, prev);
    return;
  }
  live.runningMacro = macro.id;
  const result = await runMacro({ config: live.config, drivers: live.drivers, state: live.state, vars: live.vars, health: live.health ?? (live.health = {}), macro, host: live.host });
  live.runningMacro = null;
  if (!result.ok && live.host?.block) live.host.block = null;
  if (result.ok) live.activeScene = macro.id;
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
    const wait = Math.max(1000, rule.pollMs || 8000);
    const last = lastMonitorRun.get(rule.id) ?? 0;
    if (now - last < wait) continue;
    lastMonitorRun.set(rule.id, now);
    const result = await readMonitorValue({
      config: mem.config,
      drivers: mem.drivers,
      state: mem.state,
      deviceId: rule.device,
      feedbackId: rule.feedback,
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
    const def = mem.config.variables.find((v) => v.id === rule.writeVar);
    const next = def ? clampVar(def, value) : value;
    mem.monitorStatus[rule.id] = { at: now, ok: true, value: String(next), message: result.message };
    if (rule.writeVar && String(mem.vars[rule.writeVar]) !== String(next)) {
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
    }, 2000);
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
