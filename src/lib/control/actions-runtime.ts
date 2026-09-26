import { createServerFn } from "@tanstack/react-start";
import { authenticateDevice, executeCommand, pingReachable, runMacro, syncInventory } from "./engine";
import { roomLanBind } from "./nics";
import { NONE_MACRO_ID } from "./types";
import { clampVar, SYSTEM_TIME_VAR_ID } from "./vars";
import { actionPermitted } from "./control-policy";
import { applyOccupancy, occupancyCode, occupancyOf, OCCUPANCY_VAR_ID } from "./peer-payload";
import { loadControl } from "./actions-context";

export const setVariable = createServerFn({ method: "POST" })
  .validator((data: { id: string; value: string | number; token?: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, pushLog, allowLanControl
  } = await loadControl();
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    const mem = memory();
    if (data.id === SYSTEM_TIME_VAR_ID) return { ok: false, message: "Read-only variable" };
    const def = mem.config.variables.find((v) => v.id === data.id);
    if (!def) return { ok: false, message: "Unknown variable" };
    mem.vars[data.id] = clampVar(def, data.value);
    if (data.id === OCCUPANCY_VAR_ID) applyOccupancy(mem.config, mem.vars, String(mem.vars[data.id]));
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
  const {
    ensureLoaded, memory, persist, pushLog, sessionKind
  } = await loadControl();
    await ensureLoaded();
    const kind = sessionKind(data.token);
    if (!actionPermitted({
      externalControl: memory().config.room.externalControl === true,
      tokenKind: kind,
      commandId: data.commandId,
    })) {
      return { ok: false, message: /^system\.(restart|update|reboot)$/.test(data.commandId) ? "Config lock required" : "External control off" };
    }
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
    if (result.ok && data.commandId.startsWith("occupancy.")) {
      mem.vars[OCCUPANCY_VAR_ID] = occupancyCode(occupancyOf(mem.config.room));
    } else if (result.ok && data.variable === OCCUPANCY_VAR_ID) {
      applyOccupancy(mem.config, mem.vars, String(mem.vars[OCCUPANCY_VAR_ID]));
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
  const {
    ensureLoaded, memory, persist, allowLanControl
  } = await loadControl();
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    await ensureLoaded();
    const mem = memory();
    mem.latches = mem.latches ?? {};
    mem.latches[data.group || data.widgetId] = data.widgetId;
    await persist();
    return { ok: true };
  });

export const fireMacro = createServerFn({ method: "POST" })
  .validator((data: { macroId: string; token?: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, pushLog, allowLanControl, drainQueuedTriggers
  } = await loadControl();
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    if (!data.macroId || data.macroId === NONE_MACRO_ID) return { ok: true, message: "none" };
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
    await drainQueuedTriggers();
    return result;
  });

export const authenticate = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; host?: string; port?: number; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, pushLog, validToken
  } = await loadControl();
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
  const {
    ensureLoaded, memory, persist, validToken
  } = await loadControl();
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
  const { validToken, ensureLoaded, memory } = await loadControl();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    await ensureLoaded();
    const bind = roomLanBind(memory().config);
    if (!bind.ok) return bind;
    return pingReachable({ host: data.host, port: data.port, path: data.path, timeoutMs: 800, localAddress: bind.localAddress });
  });

export const clearDeviceError = createServerFn({ method: "POST" })
  .validator((data: { deviceId?: string; token?: string }) => data)
  .handler(async ({ data }) => {
  const { ensureLoaded, memory, allowLanControl } = await loadControl();
    await ensureLoaded();
    if (!allowLanControl(data.token)) return { ok: false, message: "External control off" };
    const mem = memory();
    mem.health = mem.health ?? {};
    if (data.deviceId) mem.health[data.deviceId] = { ok: true, message: "cleared" };
    else mem.health = {};
    return { ok: true, message: "Error cleared" };
  });
