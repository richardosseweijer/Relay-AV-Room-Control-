import type {
  CommandResult,
  DeviceHealth,
  DeviceInstance,
  DeviceInventory,
  DeviceStateMap,
  DriverSpec,
  HostInterface,
  Macro,
  RoomConfig,
} from "./types";
import { NONE_MACRO_ID } from "./types";
import { inferPairingSteps } from "./schema";
import { gatewayIoTemplate, gatewayProfile, gatewaySlot, isGatewayKind } from "./gateway";
import { clampVar, resolveTemplate, type VarMap } from "./vars";
import { fetchTextBounded, requestHttpExact, DEFAULT_MAX_RESPONSE_BYTES } from "./http-client";
import { wsPoolSize, sendControlSocket, buildWsTarget } from "./ws";
import { castPoolSize } from "./cast";
import { sendWol } from "./wol";
import { rtpMidiPoolSize } from "./rtp-midi";
import { encodeMtcQf, encodeMtcSysex } from "./midi-in";
import { roomLanBind } from "./nics";
import { allowedLanHost, pushTrace, safeLanHttpUrl, sleep } from "./engine-policy";
import { applySim, guardOk, mapCommandValue, parseFeedback, parseInventoryItems, pickJsonField, renderPayload } from "./engine-payload";
import { paceDevice, tcpSessionWrite, tcpPoolSize } from "./engine-wire";
import { sendHttp, sendLan, wsQueryFromDriver } from "./engine-lan";
import {
  applyHost,
  readHostFeedback,
  sendLocal,
  usesLocalPort,
} from "./engine-host";

export { allowedLanHost, pushTrace, scrubSecret, traces } from "./engine-policy";
export { sendHttp } from "./engine-lan";
export { applyHost, listHostInterfaces, type HostPort } from "./engine-host";

export function socketStats() {
  return {
    ws: wsPoolSize(),
    tcp: tcpPoolSize(),
    cast: castPoolSize(),
    rtpMidi: rtpMidiPoolSize(),
  };
}

function wireThroughInterface(device: DeviceInstance, iface?: HostInterface): DeviceInstance {
  if (!iface) return device;
  if (isGatewayKind(iface.kind)) {
    const profile = gatewayProfile(iface.vendor);
    const slot = gatewaySlot(iface.vendor, iface.slot);
    return {
      ...device,
      host: iface.host || device.host,
      port: slot?.mapPort ?? iface.controlPort ?? profile?.controlPort ?? device.port,
      transport: "lan",
      baud: device.baud ?? iface.baud ?? slot?.baudDefault,
      auth: { ...device.auth, ifaceKind: "gateway", gatewaySlot: iface.slot || "" },
    };
  }
  return {
    ...device,
    interface: iface.path || device.interface,
    port: iface.line ?? device.port,
    baud: device.baud ?? iface.baud,
    auth: { ...device.auth, ifaceKind: iface.kind || "", chip: iface.chip || "", pin: iface.line != null ? String(iface.line) : "" },
  };
}

function statusPlane(driver: DriverSpec, device: DeviceInstance) {
  if (driver.transports.lan?.protocol === "cast") return null;
  const path = driver.status?.path;
  const port = driver.status?.port;
  if (!path || !port) return null;
  const proto = driver.status?.protocol ?? "http";
  return `${proto}://${device.host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function pingReachable(opts: { host: string; port?: number; path?: string; timeoutMs?: number }): Promise<CommandResult> {
  if (!opts.host) return { ok: false, message: "No host" };
  const local = /^(localhost|127\.0\.0\.1|::1)$/i.test(opts.host.trim());
  if (!allowedLanHost(opts.host, { localOk: local })) return { ok: false, message: "Host not on room LAN" };
  if (local && (!opts.port || opts.port === 0)) return { ok: true, message: "local" };
  const port = opts.port ?? 80;
  const timeout = Math.max(opts.timeoutMs ?? 800, 1500);
  const path = opts.path || "/";
  const httpPorts = new Set([80, 443, 8001, 8080, 8443]);
  if (httpPorts.has(port) || path.startsWith("/api")) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(`http://${opts.host}:${port}${path.startsWith("/") ? path : `/${path}`}`, { signal: ctrl.signal });
      clearTimeout(t);
      await res.text();
      return { ok: true, message: String(res.status) };
    } catch {
      /* fall through to TCP */
    }
  }
  return new Promise((resolve) => {
    import("node:net").then((net) => {
      const sock = net.connect({ host: opts.host, port }); // loopback-or-unbound ping
      const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: `closed ${port}` }); }, timeout);
      sock.on("connect", () => { clearTimeout(timer); sock.end(); resolve({ ok: true, message: `open ${port}` }); });
      sock.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    });
  });
}

