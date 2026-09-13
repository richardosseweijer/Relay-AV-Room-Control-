import type { Occupancy, RoomConfig, RoomVariable } from "./types";

export const OCCUPANCY_VAR_ID = "occupancy";
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
  "do-not-disturb": "do-not-disturb",
  dnd: "do-not-disturb",
};

export function occupancyFromVarValue(raw: string | number | boolean | undefined): Occupancy | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (OCCUPANCY_VALUES.includes(key as Occupancy)) return key as Occupancy;
  return VAR_ALIASES[key] ?? null;
}

export function occupancyVarSpec(): RoomVariable {
  return {
    id: OCCUPANCY_VAR_ID,
    label: "Occupancy",
    kind: "enum",
    values: [...OCCUPANCY_VALUES],
    default: "available",
  };
}

export function withOccupancyVar(config: RoomConfig): RoomConfig {
  const baked = occupancyVarSpec();
  const list = [...(config.variables ?? [])];
  const i = list.findIndex((item) => item.id === OCCUPANCY_VAR_ID);
  if (i < 0) list.unshift({ ...baked, tag: null });
  else {
    const cur = list[i]!;
    list[i] = { ...cur, ...baked, tag: cur.tag ?? null };
  }
  const occupancy = occupancyOf(config.room);
  return { ...config, room: { ...config.room, occupancy }, variables: list };
}

export function occupancyOf(room: RoomConfig["room"]): Occupancy {
  return occupancyFromVarValue(room.occupancy) ?? "available";
}

export function applyOccupancy(
  config: RoomConfig,
  vars: Record<string, string | number>,
  value: string,
): { ok: boolean; message: string } {
  const next = occupancyFromVarValue(value);
  if (!next) return { ok: false, message: "Bad occupancy" };
  config.room.occupancy = next;
  vars[OCCUPANCY_VAR_ID] = next;
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
    occupancy: occupancyOf(opts.room),
    vars,
    macros,
  };
}
