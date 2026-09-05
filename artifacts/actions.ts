import { createServerFn } from "@tanstack/react-start";
import { authenticateDevice, executeCommand, pingReachable, probeDevice, runMacro } from "./engine";
import { bundledDrivers } from "./defaults";
import { ensureLoaded, memory, persist, snapshot } from "./store.server";
import type { DriverSpec, RoomConfig } from "./types";
import { clampVar, driverInUse, seedVars } from "./vars";

const g = globalThis as typeof globalThis & {
  __relayTokens__?: Map<string, { kind: "config" | "panel"; exp: number }>;
};

function tokenStore() {
  if (!g.__relayTokens__) g.__relayTokens__ = new Map();
  return g.__relayTokens__;
}

function mint(kind: "config" | "panel") {
  const token = `${kind}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  tokenStore().set(token, { kind, exp: Date.now() + 1000 * 60 * 60 * 8 });
  return token;
}

function validToken(token: string | undefined, kind: "config" | "panel") {
  if (!token) return false;
  const row = tokenStore().get(token);
  if (!row || row.kind !== kind) return false;
  if (row.exp < Date.now()) {
    tokenStore().delete(token);
    return false;
  }
  return true;
}

export const getSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await ensureLoaded();
  const snap = snapshot();
  return {
    ...snap,
    config: {
      ...snap.config,
      room: { ...snap.config.room, configPin: "", panelPin: snap.config.room.panelAccess === "pin" ? "" : null },
    },
  };
});

export const getRoomState = createServerFn({ method: "POST" }).handler(async () => {
  await ensureLoaded();
  const snap = snapshot();
  return {
    ...snap,
    config: {
      ...snap.config,
      room: { ...snap.config.room, configPin: "", panelPin: snap.config.room.panelAccess === "pin" ? "" : null },
    },
  };
});

export const getEditorConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, config: null };
    return { ok: true as const, config: memory().config };
  });

export const verifyConfigPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const ok = data.pin === memory().config.room.configPin;
    return ok ? { ok: true, token: mint("config") } : { ok: false, token: null };
  });

export const verifyPanelPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const cfg = memory().config;
    if (cfg.room.panelAccess !== "pin") return { ok: true, token: mint("panel") };
    const ok = data.pin === (cfg.room.panelPin ?? "");
    return ok ? { ok: true, token: mint("panel") } : { ok: false, token: null };
  });

export const saveConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin?: string; config: RoomConfig }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (data.pin && data.pin !== memory().config.room.configPin) return { ok: false, message: "PIN did not match" };
    const pin = data.config.room.configPin?.trim() || memory().config.room.configPin;
    const config: RoomConfig = {
      ...data.config,
      room: { ...data.config.room, configPin: pin },
      variables: data.config.variables ?? [],
      schedules: data.config.schedules ?? [],
      monitors: data.config.monitors ?? [],
    };
    memory().config = config;
    memory().vars = seedVars(config, memory().vars);
    persist().catch(() => undefined);
    return { ok: true, message: "Saved" };
  });

export const saveDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string; spec: DriverSpec }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const name = data.filename.endsWith(".json") ? data.filename : `${data.filename}.json`;
    memory().drivers[name] = data.spec;
    await persist();
    return { ok: true, message: name };
  });

export const resetDemo = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const { defaultRoomConfig, defaultDeviceState } = await import("./defaults");
    memory().config = defaultRoomConfig();
    memory().drivers = { ...bundledDrivers };
    memory().state = defaultDeviceState();
    memory().vars = seedVars(memory().config);
    memory().lastError = null;
    memory().runningMacro = null;
    memory().activeScene = null;
    await persist();
    return { ok: true, message: "Demo room restored" };
  });

export const fireCommand = createServerFn({ method: "POST" })
  .validator((data: { deviceId: string; commandId: string; value?: string | number; variable?: string | null }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const mem = memory();
    mem.health = mem.health ?? {};
    const result = await executeCommand({
      config: mem.config,
      drivers: mem.drivers,
      state: mem.state,
      vars: mem.vars,
      health: mem.health,
      deviceId: data.deviceId,
      commandId: data.commandId,
      value: data.value,
    });
    mem.health[data.deviceId] = { ok: result.ok, message: result.message };
    if (result.ok && data.variable) {
      const def = mem.config.variables.find((v) => v.id === data.variable);
      mem.vars[data.variable] = def ? clampVar(def, data.value ?? def.default) : (data.value ?? "");
    }
    mem.lastError = result.ok ? null : result.message;
    await persist();
    return result;
  });

export const fireMacro = createServerFn({ method: "POST" })
  .validator((data: { macroId: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const mem = memory();
    const macro = mem.config.macros.find((m) => m.id === data.macroId);
    if (!macro) return { ok: false, message: "Unknown macro" };
    mem.runningMacro = macro.id;
    const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro });
    mem.runningMacro = null;
    if (result.ok) mem.activeScene = macro.id;
    mem.lastError = result.ok ? null : result.message;
    await persist();
    return result;
  });

export const deleteDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const used = driverInUse(memory().config, data.filename);
    if (used.length) return { ok: false, message: `In use by ${used.join(", ")}` };
    delete memory().drivers[data.filename];
    await persist();
    return { ok: true, message: "Driver removed" };
  });

export const testDevice = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; host?: string; port?: number; simulate?: boolean; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    if (!mem.health) mem.health = {};
    const existing = mem.config.devices.find((d) => d.id === data.deviceId);
    const device = existing
      ? { ...existing, host: data.host ?? existing.host, port: data.port ?? existing.port, simulate: data.simulate ?? existing.simulate, driver: data.driver ?? existing.driver, auth: data.auth ?? existing.auth }
      : {
          id: data.deviceId,
          name: data.deviceId,
          driver: data.driver ?? Object.keys(mem.drivers)[0] ?? "lg-oled55c3.json",
          transport: "lan" as const,
          host: data.host ?? "",
          auth: data.auth ?? {},
          enabledFeatures: [],
          simulate: data.simulate ?? false,
        };
    const result = await probeDevice({
      config: { ...mem.config, devices: [device] },
      drivers: mem.drivers,
      deviceId: data.deviceId,
      host: device.host,
      simulate: device.simulate,
    });
    if (result.pairedToken || result.pairedPort) {
      const row = mem.config.devices.find((d) => d.id === data.deviceId);
      if (row) {
        if (result.pairedToken) row.auth = { ...row.auth, token: result.pairedToken };
        if (result.pairedPort) row.port = result.pairedPort;
        await persist();
      }
    }
    if (result.ok) mem.health[data.deviceId] = { ok: true, message: result.message };
    else mem.health[data.deviceId] = { ok: false, message: result.message };
    return result;
  });

export const authenticate = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; host?: string; port?: number; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    mem.health = mem.health ?? {};
    const existing = mem.config.devices.find((d) => d.id === data.deviceId);
    const device = existing
      ? { ...existing, host: data.host ?? existing.host, port: data.port ?? existing.port, driver: data.driver ?? existing.driver, auth: data.auth ?? existing.auth, simulate: false }
      : {
          id: data.deviceId,
          name: data.deviceId,
          driver: data.driver ?? "",
          transport: "lan" as const,
          host: data.host ?? "",
          port: data.port,
          auth: data.auth ?? {},
          enabledFeatures: [],
          simulate: false,
        };
    const result = await authenticateDevice({
      config: { ...mem.config, devices: [device] },
      drivers: mem.drivers,
      deviceId: data.deviceId,
      host: device.host,
    });
    const row = mem.config.devices.find((d) => d.id === data.deviceId);
    if (row) {
      if (result.pairedToken) row.auth = { ...row.auth, token: result.pairedToken };
      if (result.pairedPort) row.port = result.pairedPort;
      if (result.ok) row.auth = { ...row.auth, paired: "yes" };
      await persist();
    }
    mem.health[data.deviceId] = { ok: result.ok, message: result.message };
    return result;
  });

export const pingDevice = createServerFn({ method: "POST" })
  .validator((data: { token: string; host: string; port?: number; path?: string }) => data)
  .handler(async ({ data }) => {
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    return pingReachable({ host: data.host, port: data.port, path: data.path, timeoutMs: 800 });
  });

export const clearDeviceError = createServerFn({ method: "POST" })
  .validator((data: { deviceId?: string; token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const mem = memory();
    mem.health = mem.health ?? {};
    if (data.deviceId) mem.health[data.deviceId] = { ok: true, message: "cleared" };
    else mem.health = {};
    return { ok: true, message: "Error cleared" };
  });

export const clearConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (data.pin !== memory().config.room.configPin) return { ok: false, message: "PIN did not match" };
    const { emptyRoomConfig, defaultDeviceState } = await import("./defaults");
    const pin = memory().config.room.configPin;
    memory().config = emptyRoomConfig(pin);
    memory().state = defaultDeviceState();
    memory().vars = {};
    memory().health = {};
    memory().lastError = null;
    memory().runningMacro = null;
    memory().activeScene = null;
    await persist();
    return { ok: true, message: "Room wiped" };
  });

export const exportBundle = createServerFn({ method: "GET" }).handler(async () => {
  await ensureLoaded();
  const mem = memory();
  return {
    configVersion: mem.config.configVersion,
    exportedAt: new Date().toISOString(),
    sourceRoomId: mem.config.room.id,
    config: { ...mem.config, exportedAt: new Date().toISOString(), sourceRoomId: mem.config.room.id },
    drivers: mem.drivers,
  };
});