export async function authenticateDevice(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; host?: string }): Promise<CommandResult & { pairedToken?: string; pairedPort?: number }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "No driver" };
  const host = opts.host ?? device.host;
  if (!allowedLanHost(host, { localOk: device.driver === "relay-host.json" || driver.device.type === "host" })) {
    return { ok: false, message: "Host not on room LAN" };
  }
  const steps = inferPairingSteps(driver.auth?.pairing);
  if (!steps.length) {
    const ping = await pingReachable({ host, port: device.port ?? driver.transports.lan?.port });
    return { ok: ping.ok, message: ping.ok ? "Reachable (no pairing steps)" : ping.message };
  }
  for (const step of steps) {
    const port = step.port ?? device.port ?? driver.transports.lan?.port ?? 80;
    const path = step.path || "/";
    if (step.action === "http-get" || step.action === "http-post") {
      try {
        const res = await fetch(`http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`, {
          method: step.action === "http-post" ? "POST" : "GET",
          body: step.action === "http-post" ? (step.body || "{\"devicetype\":\"relay#room\"}") : undefined,
          headers: { "content-type": "application/json" },
        });
        const text = await res.text();
        const token = pickJsonField(text, step.tokenJsonPath || "username") || text.match(/"username"\s*:\s*"([^"]+)"/)?.[1] || text.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
        if (token) return { ok: true, message: "Paired", pairedToken: token, pairedPort: step.nextPort ?? port };
        if (/link button|not pressed/i.test(text)) return { ok: false, message: "Press the device button, then Authenticate again" };
      } catch (err) {
        pushTrace(device.id, "note", err instanceof Error ? err.message : "step failed");
      }
      continue;
    }
    if (step.action === "websocket") {
      if (/^file:/i.test(step.path || "")) continue;
      const lan = driver.transports.lan;
      const pairing = driver.auth?.pairing;
      const target = buildWsTarget({
        path: step.path || lan?.path || pairing?.path || lan?.http?.path,
        query: wsQueryFromDriver(driver, device),
        port,
        tls: step.tls ?? lan?.protocol === "tls-websocket",
        token: device.auth?.token,
      });
      const result = await sendControlSocket({
        host,
        ...target,
        payload: "",
        timeout: step.timeoutMs ?? 12000,
        handshake: {
          waitContains: step.waitContains || lan?.handshake?.waitContains || pairing?.waitContains,
          delayMs: lan?.handshake?.delayMs,
        },
      });
      const tokenPath = step.tokenJsonPath || pairing?.tokenJsonPath || "token";
      const token = pickJsonField(result.message, tokenPath)
        || result.message.match(/token\s+([A-Za-z0-9._-]+)/)?.[1]
        || result.message.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
      if (token) return { ok: true, message: "Paired", pairedToken: token, pairedPort: step.nextPort ?? target.port };
      if (result.message.includes("waiting for pairing") || result.ok) {
        return { ok: false, message: pairing?.userPrompt || "Accept on the device, then Authenticate again" };
      }
    }
  }
  return { ok: false, message: "No token from pairing steps" };
}

export async function scanDevicePorts(host: string, ports?: number[]) {
  const list = ports ?? [80, 23, 2001, 2002, 4352, 8001, 8002, 8008, 8009, 53484, 53595, 51325, 51326, 51327];
  const open: number[] = [];
  for (const port of list) {
    const res = await pingReachable({ host, port, timeoutMs: 400 });
    if (res.ok) open.push(port);
  }
  return { ok: open.length > 0, message: open.join(", ") || "none open", open };
}

