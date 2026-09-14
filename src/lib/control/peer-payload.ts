import type { Occupancy, RoomConfig, RoomVariable } from "./types";

export const OCCUPANCY_VAR_ID = "occupancy";
/** Baked var codes: 0 closed, 1 open, 2 in session, 3 do not disturb. */
export const OCCUPANCY_CODES = ["0", "1", "2", "3"] as const;
/** Foyer GET still uses these strings. `busy` is accepted and stored as in-session. */
export const OCCUPANCY_VALUES: Occupancy[] = ["available", "in-session", "busy", "do-not-disturb", "closed"];

const CODE_TO_OCC: Record<string, Occupancy> = {
  "0": "closed",
  "1": "available",
  "2": "in-session",
  "3": "do-not-disturb",
};

const OCC_TO_CODE: Record<Occupancy, typeof OCCUPANCY_CODES[number]> = {
  closed: "0",
  available: "1",
  "in-session": "2",
  busy: "2",
  "do-not-disturb": "3",
};

const VAR_ALIASES: Record<string, Occupancy> = {
  available: "available",
  open: "available",
  free: "available",
  idle: "available",
  false: "available",
  "in-session": "in-session",
  insession: "in-session",
  occupied: "in-session",
  true: "in-session",
  on: "in-session",
  busy: "in-session",
  closed: "closed",
  off: "closed",
  "do-not-disturb": "do-not-disturb",
  dnd: "do-not-disturb",
};

export function occupancyFromVarValue(raw: string | number | boolean | undefined): Occupancy | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (CODE_TO_OCC[key]) return CODE_TO_OCC[key];
  if (OCCUPANCY_VALUES.includes(key as Occupancy)) return key === "busy" ? "in-session" : key as Occupancy;
  return VAR_ALIASES[key] ?? null;
}

export function occupancyCode(occ: Occupancy): typeof OCCUPANCY_CODES[number] {
  return OCC_TO_CODE[occ] ?? "1";
}

export function occupancyVarSpec(): RoomVariable {
  return {
    id: OCCUPANCY_VAR_ID,
    label: "Occupancy",
    kind: "enum",
    values: [...OCCUPANCY_CODES],
    default: "1",
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
  vars[OCCUPANCY_VAR_ID] = occupancyCode(next);
  return { ok: true, message: occupancyCode(next) };
}

export function buildPeerOccupancyGet(opts: {
  room: RoomConfig["room"];
  host: { locked: boolean };
}) {
  return {
    ok: true as const,
    v: 1 as const,
    occupancy: occupancyOf(opts.room),
    host: { locked: Boolean(opts.host.locked) },
  };
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
