import { createServerFn } from "@tanstack/react-start";
import { applyHost, authenticateDevice, executeCommand, listHostInterfaces, pingReachable, probeDevice, runMacro, scanDevicePorts, sendRaw, syncInventory, traces, scrubSecret } from "./engine";
import { validateDriver } from "./schema";
import { bundledDrivers } from "./defaults";
import { ensureLoaded, memory, persist, persistNow, pushLog, snapshot, clearLog, normalize, writeDriverFile, removeDriverFile, loadDriverFiles, safeDriverName } from "./store.server";
import type { DriverSpec, RoomConfig } from "./types";
import { clampVar, driverInUse, seedVars } from "./vars";
import { isWeakPin } from "./pins";
import { randomBytes } from "node:crypto";

const g = globalThis as typeof globalThis & {
  __relayTokens__?: Map<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
};

function tokenStore() {
  if (!g.__relayTokens__) g.__relayTokens__ = new Map();
  return g.__relayTokens__;
}

function mint(kind: "config" | "panel", label?: string) {
  const id = randomBytes(8).toString("hex");
  const secret = `${kind}-${randomBytes(18).toString("hex")}`;
  const row = { id, secret, kind, exp: 0, created: Date.now(), lastSeen: Date.now(), label: (label || kind).slice(0, 80) };
  tokenStore().set(secret, row);
  const mem = memory();
  mem.sessions = mem.sessions ?? {};
  mem.sessions[id] = row;
  persist();
  return secret;
}

function findSessionBySecret(token: string | undefined) {
  if (!token) return undefined;
  return tokenStore().get(token) ?? Object.values(memory().sessions ?? {}).find((item) => item.secret === token);
}

function reuseOrMintPanel(label = "panel") {
  const mem = memory();
  mem.sessions = mem.sessions ?? {};
  const existing = Object.values(mem.sessions).find((row) => row.kind === "panel" && row.secret);
  if (existing?.secret) {
    existing.lastSeen = Date.now();
    tokenStore().set(existing.secret, existing);
    return existing.secret;
  }
  return mint("panel", label);
}

function validToken(token: string | undefined, kind: "config" | "panel") {
  if (!token) return false;
  const mem = memory();
  const row = findSessionBySecret(token);
  if (!row || row.kind !== kind) return false;
  if (row.exp && row.exp < Date.now()) {
    tokenStore().delete(token);
    const id = Object.entries(mem.sessions ?? {}).find(([, item]) => item === row || item.secret === token)?.[0];
    if (id && mem.sessions) delete mem.sessions[id];
    return false;
  }
  row.lastSeen = Date.now();
  tokenStore().set(token, row);
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
    traces: {},
    log: (snap.log ?? []).map((row) => ({ ...row, detail: scrubSecret(row.detail), title: scrubSecret(row.title) })),
    health: Object.fromEntries(Object.entries(snap.health ?? {}).map(([id, row]) => [id, { ...row, message: scrubSecret(row.message ?? "") }])),
    lastError: snap.lastError ? scrubSecret(snap.lastError) : null,
    config: {
      ...snap.config,
      room: {
        ...snap.config.room,
        configPin: "",
        peerSecret: "",
        panelPin: snap.config.room.panelAccess === "pin" ? "" : null,
      },
      devices: snap.config.devices.map((device) => ({ ...device, auth: redactAuth(device.auth) })),
    },
  };
}

function allowLanControl(token?: string) {
  if (memory().config.room.externalControl === true) return true;
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

export const issuePanelSession = createServerFn({ method: "POST" })
  .validator((data: { token?: string } = {}) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (validToken(data.token, "panel") || validToken(data.token, "config")) {
      return { ok: true, token: data.token as string };
    }
    const room = memory().config.room;
    if (room.panelAccess === "pin" && room.panelPin?.trim()) {
      return { ok: false, token: null as string | null };
    }
    return { ok: true, token: reuseOrMintPanel("panel") };
  });