async function sendGatewayRaw(opts: { config: RoomConfig; interfaceId: string; payload: string }): Promise<CommandResult> {
  const iface = opts.config.interfaces?.find((item) => item.id === opts.interfaceId);
  if (!iface) return { ok: false, message: "Unknown interface" };
  if (!isGatewayKind(iface.kind)) return { ok: false, message: "Not a gateway" };
  if (!iface.host) return { ok: false, message: "No gateway IP" };
  const stub: DeviceInstance = {
    id: iface.id,
    name: iface.label,
    driver: "",
    transport: "lan",
    host: iface.host,
    port: gatewaySlot(iface.vendor, iface.slot)?.mapPort ?? iface.controlPort ?? gatewayProfile(iface.vendor)?.controlPort ?? 23,
    auth: {},
    enabledFeatures: [],
    simulate: false,
  };
  const wired = wireThroughInterface(stub, iface);
  if (!allowedLanHost(wired.host)) return { ok: false, message: "Host not on room LAN" };
  const port = wired.port ?? 23;
  const text = String(opts.payload ?? "").replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  let buf: Buffer;
  if (/^hex:/i.test(text.trim())) {
    const hex = text.trim().slice(4).replace(/\s+/g, "");
    if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return { ok: false, message: "Bad hex payload" };
    buf = Buffer.from(hex, "hex");
  } else {
    buf = Buffer.from(text, "utf8");
  }
  pushTrace(iface.id, "tx", `gateway ${wired.host}:${port} ${text.slice(0, 120)}`);
  await paceDevice(`gw:${iface.id}`, 40);
  const bind = roomLanBind(opts.config);
  if (!bind.ok) return bind;
  const result = await tcpSessionWrite(
    `gw:${wired.host}:${port}`,
    wired.host,
    port,
    buf,
    { keepMs: 20000 },
    {},
    1200,
    bind.localAddress,
  );
  pushTrace(iface.id, result.ok ? "rx" : "note", result.message);
  return result;
}

export async function sendRaw(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; payload: string }): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "No driver" };
  const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
  const wired = wireThroughInterface(device, iface);
  return usesLocalPort(iface) ? sendLocal(driver, wired, opts.payload) : sendLan(driver, wired, opts.payload, undefined, opts.config);
}

export async function syncInventory(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; vars?: Record<string, string | number> }): Promise<{ ok: boolean; message: string; inventory?: DeviceInventory }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  const resources = driver?.inventory?.resources ?? [];
  if (!resources.length) return { ok: false, message: "No inventory on driver" };
  if (driver.device.type === "host" || device.driver === "relay-host.json") {
    if (!isLocalRelayHost(device.host)) {
      try {
        const res = await signedPeerFetch(device, "GET", "/api/peer");
        const parsed = JSON.parse(res.text) as {
          ok?: boolean;
          message?: string;
          vars?: Record<string, { name?: string; value?: string | number }>;
          macros?: Record<string, { name?: string }>;
        };
        if (!res.ok || parsed.ok === false) return { ok: false, message: parsed.message || "Peer refused" };
        const vars = Object.entries(parsed.vars ?? {}).map(([id, row]) => ({
          id, name: String(row.name || id), value: row.value, group: "vars", kind: "var",
        }));
        const macros = Object.entries(parsed.macros ?? {}).map(([id, row]) => ({
          id, name: String(row.name || id), group: "macros", kind: "macro",
        }));
        return { ok: true, message: `${vars.length} vars`, inventory: { vars, macros } };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "peer inventory failed" };
      }
    }
    const items = (opts.config.variables ?? []).map((item) => ({
      id: item.id,
      name: item.label,
      value: opts.vars?.[item.id] ?? item.default,
      group: item.kind,
      kind: item.kind,
    }));
    const macros = (opts.config.macros ?? []).map((item) => ({
      id: item.id,
      name: item.label,
      group: "macros",
      kind: "macro",
    }));
    return { ok: true, message: `${items.length} vars`, inventory: { vars: items, macros } };
  }
  const inventory: DeviceInventory = {};
  for (const resource of resources) {
    let raw = "";
    if (resource.payload) {
      const res = await sendLan(driver, device, resource.payload, {
        id: `inventory.${resource.id}`,
        label: resource.label,
        kind: "action",
        transport: "lan",
        payload: resource.payload,
        waitContains: resource.waitContains,
        alsoSend: resource.alsoSend,
      }, opts.config);
      if (!res.ok) return { ok: false, message: res.message };
      raw = res.message;
    } else if (resource.httpPath) {
      if (!allowedLanHost(device.host)) return { ok: false, message: "Host not on room LAN" };
      const path = renderPayload(resource.httpPath, undefined, device.auth, { host: device.host, port: device.port, id: device.id });
      const port = driver.status?.port ?? device.port ?? driver.transports.lan?.port ?? 80;
      const built = safeLanHttpUrl("http", device.host, port, path);
      if (!built.ok) return { ok: false, message: built.message };
      const inventoryLimit = 2 * 1024 * 1024;
      const bind = roomLanBind(opts.config);
      if (!bind.ok) return bind;
      const res = await sendHttp(built.url, resource.httpMethod || "GET", "", 8000, {
        maxBytes: inventoryLimit,
        maxMessageChars: inventoryLimit,
        localAddress: bind.localAddress,
      });
      if (!res.ok) return { ok: false, message: res.message };
      raw = res.message;
    } else continue;
    inventory[resource.id] = parseInventoryItems(raw, resource);
  }
  const count = Object.values(inventory).reduce((n, list) => n + list.length, 0);
  return { ok: true, message: count ? `${count} items` : "No items in reply", inventory };
}

