import type { RoomConfig, RoomVariable } from "./types";

export type VarMap = Record<string, string | number>;

/** Built-in read-only clock for `{time}` labels — OS local TZ, not room.network.timezone. */
export const SYSTEM_TIME_VAR_ID = "time";

export function systemTimeVarSpec(): RoomVariable {
  return { id: SYSTEM_TIME_VAR_ID, label: "Time", kind: "text", default: "" };
}

export function withSystemTimeVar(config: RoomConfig): RoomConfig {
  const baked = systemTimeVarSpec();
  const list = [...(config.variables ?? [])];
  const i = list.findIndex((item) => item.id === SYSTEM_TIME_VAR_ID);
  if (i < 0) list.unshift({ ...baked, tag: null });
  else {
    const cur = list[i]!;
    list[i] = { ...cur, ...baked, tag: cur.tag ?? null };
  }
  return { ...config, variables: list };
}

/** HH:mm from the machine clock in the OS local timezone (Intl default). */
export function formatSystemTime(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const minute = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

function isSystemTimeToken(key: string, variables: RoomVariable[]): boolean {
  const norm = key.replace(/[_\s]/g, "").toLowerCase();
  if (norm === SYSTEM_TIME_VAR_ID) return true;
  const hit = variables.find((v) => v.id === SYSTEM_TIME_VAR_ID);
  if (!hit) return false;
  return (
    hit.label === key ||
    hit.label.replace(/[_\s]/g, "").toLowerCase() === norm
  );
}


export function monitorVarId(rule: { id: string; label?: string }) {
  const words = String(rule.label || "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  let slug = words
    .map((word, i) => (i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("")
    .replace(/[^A-Za-z0-9]/g, "");
  if (!slug) slug = String(rule.id || "monitor").replace(/[^A-Za-z0-9]/g, "") || "monitor";
  if (/^[0-9]/.test(slug)) slug = `m${slug}`;
  return `MON_${slug}`;
}

export function withMonitorVars(config: RoomConfig): RoomConfig {
  const autos = (config.monitors ?? []).map((rule) => {
    const id = monitorVarId(rule);
    return { id, label: id, kind: "text" as const, default: "" };
  });
  const keep = (config.variables ?? []).filter((row) => !row.id.startsWith("MON_") || autos.some((item) => item.id === row.id));
  const extra = autos.filter((row) => !keep.some((item) => item.id === row.id));
  return { ...config, variables: [...keep, ...extra] };
}

export function seedVars(config: RoomConfig, current?: VarMap): VarMap {
  const next: VarMap = { ...(current ?? {}) };
  delete next[SYSTEM_TIME_VAR_ID];
  for (const v of config.variables ?? []) {
    if (v.id === SYSTEM_TIME_VAR_ID) continue;
    if (next[v.id] === undefined) next[v.id] = v.default;
  }
  return next;
}

export function resolveTemplate(raw: string | number | undefined, vars: VarMap, variables: RoomVariable[] = []): string | number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") return raw;
  const replaced = raw.replace(/\{([^}]+)\}/g, (_, token: string) => {
    const key = token.trim();
    // Built-in `{time}`: always compute from OS clock (ignore stored/stale vars).
    if (isSystemTimeToken(key, variables)) return formatSystemTime();
    if (vars[key] !== undefined) return String(vars[key]);
    const hit = variables.find((v) =>
      v.id === key ||
      v.label === key ||
      v.id.replace(/[_\s]/g, "").toLowerCase() === key.replace(/[_\s]/g, "").toLowerCase() ||
      v.label.replace(/[_\s]/g, "").toLowerCase() === key.replace(/[_\s]/g, "").toLowerCase()
    );
    if (hit && vars[hit.id] !== undefined) return String(vars[hit.id]);
    if (hit) return String(hit.default);
    // Unresolved tokens omit (empty) — panel labels must not show "{name}".
    return "";
  });
  if (replaced !== raw && replaced !== "" && !Number.isNaN(Number(replaced))) return Number(replaced);
  return replaced;
}


/** Panel widget face labels: expand `{var}` via resolveTemplate; always a string. */
export function resolveWidgetLabel(raw: string | undefined, vars: VarMap, variables: RoomVariable[] = []): string {
  return String(resolveTemplate(raw ?? "", vars, variables) ?? "");
}

/** Expand typed `\n` (backslash-n) to real newlines. Real newlines preserved; other escapes untouched. */
export function expandLabelNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

/** Panel face display: `{var}` resolve first, then `\n` → newline. */
export function formatWidgetLabel(raw: string | undefined, vars: VarMap, variables: RoomVariable[] = []): string {
  return expandLabelNewlines(resolveWidgetLabel(raw, vars, variables));
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


/** Peer/API var write: fail-closed to configured ids, then clampVar bounds/enum. */
export function writeConfiguredVar(
  variables: RoomVariable[],
  id: string,
  value: string | number | undefined,
): { ok: true; value: string | number } | { ok: false; message: string } {
  if (id === SYSTEM_TIME_VAR_ID) return { ok: false, message: "Read-only variable" };
  const def = variables.find((v) => v.id === id);
  if (!def) return { ok: false, message: "Unknown variable" };
  return { ok: true, value: clampVar(def, value ?? "") };
}


export function applyMonitors(
  config: RoomConfig,
  state: Record<string, Record<string, string | number | boolean>>,
  vars: VarMap,
) {
  for (const rule of config.monitors ?? []) {
    if (!rule.enabled || !rule.writeVar) continue;
    const raw = rule.interfaceId
      ? state[`iface:${rule.interfaceId}`]?.raw
      : state[rule.device]?.[rule.feedback];
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