export const checkPanelSession = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    return { ok: validToken(data.token, "panel") || validToken(data.token, "config") };
  });

export const getEditorConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
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
    return { ok: true as const, config, traces: traces(), mustChange: isWeakPin(config.room.configPin), paired };
  });

export const revokeSession = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const row = memory().sessions?.[data.id];
    if (row?.secret) tokenStore().delete(row.secret);
    tokenStore().delete(data.id);
    if (memory().sessions) delete memory().sessions[data.id];
    persist();
    return { ok: true, message: "Device forgotten" };
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    for (const [id, row] of Object.entries(memory().sessions ?? {})) {
      if (row.kind !== "panel") continue;
      if (row.secret) tokenStore().delete(row.secret);
      delete memory().sessions[id];
    }
    persist();
    return { ok: true, message: "Panel devices forgotten" };
  });

export const verifyConfigPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const ok = data.pin === memory().config.room.configPin;
    if (!ok) return { ok: false, token: null as string | null, mustChange: false };
    return { ok: true, token: mint("config"), mustChange: isWeakPin(data.pin) };
  });

export const verifyPanelPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    const cfg = memory().config;
    const host = memory().host ?? (memory().host = { dim: false, locked: false, toast: null, block: null, pageId: null });
    if (cfg.room.panelAccess !== "pin") {
      host.locked = false;
      return { ok: true, token: reuseOrMintPanel("panel") };
    }
    const expected = cfg.room.panelPin?.trim() ?? "";
    if (!expected) return { ok: false, token: null };
    const ok = data.pin === expected;
    if (ok) host.locked = false;
    return ok ? { ok: true, token: reuseOrMintPanel("panel") } : { ok: false, token: null };
  });

export const saveConfig = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin?: string; config: RoomConfig }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (data.pin && data.pin !== memory().config.room.configPin) return { ok: false, message: "PIN did not match" };
    const pin = data.config.room.configPin?.trim() || memory().config.room.configPin;
    if (isWeakPin(pin)) return { ok: false, message: "Choose a PIN that is not 1234, 0000, or a repeat/sequence" };
    const panelPin = data.config.room.panelAccess === "pin"
      ? (data.config.room.panelPin?.trim() || memory().config.room.panelPin)
      : null;
    if (data.config.room.panelAccess === "pin" && isWeakPin(panelPin)) {
      return { ok: false, message: "Panel PIN is too weak" };
    }
    const peerSecret = data.config.room.peerSecret?.trim() || memory().config.room.peerSecret || randomBytes(24).toString("hex");
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
    const nextConfig: RoomConfig = { ...config, devices };
    memory().config = nextConfig;
    const vars = seedVars(nextConfig, memory().vars);
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
    if (result.ok && data.variable) {
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
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
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

export const wipeLog = createServerFn({ method: "POST" })
  .validator((data: { token?: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
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

export const exportBundle = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required" };
    const mem = memory();
    const config = structuredClone(mem.config);
    config.room.configPin = "";
    config.room.panelPin = config.room.panelAccess === "pin" ? "" : null;
    config.devices = config.devices.map((device) => ({ ...device, auth: redactAuth(device.auth) }));
    config.exportedAt = new Date().toISOString();
    config.sourceRoomId = config.room.id;
    return {
      ok: true as const,
      configVersion: config.configVersion,
      exportedAt: config.exportedAt,
      sourceRoomId: config.room.id,
      config,
      drivers: mem.drivers,
    };
  });

export const importBundle = createServerFn({ method: "POST" })
  .validator((data: { token: string; bundle: { config?: RoomConfig; drivers?: Record<string, DriverSpec> } }) => data)
  .handler(async ({ data }) => {
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
      room: { ...incoming.room, configPin: pin, panelPin },
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
        memory().library[file] = spec;
        await writeDriverFile(file, spec);
      }
    }
    memory().config = config;
    memory().vars = seedVars(config, memory().vars);
    await persistNow();
    return { ok: true, message: "Imported. Fill any blank device tokens." };
  });