function findFeedback(driver: DriverSpec | undefined, id: string) {
  const list = driver?.feedback ?? [];
  if (!id) return list[0];
  const lower = id.trim().toLowerCase();
  return list.find((item) => item.id === id)
    || list.find((item) => item.id.toLowerCase() === lower)
    || list.find((item) => item.label.toLowerCase() === lower)
    || list.find((item) => item.id.toLowerCase().startsWith(`${lower}.`))
    || list.find((item) => item.id.toLowerCase().endsWith(`.${lower}`));
}

export async function readMonitorValue(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  deviceId: string;
  feedbackId: string;
  interfaceId?: string | null;
  query?: string;
  parsePattern?: string;
  host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null };
}): Promise<{ ok: boolean; value: string; message: string }> {
  if (opts.interfaceId) {
    const result = await sendGatewayRaw({ config: opts.config, interfaceId: opts.interfaceId, payload: opts.query || "" });
    if (!result.ok) return { ok: false, value: "", message: result.message };
    let value = result.message.trim();
    if (opts.parsePattern) {
      try {
        const hit = value.match(new RegExp(opts.parsePattern));
        value = hit?.[1] ?? hit?.[0] ?? value;
      } catch {
        return { ok: false, value: "", message: "Bad parse regex" };
      }
    }
    const key = `iface:${opts.interfaceId}`;
    opts.state[key] = { ...(opts.state[key] ?? {}), raw: value };
    return { ok: true, value, message: value };
  }
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, value: "", message: "Unknown device" };
  const slot = opts.state[device.id] ?? {};
  const driver = opts.drivers[device.driver];
  if (driver?.device.type === "host" || device.driver === "relay-host.json") {
    if (!isLocalRelayHost(device.host)) {
      try {
        const res = await signedPeerFetch(device, "GET", "/api/peer");
        const parsed = JSON.parse(res.text) as { host?: { dim?: boolean; locked?: boolean }; vars?: Record<string, { value?: string | number }> };
        let value = "";
        if (opts.feedbackId === "panel.locked") value = parsed.host?.locked ? "1" : "0";
        else if (opts.feedbackId === "display.dimmed") value = parsed.host?.dim ? "1" : "0";
        else if (opts.feedbackId === "occupancy.state") {
          const { occupancyFromVarValue, occupancyCode } = await import("./peer-payload");
          const occ = occupancyFromVarValue((parsed as { occupancy?: string }).occupancy);
          value = occ ? occupancyCode(occ) : "";
        }
        else if (parsed.vars?.[opts.feedbackId]) value = String(parsed.vars[opts.feedbackId]!.value ?? "");
        else value = "";
        opts.state[device.id] = { ...slot, [opts.feedbackId]: value };
        return { ok: res.ok, value, message: value || "peer" };
      } catch (err) {
        return { ok: false, value: "", message: err instanceof Error ? err.message : "peer poll failed" };
      }
    }
    if (opts.feedbackId === "occupancy.state") {
      const { occupancyOf, occupancyCode } = await import("./peer-payload");
      const value = occupancyCode(occupancyOf(opts.config.room));
      opts.state[device.id] = { ...slot, [opts.feedbackId]: value };
      return { ok: true, value, message: value };
    }
    const result = await readHostFeedback(opts.feedbackId, opts.host);
    opts.state[device.id] = { ...slot, [opts.feedbackId]: result.value };
    return result;
  }
  const fb = findFeedback(driver, opts.feedbackId);
  if (!driver || !fb) {
    const ids = (driver?.feedback ?? []).map((item) => item.id).join(", ");
    return { ok: false, value: "", message: ids ? `Feedback missing (try ${ids})` : "Feedback missing" };
  }
  if (device.simulate) {
    const current = slot[opts.feedbackId];
    const value = current === undefined || current === null ? "" : String(current);
    return { ok: true, value, message: value || "simulated" };
  }
  if (fb.mode === "push" && !fb.query && !fb.httpPath) {
    const current = slot[opts.feedbackId];
    const value = current === undefined || current === null ? "" : String(current);
    return { ok: true, value, message: value || "push" };
  }
  const statusUrl = statusPlane(driver, device);
  if (statusUrl) {
    const url = statusUrl;
    try {
      const bind = roomLanBind(opts.config);
      if (!bind.ok) return { ok: false, value: "", message: bind.message };
      const response = await requestHttpExact(url, "GET", "", {}, 2000, DEFAULT_MAX_RESPONSE_BYTES, bind.localAddress);
      if (!response.ok) return { ok: false, value: "", message: response.text || String(response.status) };
      const text = response.text;
      const parsed = parseFeedback(fb.parse, text);
      opts.state[device.id] = { ...slot, [opts.feedbackId]: parsed };
      return { ok: true, value: parsed, message: parsed };
    } catch (err) {
      return { ok: false, value: "", message: err instanceof Error ? err.message : "poll failed" };
    }
  }
  const payload = fb.query ?? driver.probe?.payload ?? '{"type":"GET_STATUS","requestId":1}';
  const result = await sendLan(driver, device, payload, {
    id: fb.id,
    label: fb.label,
    kind: "action",
    transport: fb.transport,
    payload,
    httpPath: fb.httpPath,
    httpMethod: fb.httpMethod,
    httpHeaders: fb.httpHeaders,
  }, opts.config);
  if (!result.ok) return { ok: false, value: "", message: result.message };
  const parsed = parseFeedback(fb.parse, result.message);
  opts.state[device.id] = { ...slot, [opts.feedbackId]: parsed };
  return { ok: true, value: parsed, message: parsed };
}

