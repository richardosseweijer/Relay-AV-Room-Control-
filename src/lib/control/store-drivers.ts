/**
 * Room driver / library disk I/O leaf extracted from store.server.ts.
 * store.server keeps the public façade (re-exports) so callers stay stable.
 */
import { hostDriverSeed, HOST_DRIVER } from "./defaults";
import type { DriverIndex, DriverSpec } from "./types";
import { indexDriver } from "./types";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export const DRIVER_DIR = path.join(process.cwd(), "data", "drivers");
export const LIBRARY_DIR = path.join(process.cwd(), "data", "library");

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
}

export async function readLibrarySpec(name: string): Promise<DriverSpec | null> {
  const file = safeDriverName(name);
  if (file === "index.json") return null;
  try {
    return JSON.parse(await readFile(path.join(LIBRARY_DIR, file), "utf8")) as DriverSpec;
  } catch {
    return null;
  }
}

export async function loadLibraryIndex(): Promise<Record<string, DriverIndex>> {
  try {
    const raw = JSON.parse(await readFile(path.join(LIBRARY_DIR, "index.json"), "utf8")) as Record<string, DriverIndex>;
    if (raw && typeof raw === "object") return raw;
  } catch {
    /* rebuild from specs */
  }
  const out: Record<string, DriverIndex> = {};
  try {
    await mkdir(LIBRARY_DIR, { recursive: true });
    for (const name of await readdir(LIBRARY_DIR)) {
      if (!name.endsWith(".json") || name === "index.json") continue;
      const spec = await readLibrarySpec(name);
      if (spec) out[name] = indexDriver(name, spec);
    }
  } catch {
    /* empty library */
  }
  return out;
}

/** Room-copy driver JSON on disk (used by loadPersisted working-set). */
export async function readRoomSpec(name: string): Promise<DriverSpec | null> {
  const file = safeDriverName(name);
  try {
    return JSON.parse(await readFile(path.join(DRIVER_DIR, file), "utf8")) as DriverSpec;
  } catch {
    return null;
  }
}

export async function loadDriverFiles(): Promise<Record<string, DriverSpec>> {
  const seed = hostDriverSeed();
  try {
    await mkdir(DRIVER_DIR, { recursive: true });
  } catch {
    return seed;
  }
  try {
    const existing = await readdir(DRIVER_DIR).catch(() => [] as string[]);
    if (!existing.some((n) => n.endsWith(".json"))) {
      const spec = (await readLibrarySpec(HOST_DRIVER)) ?? seed[HOST_DRIVER];
      if (spec) {
        await writeFile(path.join(DRIVER_DIR, HOST_DRIVER), JSON.stringify(spec, null, 2)).catch(() => undefined);
      }
    }
    const out: Record<string, DriverSpec> = {};
    for (const name of await readdir(DRIVER_DIR).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      const spec = await readRoomSpec(name);
      if (spec) out[name] = spec;
    }
    return Object.keys(out).length ? out : seed;
  } catch {
    return seed;
  }
}

export async function pruneRoomDrivers(keep: Iterable<string>) {
  const names = new Set([...keep].map(safeDriverName));
  names.add(HOST_DRIVER);
  for (const name of await readdir(DRIVER_DIR).catch(() => [] as string[])) {
    if (!name.endsWith(".json") || names.has(name)) continue;
    await unlink(path.join(DRIVER_DIR, name)).catch(() => undefined);
  }
}
