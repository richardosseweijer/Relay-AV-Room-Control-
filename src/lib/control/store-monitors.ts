/**
 * Monitors leaf extracted from store.server.ts (MR5).
 * Owns applyDueMonitor / runDueMonitors + lastMonitorRun / goodPolls / monitorsBusy
 * and tightly coupled pruneMonitorMaps. Preserves F6 device-pool concurrency
 * (mapPool / MONITOR_DEVICE_CONCURRENCY via monitor-pool).
 * store.server keeps the public façade (re-exports) so callers stay stable.
 *
 * Deferred-imports memory / pushLog from store.server at call time to avoid a
 * module-init cycle. persist comes from store-persist (already cycle-safe).
 */
import { readMonitorValue } from "./engine";
import type { DeviceHealth, DeviceStateMap, DriverSpec, MonitorStatus, RoomConfig } from "./types";
import { clampVar, monitorVarId, type VarMap } from "./vars";
import { MONITOR_DEVICE_CONCURRENCY, groupMonitorRulesByDevice, mapPool } from "./monitor-pool";
import { persist } from "./store-persist";

/** Minimal memory shape needed to poll monitors and write vars/status. */
type MonitorMemory = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  health: DeviceHealth;
  monitorStatus: Record<string, MonitorStatus>;
  host: { dim: boolean; locked: boolean; toast: string | null; block: string | null; pageId: string | null; fullscreenAt?: number };
};

const lastMonitorRun = new Map<string, number>();
const goodPolls = new Map<string, number>();
let monitorsBusy = false;

/** F8: drop process-global monitor map rows for removed monitors / devices. */
export function pruneMonitorMaps(config: RoomConfig) {
  const monitorIds = new Set((config.monitors ?? []).map((m) => m.id));
  for (const id of [...lastMonitorRun.keys()]) {
    if (!monitorIds.has(id)) lastMonitorRun.delete(id);
  }
  const deviceSet = new Set((config.devices ?? []).map((d) => d.id).filter(Boolean));
  for (const id of [...goodPolls.keys()]) {
    if (!deviceSet.has(id)) goodPolls.delete(id);
  }
}

/** Apply one due monitor rule; returns whether vars were dirtied. Same-device callers stay serial via F6 pool. */
export async function applyDueMonitor(mem: MonitorMemory, rule: NonNullable<RoomConfig["monitors"]>[number], now: number): Promise<boolean> {
  const { pushLog } = await import("./store.server");
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

export async function runDueMonitors() {
  if (monitorsBusy) return;
  monitorsBusy = true;
  try {
    const { memory } = await import("./store.server");
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
