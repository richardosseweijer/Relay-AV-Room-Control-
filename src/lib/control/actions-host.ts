import { createServerFn } from "@tanstack/react-start";
import { applyHost, listHostInterfaces, scanDevicePorts, sendRaw } from "./engine";
import { loadControl } from "./actions-context";

export const restartHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    return applyHost("system.restart", undefined, memory().host, memory().vars, { allowAdmin: true });
  });

export const updateHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    const { roomOutboundBind } = await import("./nics");
    const bind = roomOutboundBind(memory().config);
    if (!bind.ok) return { ok: false, message: bind.message };
    return applyHost("system.update", undefined, memory().host, memory().vars, { allowAdmin: true });
  });

export const rebootHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    return applyHost("system.reboot", undefined, memory().host, memory().vars, { allowReboot: true });
  });

export const listHostPorts = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
  const { validToken } = await loadControl();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", ports: [] as { kind: string; path: string; label: string }[] };
    return listHostInterfaces();
  });

export const listLanNics = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { ensureLoaded, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required", nics: [] as { index: number; name: string; ipv4: string | null; label: string }[] };
    const { listLanNics: scan } = await import("./nics");
    return { ok: true as const, nics: scan() };
  });

export const debugScan = createServerFn({ method: "POST" })
  .validator((data: { token: string; host: string; ports: number[] }) => data)
  .handler(async ({ data }) => {
  const { validToken } = await loadControl();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", open: [] as number[] };
    return scanDevicePorts(data.host, data.ports);
  });

export const debugSend = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; payload: string; host?: string; port?: number; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
  const { ensureLoaded, memory, validToken } = await loadControl();
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
  const { ensureLoaded, clearLog, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    clearLog();
    return { ok: true };
  });
