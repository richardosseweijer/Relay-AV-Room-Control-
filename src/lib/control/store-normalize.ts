/**
 * Normalize + F1/F7 memo leaf extracted from store.server.ts.
 * Owns normalize, memo generation, installRoomConfig, invalidateNormalizedConfig,
 * normalizedConfig, and tightly coupled helpers (liftTag / rememberNormalized).
 * store.server keeps the public façade (re-exports) so callers stay stable.
 *
 * installRoomConfig needs live memory + pruneRuntimeMaps (scheduler/monitor Maps
 * stay on store.server — this leaf is normalize-only). store.server calls
 * bindNormalizeInstallDeps once at module load (sync; no module-init cycle).
 */
import { emptyRoomConfig } from "./defaults";
import type { RoomConfig } from "./types";
import { NONE_MACRO_ID, noneMacro } from "./types";
import { withMonitorVars } from "./vars";
import { withOccupancyVar } from "./peer-payload";
import { withFoyerSessionVars } from "./foyer-peer";
import { resolveRoomTheme } from "@/lib/theme";
import { coerceLegacyWidgetType, normalizeStatusFields } from "./status-widget";
import { normalizeImageFields } from "./image-widget";
import { normalizeTextSizeFields } from "./text-size-widget";
import { normalizeHideWhenDisabledFields } from "./panel-widget";

function liftTag<T extends { tag?: string | null }>(item: T): T {
  const legacy = (item as T & { folder?: string | null }).folder;
  return { ...item, tag: item.tag || legacy || null };
}

export function normalize(config?: RoomConfig | null): RoomConfig {
  const demo = emptyRoomConfig();
  if (!config) return demo;
  return withFoyerSessionVars(withOccupancyVar(withMonitorVars({
    ...demo,
    ...config,
    room: {
      ...demo.room,
      ...(config.room ?? {}),
      network: { ...demo.room.network, ...(config.room?.network ?? {}) },
      grid: { ...demo.room.grid, ...(config.room?.grid ?? {}) },
      externalControl: config.room?.externalControl === true,
      panelAcceptsConfigPin: config.room?.panelAcceptsConfigPin === true,
      theme: resolveRoomTheme(config.room?.theme),
    },
    variables: (config.variables ?? demo.variables).map(liftTag),
    schedules: (config.schedules ?? demo.schedules).map(liftTag),
    monitors: (config.monitors ?? demo.monitors).map(liftTag),
    triggers: (config.triggers ?? []).map((rule) => {
      const holdSec = rule.holdSec ?? Math.round((rule.holdMs || 0) / 1000);
      const delaySec = rule.delaySec ?? Math.round((rule.delayMs || 0) / 1000);
      const intervalSec = rule.intervalSec ?? Math.max(1, Math.round((rule.intervalMs || 5000) / 1000));
      const clip = (rows: typeof rule.whenTrue) => (rows ?? []).slice(0, 8).map((row) => ({
        variable: row.variable || "",
        compare: row.compare || "eq",
        equals: row.equals ?? "",
      }));
      return liftTag({
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
      });
    }),
    interfaces: config.interfaces ?? [],
    tags: config.tags ?? (config as { folders?: RoomConfig["tags"] }).folders ?? {},
    macros: [noneMacro(), ...(config.macros ?? demo.macros).filter((m) => m.id !== NONE_MACRO_ID)].map(liftTag),
    pages: (config.pages ?? demo.pages).map((page) => ({
      ...page,
      widgets: (page.widgets ?? []).map((widget) => normalizeHideWhenDisabledFields(normalizeTextSizeFields(normalizeImageFields(normalizeStatusFields(coerceLegacyWidgetType(widget)))))),
    })),
  })));
}

/** Bumped when room config is replaced; in-place field tweaks on the live object keep the memo. */
let configNormGeneration = 0;
let memoNormGeneration = -1;
let memoNormalized: RoomConfig | null = null;

/** Invalidate memo so the next normalizedConfig()/install rebuilds (F1+F7). */
export function invalidateNormalizedConfig() {
  configNormGeneration += 1;
  memoNormalized = null;
  memoNormGeneration = -1;
}

export function rememberNormalized(config: RoomConfig) {
  memoNormalized = config;
  memoNormGeneration = configNormGeneration;
}

/**
 * F1+F7: return normalize(config), memoized until generation changes or config identity differs.
 * Snapshot polls and persist reuse the same object when mem.config is already the memo.
 */
export function normalizedConfig(config: RoomConfig): RoomConfig {
  if (memoNormalized && memoNormGeneration === configNormGeneration && config === memoNormalized) {
    return memoNormalized;
  }
  const next = normalize(config);
  rememberNormalized(next);
  return next;
}

/** Live store hooks for installRoomConfig (set by store.server at module load). */
type NormalizeInstallDeps = {
  memory: () => { config: RoomConfig };
  pruneRuntimeMaps: (config: RoomConfig) => void;
};

let installDeps: NormalizeInstallDeps | null = null;

/** Wire memory + pruneRuntimeMaps without a module-init cycle (scheduler/monitor Maps stay on store.server). */
export function bindNormalizeInstallDeps(deps: NormalizeInstallDeps) {
  installDeps = deps;
}

/**
 * Replace live room config: bump generation, normalize once (unless alreadyNormalized), seed memo.
 * Use on load / save / import / clear — not for in-place PIN/occupancy tweaks.
 */
export function installRoomConfig(config: RoomConfig, opts?: { alreadyNormalized?: boolean }) {
  if (!installDeps) throw new Error("installRoomConfig: normalize install deps not bound");
  configNormGeneration += 1;
  const next = opts?.alreadyNormalized ? config : normalize(config);
  installDeps.memory().config = next;
  rememberNormalized(next);
  installDeps.pruneRuntimeMaps(next);
  return next;
}
