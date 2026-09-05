import { createServerFn } from "@tanstack/react-start";
import { applyHost, authenticateDevice, executeCommand, listHostInterfaces, pingReachable, probeDevice, runMacro, scanDevicePorts, sendRaw, syncInventory } from "./engine";
import { validateDriver } from "./schema";
import { bundledDrivers } from "./defaults";
import { ensureLoaded, memory, persist, persistNow, pushLog, snapshot, clearLog, normalize, writeDriverFile, removeDriverFile, loadDriverFiles, safeDriverName } from "./store.server";
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

function redactAuth(auth?: Record<string, string>) {
  if (!auth) return {};
  const next = { ...auth };
  for (const key of Object.keys(next)) {
    if (/token|password|secret|key|username/i.test(key)) next[key] = "";
  }
  return next;
}

function publicSnap() {
  const snap = snapshot();
  return {
    ...snap,
    config: {
      ...snap.config,
      room: {
        ...snap.config.room,
        configPin: "",
        panelPin: snap.config.room.panelAccess === "pin" ? "" : null,
      },
      devices: snap.config.devices.map((device) => ({ ...device, auth: redactAuth(device.auth) })),
    },
  };
}

function allowLanControl(token?: string) {
  if (memory().config.room.externalControl !== false) return true;
  return validToken(token, "panel") || validToken(token, "config");
}

export const getSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await ensureLoaded();
  return publicSnap();
});

export const getRoomState = createServerFn({ method: "POST" }).handler(async () => {
  await ensureLoaded();
  return publicSnap();
});

export const issuePanelSession = createServerFn({ method: "POST" }).handler(async () => {
  await ensureLoaded();
  return { ok: true, token: mint("panel") };
});

export const getEditorConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, config: null };
    return { ok: true as const, config: normalize(memory().config) };
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
    const host = memory().host ?? (memory().host = { dim: false, locked: false, toast: null, block: null, pageId: null });
    if (cfg.room.panelAccess !== "pin") {
      host.locked = false;
      return { ok: true, token: mint("panel") };
    }
    const expected = cfg.room.panelPin?.trim() ?? "";
    if (!expected) return { ok: false, token: null };
    const ok = data.pin === expected;
    if (ok) host.locked = false;
    return ok ? { ok: true, token: mint("panel") } : { ok: false, token: null };
  });

export const saveConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin?: string; config: RoomConfig }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (data.pin && data.pin !== memory().config.room.configPin) return { ok: false, message: "PIN did not match" };
    const pin = data.config.room.configPin?.trim() || memory().config.room.configPin;
    const panelPin = data.config.room.panelAccess === "pin"
      ? (data.config.room.panelPin?.trim() || memory().config.room.panelPin)
      : null;
    const prevVars = memory().config.variables ?? [];
    const config: RoomConfig = {
      ...data.config,
      room: { ...data.config.room, configPin: pin, panelPin },
      variables: data.config.variables ?? [],
      schedules: data.config.schedules ?? [],
      monitors: data.config.monitors ?? [],
      triggers: data.config.triggers ?? [],
      interfaces: data.config.interfaces ?? [],
    };
    memory().config = config;
    const vars = seedVars(config, memory().vars);
    for (const v of config.variables) {
      const old = prevVars.find((item) => item.id === v.id);
      if (!old || old.default !== v.default) vars[v.id] = v.default;
    }
    memory().vars = vars;
    await persistNow();
    return { ok: true, message: "Saved" };
  });

export const saveDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string; spec: DriverSpec }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const name = safeDriverName(data.filename);
    const problem = validateDriver(data.spec);
    if (problem) return { ok: false, message: problem };
    memory().drivers[name] = data.spec;
    memory().library = memory().library ?? {};
    memory().library[name] = data.spec;
    await writeDriverFile(name, data.spec);
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
    memory().drivers = await loadDriverFiles();
    memory().state = defaultDeviceState();
    memory().vars = seedVars(memory().config);
    memory().lastError = null;
    memory().runningMacro = null;
    memory().activeScene = null;
    await persistNow();
    return { ok: true, message: "Demo room restored" };
  });

export const setVariable = createServerFn({ method: "POST" })
  .validator((data: { id: string; value: string | number; token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    const mem = memory();
    const def = mem.config.variables.find((v) => v.id === data.id);
    if (!def) return { ok: false, message: "Unknown variable" };
    mem.vars[data.id] = clampVar(def, data.value);
    await persist();
    if (!def.pushDevice || !def.pushCommand) return { ok: true, message: String(mem.vars[data.id]) };
    const result = await executeCommand({
      config: mem.config,
      drivers: mem.drivers,
      state: mem.state,
      vars: mem.vars,
      health: mem.health ?? (mem.health = {}),
      deviceId: def.pushDevice,
      commandId: def.pushCommand,
      value: mem.vars[data.id],
      host: mem.host,
    });
    pushLog({ kind: "command", ok: result.ok, title: `${def.pushDevice}.${def.pushCommand}`, detail: result.message });
    return result;
  });

export const fireCommand = createServerFn({ method: "POST" })
  .validator((data: { deviceId: string; commandId: string; value?: string | number; variable?: string | null; raw?: boolean; token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
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
      raw: data.raw,
      host: mem.host,
    });
    mem.health[data.deviceId] = { ok: result.ok, message: result.message };
    if (data.commandId === "var.set") await persist();
    if (data.variable) {
      const def = mem.config.variables.find((v) => v.id === data.variable);
      mem.vars[data.variable] = def ? clampVar(def, data.value ?? def.default) : (data.value ?? "");
    }
    if (result.ok === false && data.variable) {
      const def = mem.config.variables.find((v) => v.id === data.variable);
      if (def?.pushDevice && def.pushCommand && def.pushDevice !== data.deviceId) {
        await executeCommand({
          config: mem.config,
          drivers: mem.drivers,
          state: mem.state,
          vars: mem.vars,
          health: mem.health,
          deviceId: def.pushDevice,
          commandId: def.pushCommand,
          value: mem.vars[data.variable],
          host: mem.host,
        });
      }
    }
    mem.lastError = result.ok ? null : result.message;
    pushLog({ kind: "command", ok: result.ok, title: `${data.deviceId}.${data.commandId}`, detail: result.message });
    if (result.ok) await persist();
    return result;
  });

