/**
 * Schedules + triggers leaf extracted from store.server.ts (MR6).
 * Owns runDueSchedules / runDueTriggers / runBootTriggers / drainQueuedTriggers +
 * lastScheduleRun / trigger Maps / pendingTriggers / scheduleStamps /
 * pruneScheduleMaps. Preserves panel drainTriggerQueue behaviour (#85).
 * store.server keeps the public façade (re-exports) so callers stay stable.
 *
 * Deferred-imports memory / pushLog from store.server at call time to avoid a
 * module-init cycle. persistNow comes from store-persist (already cycle-safe).
 */
import { executeCommand, runMacro } from "./engine";
import { scheduleShouldRun, TriggerReservations, triggerPathHit, triggerStep, bootTriggerPaths } from "./logic-policy";
import { triggerHasFalseWork, triggerHasTrueWork, falseActionOf, runTriggerTruePlan } from "./trigger-actions";
import type { DeviceHealth, DeviceStateMap, DriverSpec, Macro, RoomConfig } from "./types";
import { resolveTemplate, writeConfiguredVar, type VarMap } from "./vars";
import { persist, persistNow } from "./store-persist";
import { clearHostBlock } from "./host-ui-bus";

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
  host: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block: string | null; blockAt?: number; pageId: string | null; pageAt?: number; fullscreenAt?: number };
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
const triggerQueue: TriggerJob[] = [];
const pendingTriggers = new TriggerReservations();

