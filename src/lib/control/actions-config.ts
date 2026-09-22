import { createServerFn } from "@tanstack/react-start";
import { traces } from "./engine";
import { validateDriver } from "./schema";
import type { DriverSpec, RoomConfig } from "./types";
import { driverInUse, seedVars } from "./vars";
import { isWeakPin, isHashedPin } from "./pins";
import { applyOccupancy, occupancyOf } from "./peer-payload";
import { loadControl } from "./actions-context";

export const getEditorConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, normalize, validToken, processStatus
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, config: null };
    const config = normalize(memory().config);
    const paired = Object.values(memory().sessions ?? {})
      .filter((row) => row.kind === "panel" && row.secret)
      .map((row) => ({
        id: Object.entries(memory().sessions ?? {}).find(([, item]) => item === row)?.[0] || row.secret!,
        kind: row.kind,
        label: row.label || row.kind,
        created: row.created ?? 0,
        lastSeen: row.lastSeen ?? 0,
      }));
    const storedPin = config.room.configPin;
    // Never call isWeakPin on a scrypt hash — it is always "strong" by shape.
    // Durable mustChange comes from pinChangeRequired (set at unlock on weak plaintext).
    const mustChange = memory().pinChangeRequired === true
      || (!isHashedPin(storedPin) && isWeakPin(storedPin));
    return { ok: true as const, config, traces: traces(), mustChange, paired, process: processStatus(), log: memory().log ?? [] };
  });

export const saveConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin?: string; config: RoomConfig }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persistNow, hashPin, verifyStoredPin,
    validToken, randomHex
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (data.pin && !verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    const incomingPin = data.config.room.configPin?.trim();
    const nextPin = incomingPin || memory().config.room.configPin;
    if (!isHashedPin(nextPin) && isWeakPin(nextPin)) return { ok: false, message: "Choose a PIN that is not 1234, 0000, or a repeat/sequence" };
    const pin = isHashedPin(nextPin) ? nextPin : hashPin(nextPin);
    if (incomingPin && !isHashedPin(incomingPin) && !isWeakPin(incomingPin)) {
      memory().pinChangeRequired = false;
    }
    const incomingPanel = data.config.room.panelAccess === "pin" ? data.config.room.panelPin?.trim() : null;
    let panelPin = data.config.room.panelAccess === "pin"
      ? (!incomingPanel || isHashedPin(incomingPanel) ? (incomingPanel || memory().config.room.panelPin) : hashPin(incomingPanel))
      : null;
    if (data.config.room.panelAccess === "pin" && incomingPanel && !isHashedPin(incomingPanel) && isWeakPin(incomingPanel)) {
      if (isWeakPin(incomingPanel) && incomingPin && !isWeakPin(incomingPin) && !isHashedPin(incomingPin)) {
        panelPin = hashPin(incomingPin);
      } else {
        return { ok: false, message: "Panel PIN is too weak" };
      }
    }
    const peerSecret = data.config.room.peerSecret?.trim() || memory().config.room.peerSecret || randomHex(24);
    const config: RoomConfig = {
      ...data.config,
      room: { ...data.config.room, configPin: pin, panelPin, peerSecret },
      variables: data.config.variables ?? [],
      schedules: data.config.schedules ?? [],
      monitors: data.config.monitors ?? [],
      triggers: data.config.triggers ?? [],
      interfaces: data.config.interfaces ?? [],
    };
    const prevDevices = memory().config.devices;
    const devices = (config.devices ?? []).map((device) => {
      const prev = prevDevices.find((item) => item.id === device.id);
      const auth = { ...(prev?.auth ?? {}), ...(device.auth ?? {}) };
      for (const [key, value] of Object.entries(auth)) {
        if (!String(value ?? "").trim() && prev?.auth?.[key]) auth[key] = prev.auth[key]!;
      }
      return { ...device, auth };
    });
    const liveOccupancy = occupancyOf(memory().config.room);
    const nextConfig: RoomConfig = { ...config, devices };
    memory().config = nextConfig;
    const vars = seedVars(nextConfig, memory().vars);
    applyOccupancy(nextConfig, vars, liveOccupancy);
    memory().vars = vars;
    try {
      await persistNow();
    } catch {
      return { ok: false, message: "Save failed on disk" };
    }
    return { ok: true, message: "Saved" };
  });