export const setLatch = createServerFn({ method: "POST" })
  .validator((data: { group: string; widgetId: string; token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    await ensureLoaded();
    const mem = memory();
    mem.latches = mem.latches ?? {};
    mem.latches[data.group || data.widgetId] = data.widgetId;
    await persist();
    return { ok: true };
  });

export const restartHost = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    return applyHost("system.restart", undefined, memory().host);
  });

export const updateHost = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    return applyHost("system.update", undefined, memory().host);
  });

export const rebootHost = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    return applyHost("system.reboot", undefined, memory().host, memory().vars, { allowReboot: true });
  });

export const fireMacro = createServerFn({ method: "POST" })
  .validator((data: { macroId: string; token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    const mem = memory();
    const macro = mem.config.macros.find((m) => m.id === data.macroId);
    if (!macro) return { ok: false, message: "Unknown macro" };
    mem.runningMacro = macro.id;
    const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro, host: mem.host });
    mem.runningMacro = null;
    if (!result.ok && mem.host?.block) mem.host.block = null;
    if (result.ok) mem.activeScene = macro.id;
    mem.lastError = result.ok ? null : result.message;
    pushLog({ kind: "macro", ok: result.ok, title: macro.label, detail: result.message });
    await persist();
    return result;
  });

export const addDriverFromLibrary = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const spec = mem.library?.[data.filename];
    if (!spec) return { ok: false, message: "Not in library" };
    mem.drivers[data.filename] = spec;
    await persist();
    return { ok: true, message: data.filename };
  });

export const deleteDriver = createServerFn({ method: "POST" })
  .validator((data: { token: string; filename: string; reassignTo?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const used = driverInUse(mem.config, data.filename);
    if (used.length) return { ok: false, message: `In use by ${used.join(", ")}. Reassign those devices first.` };
    delete mem.drivers[data.filename];
    await persist();
    return { ok: true, message: "Removed from room" };
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
      if (result.pairedToken) {
        row.auth = { ...row.auth, token: result.pairedToken, paired: "yes" };
      } else if (!result.ok) {
        row.auth = { ...row.auth, paired: "" };
      }
      if (result.pairedPort) row.port = result.pairedPort;
      await persist();
    }
    mem.health[data.deviceId] = { ok: result.ok, message: result.message };
    pushLog({ kind: "auth", ok: result.ok, title: `Authenticate ${data.deviceId}`, detail: result.message });
    return result;
  });

export const pullInventory = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; host?: string; port?: number; driver?: string; auth?: Record<string, string>; simulate?: boolean }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const existing = mem.config.devices.find((d) => d.id === data.deviceId);
    if (!existing) return { ok: false, message: "Unknown device" };
    const device = {
      ...existing,
      host: data.host ?? existing.host,
      port: data.port ?? existing.port,
      driver: data.driver ?? existing.driver,
      auth: data.auth ?? existing.auth,
      simulate: data.simulate ?? existing.simulate,
    };
    const result = await syncInventory({
      config: { ...mem.config, devices: [device] },
      drivers: mem.drivers,
      deviceId: data.deviceId,
      vars: mem.vars,
    });
    if (result.ok && result.inventory) {
      existing.inventory = result.inventory;
      await persist();
    }
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

export const listHostPorts = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", ports: [] as { kind: string; path: string; label: string }[] };
    return listHostInterfaces();
  });

export const debugScan = createServerFn({ method: "POST" })
  .validator((data: { token: string; host: string; ports: number[] }) => data)
  .handler(async ({ data }) => {
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", open: [] as number[] };
    return scanDevicePorts(data.host, data.ports);
  });

export const debugSend = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; payload: string; host?: string; port?: number; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const existing = mem.config.devices.find((d) => d.id === data.deviceId);
    const device = existing
      ? { ...existing, host: data.host ?? existing.host, port: data.port ?? existing.port, driver: data.driver ?? existing.driver, auth: data.auth ?? existing.auth, simulate: false }
      : null;
    if (!device) return { ok: false, message: "Save the device first" };
    return sendRaw({
      config: { ...mem.config, devices: [device] },
      drivers: mem.drivers,
      deviceId: data.deviceId,
      payload: data.payload,
    });
  });

export const wipeLog = createServerFn({ method: "POST" }).handler(async () => {
  await ensureLoaded();
  clearLog();
  return { ok: true };
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
    await persistNow();
    return { ok: true, message: "Room wiped" };
  });

export const exportBundle = createServerFn({ method: "GET" }).handler(async () => {
  await ensureLoaded();
  const mem = memory();
  const config = structuredClone(mem.config);
  config.room.configPin = "";
  config.room.panelPin = config.room.panelAccess === "pin" ? "" : null;
  config.devices = config.devices.map((device) => ({ ...device, auth: redactAuth(device.auth) }));
  return {
    configVersion: config.configVersion,
    exportedAt: new Date().toISOString(),
    sourceRoomId: config.room.id,
    config: { ...config, exportedAt: new Date().toISOString(), sourceRoomId: config.room.id },
    drivers: mem.drivers,
  };
});