/** F8: drop process-global schedule / trigger map rows for removed rules. */
export function pruneScheduleMaps(config: RoomConfig) {
  const triggerKeys = new Set<string>();
  for (const rule of config.triggers ?? []) {
    if (rule.macroId || triggerHasTrueWork(rule)) triggerKeys.add(`${rule.id}:t`);
    if (triggerHasFalseWork(rule)) triggerKeys.add(`${rule.id}:f`);
  }
  for (const key of [...lastTriggerValue.keys()]) {
    if (!triggerKeys.has(key)) {
      lastTriggerValue.delete(key);
      lastTriggerFire.delete(key);
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
      if (!result.ok && mem.host) clearHostBlock(mem.host);
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


/** Once per process after store load. Survives Vite HMR via globalThis — does not re-fire on hot reload. */
export async function runBootTriggers() {
  const g = globalThis as typeof globalThis & { __relayBootTriggersDone__?: boolean };
  if (g.__relayBootTriggersDone__) return;
  g.__relayBootTriggersDone__ = true;
  try {
    const { memory, pushLog } = await import("./store.server");
    const mem = memory() as SchedMemory;
    const value = (raw: string) => String(resolveTemplate(raw, mem.vars, mem.config.variables) ?? raw);
    for (const rule of mem.config.triggers ?? []) {
      if (!rule.enabled || rule.mode !== "boot") continue;
      const pathList = bootTriggerPaths(rule, mem.vars, value);
      for (const path of pathList) {
        const macroId = path === "t" ? (rule.macroId || "") : (rule.falseMacroId || "");
        const extra = path === "t" ? triggerHasTrueWork(rule) : triggerHasFalseWork(rule);
        if (!extra && (!macroId || macroId === "none")) continue;
        const key = `${rule.id}:${path}`;
        if (pendingTriggers.has(key) || triggerQueue.some((item) => item.id === rule.id && item.path === path)) continue;
        const macro = mem.config.macros.find((m) => m.id === macroId);
        if (!macro && !extra) continue;
        const job: TriggerJob = { id: rule.id, macroId, label: rule.label, path };
        if (mem.runningMacro) {
          parkTriggerBehindMacro(job);
          lastTriggerValue.set(key, "true:");
          continue;
        }
        if (!pendingTriggers.reserve(key)) continue;
        lastTriggerValue.set(key, "true:");
        try {
          const current = mem.config.macros.find((item) => item.id === macro?.id);
          if (current || extra) await runQueuedTrigger(job, current);
        } catch (err) {
          pushLog({
            kind: "macro",
            ok: false,
            title: `Boot trigger ${job.label}`,
            detail: err instanceof Error ? err.message : "boot trigger failed",
          });
        } finally {
          if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) pendingTriggers.release(key);
        }
      }
    }
  } catch (err) {
    try {
      const { pushLog } = await import("./store.server");
      pushLog({
        kind: "macro",
        ok: false,
        title: "Boot triggers",
        detail: err instanceof Error ? err.message : "boot triggers failed",
      });
    } catch {
      /* soft-fail: boot must not die */
    }
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
    const rule = (mem.config.triggers ?? []).find((item) => item.id === queued.id);
    const extra = Boolean(rule && (queued.path === "t" ? triggerHasTrueWork(rule) : triggerHasFalseWork(rule)));
    if (nested || extra) await runQueuedTrigger(queued, nested);
    else pendingTriggers.release(`${queued.id}:${queued.path}`);
  }
}

export async function runDueTriggers() {
  const { memory, pushLog } = await import("./store.server");
  const mem = memory() as SchedMemory;
  const now = Date.now();
  const value = (raw: string) => String(resolveTemplate(raw, mem.vars, mem.config.variables) ?? raw);
  for (const rule of mem.config.triggers ?? []) {
    if (!rule.enabled || rule.mode === "boot" || !rule.variable) continue;
    const paths: { path: "t" | "f"; macroId: string }[] = [];
    if (rule.macroId || triggerHasTrueWork(rule)) paths.push({ path: "t", macroId: rule.macroId || "" });
    if (triggerHasFalseWork(rule)) paths.push({ path: "f", macroId: rule.falseMacroId || "" });
    for (const { path, macroId } of paths) {
      const key = `${rule.id}:${path}`;
      const hit = triggerPathHit(rule, mem.vars, path, value);
      const prev = lastTriggerValue.get(key);
      const step = triggerStep(rule.mode, prev, hit);
      if (step === "reset") {
        lastTriggerValue.set(key, "false:");
        continue;
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
      const extra = path === "t" ? triggerHasTrueWork(rule) : triggerHasFalseWork(rule);
      if (!macro && !extra) continue;
      if (pendingTriggers.has(key) || triggerQueue.some((item) => item.id === rule.id && item.path === path)) continue;
      const job = { id: rule.id, macroId, label: rule.label, path };
      if (mem.runningMacro) {
        parkTriggerBehindMacro(job);
        lastTriggerValue.set(key, "true:");
        continue;
      }
      if (!pendingTriggers.reserve(key)) continue;
      lastTriggerValue.set(key, "true:");
      void (async () => {
        try {
          const { memory: liveMemory } = await import("./store.server");
          const live = liveMemory() as SchedMemory;
          const current = live.config.macros.find((item) => item.id === macro?.id);
          if (current || extra) await runQueuedTrigger(job, current);
        } catch (err) {
          pushLog({ kind: "macro", ok: false, title: `Trigger ${job.label}`, detail: err instanceof Error ? err.message : "trigger failed" });
        } finally {
          if (!triggerQueue.some((item) => item.id === job.id && item.path === job.path)) pendingTriggers.release(key);
        }
      })();
    }
  }
}

async function runQueuedTrigger(job: TriggerJob, macro: Macro | undefined) {
  const { memory, pushLog } = await import("./store.server");
  const live = memory() as SchedMemory;
  const rule = (live.config.triggers ?? []).find((item) => item.id === job.id);
  const key = `${job.id}:${job.path}`;
  const extra = Boolean(rule && (job.path === "t" ? triggerHasTrueWork(rule) : triggerHasFalseWork(rule)));
  const trueMacro = rule?.macroId || "";
  const falseMacro = rule?.falseMacroId || "";
  const jobMacro = job.macroId || "";
  const bootNoVar = rule?.mode === "boot" && !rule.variable;
  if (!rule?.enabled || (!bootNoVar && !rule.variable) || (trueMacro !== jobMacro && falseMacro !== jobMacro) || (!extra && !macro)) {
    pendingTriggers.release(key);
    return;
  }
  if (bootNoVar) {
    if (job.path === "f") {
      pendingTriggers.release(key);
      return;
    }
  } else if (rule.variable) {
    const value = (raw: string) => String(resolveTemplate(raw, live.vars, live.config.variables) ?? raw);
    if (!triggerPathHit(rule, live.vars, job.path, value)) {
      lastTriggerValue.set(key, "false:");
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
  const commandCtx = () => ({
    config: live.config,
    drivers: live.drivers,
    state: live.state,
    vars: live.vars,
    health: live.health ?? (live.health = {}),
    host: live.host,
  });
  live.runningMacro = extra ? (macro && triggerHasTrueWork({ macroId: macro.id }) ? macro.id : `trg:${rule.id}`) : macro!.id;
  try {
    const result = extra
      ? await runTriggerTruePlan(job.path === "f" ? falseActionOf(rule) : rule, {
          resolve: (raw) => String(resolveTemplate(raw, live.vars, live.config.variables) ?? raw),
          writeVar: async (id, value) => {
            const written = writeConfiguredVar(live.config.variables, id, value);
            if (!written.ok) return { ok: false, message: written.message, ranMacro: false };
            if (id === "occupancy") {
              const { applyOccupancy } = await import("./peer-payload");
              const applied = applyOccupancy(live.config, live.vars, String(written.value));
              if (!applied.ok) return { ok: false, message: applied.message, ranMacro: false };
            } else {
              live.vars[id] = written.value;
            }
            await persist();
            const def = live.config.variables.find((item) => item.id === id);
            if (def?.pushDevice && def.pushCommand) {
              const pushed = await executeCommand({ ...commandCtx(), deviceId: def.pushDevice, commandId: def.pushCommand, value: live.vars[id] });
              if (!pushed.ok) return { ok: false, message: pushed.message, ranMacro: false };
            }
            return { ok: true, message: String(live.vars[id] ?? written.value), ranMacro: false };
          },
          exec: async (device, command, value) => {
            const ran = await executeCommand({ ...commandCtx(), deviceId: device, commandId: command, value });
            return { ok: ran.ok, message: ran.message, ranMacro: false };
          },
          runMacro: async (macroId) => {
            const current = live.config.macros.find((item) => item.id === macroId);
            if (!current) return { ok: false, message: "Unknown macro", ranMacro: true };
            const ran = await runMacro({ ...commandCtx(), macro: current });
            return { ok: ran.ok, message: ran.message, ranMacro: true };
          },
        })
      : await runMacro({ ...commandCtx(), macro: macro! });
    if (result.ok) {
      lastTriggerValue.set(key, "true:");
      lastTriggerFire.set(key, Date.now());
      if (!extra || ("ranMacro" in result && result.ranMacro)) live.activeScene = job.path === "f" ? (rule.falseMacroId || macro!.id) : (extra ? rule.macroId : macro!.id);
    }
    if (!result.ok && (!extra || ("ranMacro" in result && result.ranMacro)) && live.host) clearHostBlock(live.host);
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
  const nextRule = (live.config.triggers ?? []).find((item) => item.id === next.id);
  const nextExtra = Boolean(nextRule && (next.path === "t" ? triggerHasTrueWork(nextRule) : triggerHasFalseWork(nextRule)));
  if (nested || nextExtra) await runQueuedTrigger(next, nested);
  else pendingTriggers.release(`${next.id}:${next.path}`);
}