function isLocalRelayHost(host?: string) {
  const h = String(host ?? "").trim().toLowerCase();
  return !h || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
}

function relayPeerUrl(device: { host: string; port?: number }, path: string) {
  return `http://${device.host}:${device.port || 8081}${path}`;
}

async function signedPeerFetch(device: { host: string; port?: number; auth?: Record<string, string> }, method: string, path: string, body?: string) {
  if (!allowedLanHost(device.host)) {
    throw new Error("Host not on room LAN");
  }
  const key = device.auth?.secret || device.auth?.pin || device.auth?.token || "";
  const payload = method === "GET" ? "" : (body ?? "");
  const ts = String(Date.now());
  const { signPeer } = await import("./peer-auth");
  const headers: Record<string, string> = { "x-relay-ts": ts, "x-relay-auth": key ? signPeer(key, method, path, ts, payload) : "" };
  if (method !== "GET") headers["content-type"] = "application/json";
  return fetchTextBounded(relayPeerUrl(device, path), {
    method,
    headers,
    body: method === "GET" ? undefined : payload,
  }, 8000, 2 * 1024 * 1024);
}

async function callRelayPeer(
  device: { host: string; port?: number; auth?: Record<string, string> },
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<CommandResult> {
  const payload = method === "GET" ? "" : JSON.stringify(body ?? {});
  try {
    const res = await signedPeerFetch(device, method, path, payload);
    const text = res.text;
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; message?: string };
      return { ok: parsed.ok !== false && res.ok, message: parsed.message || text.slice(0, 200) };
    } catch {
      return { ok: res.ok, message: text.slice(0, 200) || String(res.status) };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "peer failed" };
  }
}