export const saveDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string; spec: DriverSpec }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, writeDriverFile, safeDriverName,
    validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const name = safeDriverName(data.filename);
    const problem = validateDriver(data.spec);
    if (problem) return { ok: false, message: problem };
    memory().drivers[name] = data.spec;
    await writeDriverFile(name, data.spec);
    await persist();
    return { ok: true, message: name };
  });

export const addDriverFromLibrary = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, writeDriverFile, readLibrarySpec,
    safeDriverName, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const name = safeDriverName(data.filename);
    if (name === "index.json") return { ok: false, message: "Not in library" };
    const spec = await readLibrarySpec(name);
    if (!spec) return { ok: false, message: "Not in library" };
    mem.drivers[name] = spec;
    await writeDriverFile(name, spec);
    await persist();
    return { ok: true, message: name };
  });

export const deleteDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string; reassignTo?: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, removeDriverFile, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const used = driverInUse(mem.config, data.filename);
    if (used.length) return { ok: false, message: `In use by ${used.join(", ")}. Reassign those devices first.` };
    delete mem.drivers[data.filename];
    await removeDriverFile(data.filename);
    await persist();
    return { ok: true, message: "Removed from room" };
  });

export const clearConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persistNow, writeDriverFile, readLibrarySpec,
    pruneRoomDrivers, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    const { emptyRoomConfig, defaultDeviceState, hostDriverSeed, HOST_DRIVER } = await import("./defaults");
    const pin = memory().config.room.configPin;
    memory().config = emptyRoomConfig(pin);
    const spec = (await readLibrarySpec(HOST_DRIVER)) ?? hostDriverSeed()[HOST_DRIVER]!;
    memory().drivers = { [HOST_DRIVER]: spec };
    await writeDriverFile(HOST_DRIVER, spec);
    await pruneRoomDrivers([HOST_DRIVER]);
    memory().state = defaultDeviceState();
    memory().vars = seedVars(memory().config);
    memory().health = {};
    memory().lastError = null;
    memory().runningMacro = null;
    memory().activeScene = null;
    await persistNow();
    return { ok: true, message: "Room wiped" };
  });

export const importBundle = createServerFn({ method: "POST" })
  .validator((data: { token: string; bundle: { config?: RoomConfig; drivers?: Record<string, DriverSpec> } }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persistNow, normalize, writeDriverFile,
    safeDriverName, validToken, randomHex
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const incoming = data.bundle.config ?? (data.bundle as unknown as RoomConfig);
    if (!incoming?.room || !Array.isArray(incoming.pages) || !Array.isArray(incoming.devices)) {
      return { ok: false, message: "Not a Relay room file" };
    }
    const current = memory().config;
    const pin = incoming.room.configPin?.trim() || current.room.configPin;
    const panelPin = incoming.room.panelAccess === "pin"
      ? (incoming.room.panelPin?.trim() || current.room.panelPin)
      : null;
    // Mirror saveConfig: blank/missing peerSecret (e.g. publicConfig export) keeps the live secret.
    const peerSecret = incoming.room.peerSecret?.trim() || current.room.peerSecret || randomHex(24);
    const devices = (incoming.devices ?? []).map((device) => {
      const prev = current.devices.find((item) => item.id === device.id);
      const auth = { ...(prev?.auth ?? {}), ...(device.auth ?? {}) };
      for (const [key, value] of Object.entries(auth)) {
        if (!String(value ?? "").trim() && prev?.auth?.[key]) auth[key] = prev.auth[key]!;
      }
      return { ...device, auth };
    });
    const config = normalize({
      ...incoming,
      room: { ...incoming.room, configPin: pin, panelPin, peerSecret },
      devices,
      variables: incoming.variables ?? [],
      schedules: incoming.schedules ?? [],
      monitors: incoming.monitors ?? [],
      triggers: incoming.triggers ?? [],
      interfaces: incoming.interfaces ?? [],
    });
    if (data.bundle.drivers) {
      for (const [name, spec] of Object.entries(data.bundle.drivers)) {
        const file = safeDriverName(name);
        const problem = validateDriver(spec);
        if (problem) continue;
        memory().drivers[file] = spec;
        await writeDriverFile(file, spec);
      }
    }
    memory().config = config;
    memory().vars = seedVars(config, memory().vars);
    await persistNow();
    return { ok: true, message: "Imported. Fill any blank device tokens." };
  });
