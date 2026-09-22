/**
 * Schedules + triggers leaf extracted from store.server.ts (MR6).
 * Owns runDueSchedules / runDueTriggers / drainQueuedTriggers +
 * lastScheduleRun / trigger Maps / pendingTriggers / scheduleStamps /
 * pruneScheduleMaps. Preserves panel drainTriggerQueue behaviour (#85).
 * store.server keeps the public façade (re-exports) so callers stay stable.
 *
 * Deferred-imports memory / pushLog from store.server at call time to avoid a
 * module-init cycle. persistNow comes from store-persist (already cycle-safe).
 */
import { runMacro } from "./engine";
import { scheduleShouldRun, TriggerReservations, triggerPathHit, triggerStep } from "./logic-policy";
import type { DeviceHealth, DeviceStateMap, DriverSpec, Macro, RoomConfig } from "./types";
import { resolveTemplate, type VarMap } from "./vars";
import { persistNow } from "./store-persist";

/** Minimal memory shape needed to fire schedules / triggers. */
type SchedMemory = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  health: DeviceHealth;
  lastError: string | null;
  runningMacro: string | null;
  activeScene: string | null;
  host: { dim: boolean; locked: boolean; toast: string | null; block: string | null; pageId: string | null; fullscreenAt?: number };
};

type TriggerJob = { id: string; macroId: string; label: string; path: "t" | "f" };

const lastScheduleRun = new Map<string, string>();
/** Snapshot of schedule run stamps for durable persist (used by store-persist leaf). */
export function scheduleStamps(): Record<string, string> {
  return Object.fromEntries(lastScheduleRun);
}

/** Restore stamps from a persisted room snapshot (loadPersisted). */
export function loadScheduleStamps(stamps: Record<string, string> | undefined) {
  lastScheduleRun.clear();
  for (const [id, stamp] of Object.entries(stamps ?? {})) lastScheduleRun.set(id, stamp);
}

let scheduleBusy = false;
const lastTriggerValue = new Map<string, string>();
const lastTriggerFire = new Map<string, number>();
const lastTriggerHeld = new Map<string, number>();
const triggerQueue: TriggerJob[] = [];
const pendingTriggers = new TriggerReservations();

/** F8: drop process-global schedule / trigger map rows for removed rules. */
export function pruneScheduleMaps(config: RoomConfig) {
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
  const scheduleKeep = new Set<string>();
  for (const job of config.schedules ?? []) {
    scheduleKeep.add(job.id);
    scheduleKeep.add(`empty:${job.id}`);
  }
  for (const id of [...lastScheduleRun.keys()]) {
    if (!scheduleKeep.has(id)) lastScheduleRun.delete(id);
  }
}

export async function runDueSchedules() {
  if (scheduleBusy) return;
  scheduleBusy = true;
  try {
    const { memory, pushLog } = await import("./store.server");
    const mem = memory() as SchedMemory;
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
function parkTriggerBehindMacro(job: TriggerJob) {
  triggerQueue.push(job);
  pendingTriggers.reserve(`${job.id}:${job.path}`);
}

/** Same post-macro drain schedule uses — call after clearing runningMacro. */
export async function drainQueuedTriggers() {
  const { memory } = await import("./store.server");
  const mem = memory() as SchedMemory;
  const queued = triggerQueue.shift();
  if (queued) {
    const nested = mem.config.macros.find((m) => m.id === queued.macroId);
    if (nested) await runQueuedTrigger(queued, nested);
  }
}

export async function runDueTriggers() {
  const { memory, pushLog } = await import("./store.server");
  const mem = memory() as SchedMemory;
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
          const { memory: liveMemory } = await import("./store.server");
          const live = liveMemory() as SchedMemory;
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

async function runQueuedTrigger(job: TriggerJob, macro: Macro) {
  const { memory, pushLog } = await import("./store.server");
  const live = memory() as SchedMemory;
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