export async function executeCommand(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars?: VarMap;
  health?: DeviceHealth;
  deviceId: string;
  commandId: string;
  value?: string | number;
  raw?: boolean;
  depth?: number;
  stack?: string[];
  host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null };
}): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  const command = driver?.commands.find((c) => c.id === opts.commandId);
  if (!driver || !command) return { ok: false, message: "Unknown command" };
  if (driver.device.type === "host" || device.driver === "relay-host.json") {
    if (!isLocalRelayHost(device.host)) {
      // Peers stay macro-only (/api/peer rejects raw commands). Only forward macro.run.
      if (opts.commandId === "macro.run") {
        const target = String(resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables) ?? "");
        return callRelayPeer(device, "POST", "/api/peer", { macroId: target });
      }
      return {
        ok: false,
        message: `Remote peer only accepts allow-listed macros (got ${opts.commandId}); use macro.run`,
      };
    }
    if (opts.commandId === "macro.run") {
      const target = String(resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables) ?? "");
      const nested = opts.config.macros.find((m) => m.id === target || m.label === target);
      if (!nested) return { ok: false, message: "Unknown macro" };
      return runMacro({ ...opts, macro: nested, vars: opts.vars ?? {}, depth: (opts.depth ?? 0) + 1, stack: opts.stack ?? [] });
    }
    if (opts.commandId.startsWith("occupancy.")) {
      const { applyOccupancy } = await import("./peer-payload");
      return applyOccupancy(opts.config, (opts.vars ?? {}) as Record<string, string | number>, opts.commandId.slice("occupancy.".length));
    }
    const host = opts.host ?? { dim: false, locked: false, toast: null, pageId: null };
    const resolved = resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables);
    const result = await applyHost(opts.commandId, resolved, host, opts.vars);
    if (opts.host) Object.assign(opts.host, host);
    if (opts.commandId === "var.set") {
      const raw = String(resolved ?? "");
      const eq = raw.indexOf("=");
      if (eq >= 0 && raw.slice(0, eq).trim() === "occupancy") {
        const { applyOccupancy } = await import("./peer-payload");
        applyOccupancy(opts.config, (opts.vars ?? {}) as Record<string, string | number>, raw.slice(eq + 1));
      }
    }
    return result;
  }
  const slot = (opts.state[device.id] ??= {});
  if (!opts.raw && !guardOk(command.requires, slot, opts.vars ?? {})) return { ok: false, message: `Blocked: ${command.requires?.join(", ")}` };
  const uiValue = resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables);
  const value = mapCommandValue(command, uiValue);
  if (device.simulate) {
    applySim(command, uiValue, slot);
    return { ok: true, message: "simulated" };
  }
  const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
  const wired = wireThroughInterface(device, iface);
  const ctx = { host: wired.host, port: wired.port ?? driver.transports.lan?.port, id: device.id, vars: opts.vars };
  let payloadTemplate = command.payload;
  if (command.gatewayOp) {
    const tpl = gatewayIoTemplate(iface?.vendor, command.gatewayOp);
    if (!tpl) return { ok: false, message: `Gateway has no ${command.gatewayOp}` };
    const lineKey = command.gatewayLine || "line";
    const line = wired.auth?.[lineKey] || wired.auth?.line || "";
    if (!line) return { ok: false, message: `Set ${lineKey}` };
    payloadTemplate = tpl.replaceAll("{line}", line);
  }
  let payload = renderPayload(payloadTemplate, value, wired.auth, ctx);
  if (command.mtcSend) {
    const frames = command.mtcSend === "sysex" ? encodeMtcSysex(payload) : encodeMtcQf(payload);
    if (!frames) return { ok: false, message: "MTC time HH:MM:SS:FF" };
    payload = frames.toString("hex");
  }
  const path = command.httpPath ? renderPayload(command.httpPath, value, wired.auth, ctx) : command.httpPath;
  const wiredCommand = path ? { ...command, httpPath: path } : command;
  if (command.wake?.protocol === "wol") {
    const bind = roomLanBind(opts.config);
    if (!bind.ok) return bind;
    const wol = await sendWol(device.auth?.mac || "", wired.host, bind.localAddress);
    pushTrace(device.id, "note", wol.message);
    if (!payload && !path) return wol;
    if (!wol.ok && !payload) return wol;
    await sleep(driver.pacing?.powerOnDelayMs ?? 2500);
  }
  let result = usesLocalPort(iface) ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand, opts.config);
  if (!result.ok && command.wake?.protocol === "wol") {
    await sleep(2000);
    result = usesLocalPort(iface) ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand, opts.config);
  }
  if (result.ok) applySim(command, uiValue, slot);
  return result;
}

