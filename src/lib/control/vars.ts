import type { RoomConfig, RoomVariable } from "./types";

export type VarMap = Record<string, string | number>;

export function seedVars(config: RoomConfig, current?: VarMap): VarMap {
  const next: VarMap = { ...(current ?? {}) };
  for (const v of config.variables ?? []) {
    if (next[v.id] === undefined) next[v.id] = v.default;
  }
  return next;
}

export function resolveTemplate(raw: string | number | undefined, vars: VarMap, variables: RoomVariable[] = []): string | number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") return raw;
  const replaced = raw.replace(/\{([^}]+)\}/g, (_, token: string) => {
    const key = token.trim();
    if (vars[key] !== undefined) return String(vars[key]);
    const hit = variables.find((v) =>
      v.id === key ||
      v.label === key ||
      v.id.replace(/[_\s]/g, "").toLowerCase() === key.replace(/[_\s]/g, "").toLowerCase() ||
      v.label.replace(/[_\s]/g, "").toLowerCase() === key.replace(/[_\s]/g, "").toLowerCase()
    );
    if (hit && vars[hit.id] !== undefined) return String(vars[hit.id]);
    if (hit) return String(hit.default);
    return `{${token}}`;
  });
  if (replaced !== raw && replaced !== "" && !Number.isNaN(Number(replaced))) return Number(replaced);
  return replaced;
}

export function resolveBoundNumber(raw: number | string | undefined, vars: VarMap, fallback: number, variables: RoomVariable[] = []): number {
  if (raw === undefined || raw === "") return fallback;
  const resolved = resolveTemplate(raw, vars, variables);
  const n = Number(resolved);
  return Number.isFinite(n) ? n : fallback;
}

export function clampVar(def: RoomVariable, value: string | number): string | number {
  if (def.kind === "text") return String(value);
  if (def.kind === "enum") {
    const text = String(value);
    return def.values?.includes(text) ? text : def.default;
  }
  let n = Number(value);
  if (!Number.isFinite(n)) n = Number(def.default) || 0;
  if (def.min !== undefined) n = Math.max(def.min, n);
  if (def.max !== undefined) n = Math.min(def.max, n);
  return n;
}

export function applyMonitors(
  config: RoomConfig,
  state: Record<string, Record<string, string | number | boolean>>,
  vars: VarMap,
) {
  for (const rule of config.monitors ?? []) {
    if (!rule.enabled || !rule.writeVar) continue;
    const raw = state[rule.device]?.[rule.feedback];
    if (raw === undefined || raw === null) continue;
    let value = String(raw);
    if (rule.mapMode === "map") {
      const hit = (rule.map ?? []).find((row) => row.from === value);
      if (hit) value = hit.to;
    }
    const def = config.variables.find((v) => v.id === rule.writeVar);
    vars[rule.writeVar] = def ? clampVar(def, value) : value;
  }
  return vars;
}

export function deviceInUse(config: RoomConfig, deviceId: string) {
  const widgets = config.pages.flatMap((p) => p.widgets.filter((w) => w.bind.device === deviceId).map((w) => w.label));
  const macros = config.macros.filter((m) => m.steps.some((s) => s.device === deviceId)).map((m) => m.label);
  const monitors = (config.monitors ?? []).filter((m) => m.device === deviceId).map((m) => m.label);
  return [...widgets, ...macros, ...monitors];
}

export function driverInUse(config: RoomConfig, filename: string) {
  return config.devices.filter((d) => d.driver === filename).map((d) => d.name);
}

export function variableInUse(config: RoomConfig, id: string) {
  const token = `{${id}}`;
  const hits: string[] = [];
  for (const m of config.macros) {
    if (m.steps.some((s) => s.setVar === id || String(s.value ?? "").includes(token))) hits.push(m.label);
  }
  for (const p of config.pages) {
    for (const w of p.widgets) {
      if (w.bind.variable === id || String(w.min ?? "").includes(token) || String(w.max ?? "").includes(token)) hits.push(w.label);
    }
  }
  for (const mon of config.monitors ?? []) {
    if (mon.writeVar === id) hits.push(mon.label);
  }
  return hits;
}
