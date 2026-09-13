import type { Occupancy, RoomConfig, RoomVariable } from "./types";

export const OCCUPANCY_VALUES: Occupancy[] = ["available", "in-session", "busy", "do-not-disturb", "closed"];

const VAR_ALIASES: Record<string, Occupancy> = {
  available: "available",
  free: "available",
  idle: "available",
  "0": "available",
  false: "available",
  "in-session": "in-session",
  insession: "in-session",
  occupied: "in-session",
  "1": "in-session",
  true: "in-session",
  on: "in-session",
  busy: "busy",
  closed: "closed",
  off: "closed",
};

export function occupancyFromVarValue(raw: string | number | boolean | undefined): Occupancy | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return VAR_ALIASES[key] ?? null;
}

export function occupancyOf(room: RoomConfig["room"], variables: RoomVariable[], vars: Record<string, string | number | boolean>): Occupancy {
  const field = room.occupancy;
  if (field && OCCUPANCY_VALUES.includes(field)) return field;
  const named = room.occupancyVarId
    ? variables.find((item) => item.id === room.occupancyVarId)
    : variables.find((item) => item.id === "occupancy" || item.label.toLowerCase() === "occupancy");
  if (named) {
    const mapped = occupancyFromVarValue(vars[named.id] ?? named.default);
    if (mapped) return mapped;
  }
  return "available";
}

export function applyOccupancy(
  config: RoomConfig,
  vars: Record<string, string | number>,
  value: string,
): { ok: boolean; message: string } {
  if (!OCCUPANCY_VALUES.includes(value as Occupancy)) return { ok: false, message: "Bad occupancy" };
  const next = value as Occupancy;
  config.room.occupancy = next;
  const varId = config.room.occupancyVarId
    || config.variables.find((item) => item.id === "occupancy" || item.label.toLowerCase() === "occupancy")?.id;
  if (varId && next !== "do-not-disturb") vars[varId] = next;
  return { ok: true, message: next };
}

export function buildPeerGet(opts: {
  room: RoomConfig["room"];
  host: { dim: boolean; locked: boolean; pageId: string | null };
  variables: RoomVariable[];
  vars: Record<string, string | number | boolean>;
  macros: { id: string; label: string }[];
}) {
  const vars: Record<string, { name: string; value: string | number }> = {};
  for (const item of opts.variables) {
    const raw = opts.vars[item.id] ?? item.default;
    vars[item.id] = { name: item.label, value: typeof raw === "boolean" ? String(raw) : raw };
  }
  const macros: Record<string, { name: string }> = {};
  for (const item of opts.macros) macros[item.id] = { name: item.label };
  return {
    ok: true as const,
    v: 1 as const,
    room: { id: opts.room.id, name: opts.room.name },
    host: { dim: opts.host.dim, locked: opts.host.locked, pageId: opts.host.pageId },
    occupancy: occupancyOf(opts.room, opts.variables, opts.vars),
    vars,
    macros,
  };
}