export async function runMacro(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  health?: DeviceHealth;
  macro: Macro;
  depth?: number;
  stack?: string[];
  host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null };
}): Promise<CommandResult> {
  const depth = opts.depth ?? 0;
  if (depth > 8) return { ok: false, message: "Macro nest limit" };
  const stack = opts.stack ?? [];
  if (stack.includes(opts.macro.id)) return { ok: false, message: "Macro loop" };
  const next = { ...opts, depth: depth + 1, stack: [...stack, opts.macro.id] };
  const tries = Math.max(1, opts.macro.retries + 1);
  let last: CommandResult = { ok: true, message: "empty" };
  for (let i = 0; i < tries; i++) {
    last = await runMacroOnce(next);
    if (last.ok) return last;
  }
  if (opts.macro.onFail.kind === "macro" && opts.macro.onFail.id) {
    const fallback = opts.config.macros.find((m) => m.id === opts.macro.onFail.id);
    if (fallback) return runMacro({ ...next, macro: fallback });
  }
  return last;
}

async function runMacroOnce(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  health?: DeviceHealth;
  macro: Macro;
  depth?: number;
  stack?: string[];
}): Promise<CommandResult> {
  for (const step of opts.macro.steps) {
    if (step.macroId) {
      if (step.macroId === NONE_MACRO_ID) {
        if (step.delayMsAfter) await sleep(step.delayMsAfter);
        continue;
      }
      const nested = opts.config.macros.find((m) => m.id === step.macroId);
      if (!nested) return { ok: false, message: "Unknown macro" };
      const result = await runMacro({ ...opts, macro: nested });
      if (!result.ok) return result;
      if (step.delayMsAfter) await sleep(step.delayMsAfter);
      continue;
    }
    if (step.setVar) {
      const def = opts.config.variables.find((v) => v.id === step.setVar);
      const resolved = resolveTemplate(step.value, opts.vars, opts.config.variables);
      opts.vars[step.setVar] = def ? clampVar(def, resolved ?? def.default) : (resolved ?? "");
      if (step.setVar === "occupancy") {
        const { applyOccupancy } = await import("./peer-payload");
        applyOccupancy(opts.config, opts.vars, String(opts.vars[step.setVar]));
      }
      if (def?.pushDevice && def.pushCommand) {
        await executeCommand({ ...opts, deviceId: def.pushDevice, commandId: def.pushCommand, value: opts.vars[step.setVar] });
      }
      if (step.delayMsAfter) await sleep(step.delayMsAfter);
      continue;
    }
    if (step.interfaceId) {
      const payload = String(resolveTemplate(step.value, opts.vars, opts.config.variables) ?? "");
      const result = await sendGatewayRaw({ config: opts.config, interfaceId: step.interfaceId, payload });
      if (!result.ok) return result;
      if (step.delayMsAfter) await sleep(step.delayMsAfter);
      continue;
    }
    if (!step.device || !step.command) continue;
    if (!step.raw && step.skipIf) {
      const cur = String(opts.state[step.device]?.[step.skipIf.feedback] ?? opts.vars[step.skipIf.feedback] ?? "");
      if (cur.trim().toLowerCase() === String(step.skipIf.equals).trim().toLowerCase()) {
        if (step.delayMsAfter) await sleep(step.delayMsAfter);
        continue;
      }
    }
    const result = await executeCommand({ ...opts, deviceId: step.device, commandId: step.command, value: step.value, raw: step.raw });
    if (!result.ok) return result;
    if (step.delayMsAfter) await sleep(step.delayMsAfter);
  }
  return { ok: true, message: "ok" };
}
