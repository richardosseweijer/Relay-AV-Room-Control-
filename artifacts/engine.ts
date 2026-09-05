import type {
  CommandResult,
  DeviceHealth,
  DeviceInstance,
  DeviceStateMap,
  DriverCommand,
  DriverSpec,
  Macro,
  RoomConfig,
} from "./types";
import { applyMonitors, clampVar, resolveTemplate, type VarMap } from "./vars";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function applySim(command: DriverCommand, value: string | number | undefined, slot: Record<string, string | number | boolean>) {
  const id = command.id;
  if (id.endsWith(".on")) {
    const prefix = id.slice(0, -3);
    if (`${prefix}.state` in slot || true) slot[`${prefix}.state`] = "on";
    if (prefix === "power") slot["power.state"] = "on";
    if (id === "mute.on") slot["mute.state"] = "on";
    if (id === "lights" || prefix === "power") {
      /* keep */
    }
  }
  if (id.endsWith(".off")) {
    const prefix = id.slice(0, -4);
    slot[`${prefix}.state`] = "off";
    if (prefix === "power") slot["power.state"] = "off";
    if (id === "mute.off") slot["mute.state"] = "off";
  }
  if (command.kind === "range" && value !== undefined) {
    if (id === "volume.set") slot["volume.level"] = Number(value);
    else if (id === "level.set") {
      slot["level.value"] = Number(value);
      slot["power.state"] = Number(value) > 0 ? "on" : "off";
    } else if (id === "position.set") slot["position.level"] = Number(value);
    else slot[id] = Number(value);
  }
  if (id === "position.open") slot["position.level"] = 100;
  if (id === "position.close") slot["position.level"] = 0;
  if (id.startsWith("input.")) slot["input.current"] = id.split(".")[1] ?? "";
  if (id.startsWith("source.")) slot["source.current"] = id.split(".")[1] ?? "";
  if (id.startsWith("scene.")) {
    slot["scene.current"] = id.split(".")[1] ?? "";
    slot["power.state"] = "on";
    if (id === "scene.movie") slot["level.value"] = 18;
    if (id === "scene.present") slot["level.value"] = 85;
  }
  if (id.startsWith("preset.")) slot["preset.current"] = id.split(".")[1] ?? "";
}

function renderPayload(template: string, value?: string | number, auth: Record<string, string> = {}) {
  let out = template.replaceAll("{value}", String(value ?? ""));
  out = out.replaceAll("{value:ascii}", String(value ?? ""));
  if (out.includes("{value:hex2}")) {
    const n = Number(value ?? 0);
    const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    out = out.replaceAll("{value:hex2}", hex);
  }
  for (const [k, v] of Object.entries(auth)) {
    out = out.replaceAll(`{auth.${k}}`, v);
  }
  return out;
}

async function sendLan(driver: DriverSpec, device: DeviceInstance, payload: string, command?: DriverCommand): Promise<CommandResult> {
  const lan = driver.transports.lan;
  if (!lan) return { ok: false, message: "No LAN transport on this driver" };
  if (device.transport === "rs232") {
    return { ok: false, message: "RS-232 is stubbed for a later hardware release" };
  }
  const timeout = lan.timeoutMs ?? 1000;
  const port = device.port || lan.port;
  if (lan.protocol === "http") {
    return sendHttp(driver, device, payload, timeout, port, command);
  }
  if (lan.protocol === "tcp") {
    try {
      const net = await import("node:net");
      const text = await new Promise<string>((resolve, reject) => {
        const sock = net.connect({ host: device.host, port });
        let buf = "";
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error("TCP timeout"));
        }, timeout);
        sock.on("connect", () => {
          sock.write(payload + (lan.lineEnding ?? "\r"));
        });
        sock.on("data", (d) => {
          buf += d.toString();
          if (buf.length > 0) {
            clearTimeout(timer);
            sock.end();
            resolve(buf);
          }
        });
        sock.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        sock.on("end", () => {
          clearTimeout(timer);
          resolve(buf);
        });
      });
      return { ok: true, message: text.slice(0, 200) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "TCP failed" };
    }
  }
  if (lan.protocol === "websocket") {
    return sendWebsocket(device, lan, payload, timeout, port, driver);
  }
  return { ok: false, message: `Protocol ${lan.protocol} not implemented in v1` };
}

async function sendHttp(
  driver: DriverSpec,
  device: DeviceInstance,
  payload: string,
  timeout: number,
  port: number,
  command?: DriverCommand,
): Promise<CommandResult> {
  const lan = driver.transports.lan!;
  const pairing = driver.auth?.pairing;
  const filled = (template: string) => renderPayload(template, undefined, {
    token: device.auth?.token || "",
    name: device.auth?.name || "Relay",
    group: device.auth?.group || "0",
    ...device.auth,
  });

  if (pairing?.kind === "http-handshake" && !device.auth?.token) {
    const pairPath = pairing.path || "/api";
    const url = `http://${device.host}:${port}${pairPath}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload.trim() || "{\"devicetype\":\"relay#room\"}",
        signal: ctrl.signal,
      });
      const text = await res.text();
      const tokenKey = pairing.tokenJsonPath || "username";
      const token = text.match(new RegExp(`"${tokenKey}"\\s*:\\s*"([^"]+)"`))?.[1];
      if (token) return { ok: true, message: `Paired. Token stored.`, pairedToken: token };
      if (/link button|101/i.test(text)) {
        return { ok: false, message: pairing.userPrompt || "Press the link button on the bridge, then Probe again." };
      }
      return { ok: false, message: text.slice(0, 200) || pairing.userPrompt || "Pairing failed" };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "HTTP pairing failed" };
    } finally {
      clearTimeout(t);
    }
  }

  const path = filled(command?.httpPath || pairing?.path || lan.http?.path || "/");
  const method = (command?.httpMethod || lan.http?.method || "PUT").toUpperCase();
  const url = `http://${device.host}:${port}${!command && device.auth?.token && pairing?.kind === "http-handshake"
    ? filled("/api/{auth.token}/config")
    : path}`;
  const verb = !command && device.auth?.token ? "GET" : method;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: verb,
      headers: { "content-type": lan.http?.contentType ?? "application/json", ...(lan.http?.headers ?? {}) },
      body: verb === "GET" || verb === "HEAD" ? undefined : filled(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (/unauthorized|invalid username|101/i.test(text)) {
      return { ok: false, message: pairing?.userPrompt || "Auth failed. Pair again and save the token." };
    }
    return { ok: res.ok, message: text.slice(0, 200) || res.statusText };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "LAN request failed" };
  } finally {
    clearTimeout(t);
  }
}

async function sendWebsocket(
  device: DeviceInstance,
  lan: NonNullable<DriverSpec["transports"]["lan"]>,
  payload: string,
  timeout: number,
  port: number,
  driver: DriverSpec,
): Promise<CommandResult> {
  const pairing = driver.auth?.pairing;
  const name = Buffer.from(device.auth?.name || "Relay").toString("base64");
  const token = device.auth?.token;
  const path = pairing?.path || lan.http?.path || "/";
  const nameParam = pairing?.query?.nameParam || "name";
  const tokenParam = pairing?.query?.tokenParam || "token";
  const query = token
    ? `${nameParam}=${name}&${tokenParam}=${encodeURIComponent(token)}`
    : `${nameParam}=${name}`;
  const ports = pairing?.ports?.length ? pairing.ports : [port];
  const walk = !payload.trim() && !token;
  const preferred = walk
    ? [...ports.filter((p) => !(pairing?.tlsPorts ?? [8002]).includes(p)), ...ports.filter((p) => (pairing?.tlsPorts ?? [8002]).includes(p))]
    : [port];
  const tryPorts = [...new Set([...(walk ? preferred : [port]), ...(!walk ? [] : ports)])];
  const discover = pairing?.discoverPath;

  let httpProbe: CommandResult = { ok: false, message: "" };
  if (discover) {
    httpProbe = await probeHttpPorts(device.host, tryPorts, discover, timeout);
    if (!payload.trim() && httpProbe.ok && pairing?.kind === "http-probe") return httpProbe;
  }

  let last: CommandResult = httpProbe;
  for (const p of tryPorts) {
    const secure = pairing?.tlsPorts?.includes(p) ?? p === 8002;
    last = await openPairedSocket({
      device,
      urlPath: path,
      query,
      payload,
      timeout,
      port: p,
      secure,
      waitContains: pairing?.waitContains,
      commandAck: pairing?.commandAck ?? "none",
      tokenJsonPath: pairing?.tokenJsonPath,
      prompt: pairing?.userPrompt,
      httpProbe,
    });
    if (last.ok) return last;
  }
  return last;
}

async function probeHttpPorts(host: string, ports: number[], path: string, timeout: number): Promise<CommandResult> {
  const notes: string[] = [];
  for (const p of ports) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeout, 2000));
    try {
      const res = await fetch(`http://${host}:${p}${path}`, { signal: ctrl.signal });
      const text = await res.text();
      if (res.ok) return { ok: true, message: `HTTP ${p} answered: ${text.slice(0, 120)}` };
      notes.push(`${p}=${res.status}`);
    } catch (err) {
      notes.push(`${p}=${err instanceof Error ? err.message : "fail"}`);
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, message: `No HTTP API at ${host} (${notes.join("; ")}). Device must be on and reachable.` };
}

async function openPairedSocket(opts: {
  device: DeviceInstance;
  urlPath: string;
  query: string;
  payload: string;
  timeout: number;
  port: number;
  secure: boolean;
  waitContains?: string;
  commandAck?: "none" | "message";
  tokenJsonPath?: string;
  prompt?: string;
  httpProbe: CommandResult;
}): Promise<CommandResult> {
  const url = `${opts.secure ? "wss" : "ws"}://${opts.device.host}:${opts.port}${opts.urlPath}?${opts.query}`;
  return sendWebsocketRaw(opts.device.host, opts.port, opts.urlPath, opts.query, opts.payload, Math.max(opts.timeout, 15000), opts.secure, opts.httpProbe, opts.tokenJsonPath);
}

function extractPairToken(text: string, key = "token") {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "i"),
    /"token"\s*:\s*"([^"]+)"/i,
    /"authToken"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match[1].length > 4) return match[1];
  }
  return undefined;
}

function maskFrame(text: string) {
  const data = Buffer.from(text);
  const mask = Buffer.from([Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i]! ^ mask[i % 4]!;
  let header: Buffer;
  if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
  else header = Buffer.concat([Buffer.from([0x81, 0x80 | 126]), Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])]);
  return Buffer.concat([header, mask, masked]);
}

async function sendWebsocketRaw(
  host: string,
  port: number,
  path: string,
  query: string,
  payload: string,
  timeout: number,
  secure: boolean,
  httpProbe?: CommandResult,
  tokenKey?: string,
): Promise<CommandResult> {
  const net = await import("node:net");
  const tls = secure ? await import("node:tls") : null;
  const key = Buffer.from("relay-ws-key-1234567890ab").toString("base64");
  return new Promise((resolve) => {
    const sock = secure && tls
      ? tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let settled = false;
    const timer = setTimeout(() => finish(false, httpProbe?.ok
      ? "TV answered HTTP but not the remote socket. Accept Allow on the TV or try port 8002."
      : "WebSocket timeout. TV may be off or on a different network."), timeout);
    const finish = (ok: boolean, message: string, pairedToken?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ok, message, pairedToken, pairedPort: ok ? port : undefined });
    };
    sock.on("connect", () => {
      sock.write(
        `GET ${path}?${query} HTTP/1.1\r\nHost: ${host}:${port}\r\nOrigin: http://${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
      );
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const text = buf.toString("utf8");
        if (!text.includes("\r\n\r\n")) return;
        if (!/101/.test(text.slice(0, text.indexOf("\r\n")))) {
          finish(false, "TV did not upgrade the socket");
          return;
        }
        upgraded = true;
        const rest = text.slice(text.indexOf("\r\n\r\n") + 4);
        const token = extractPairToken(rest, tokenKey);
        if (payload.trim()) {
          sock.write(maskFrame(payload));
          setTimeout(() => finish(true, "sent", token), 400);
          return;
        }
        if (rest.includes("token") || rest.includes("ms.channel") || rest.includes("{")) {
          finish(true, token ? "Paired. Token stored." : rest.replace(/[^\x20-\x7E]/g, " ").slice(0, 200), token);
          return;
        }
        return;
      }
      const body = buf.toString("utf8");
      if (/unauthorized|forbidden/i.test(body)) {
        finish(false, "TV refused the socket. Accept Relay on the screen, or set the pairing token.");
        return;
      }
      const token = extractPairToken(body, tokenKey);
      finish(true, token ? "Paired. Token stored." : body.replace(/[^\x20-\x7E]/g, " ").slice(-200) || "sent", token);
    });
    sock.on("error", (err) => finish(false, err.message));
    sock.on("end", () => finish(upgraded, upgraded ? "socket closed" : "no reply"));
  });
}

export function commandById(driver: DriverSpec, id: string) {
  return driver.commands.find((c) => c.id === id);
}

export function featureAllowed(device: DeviceInstance, featureId: string) {
  return device.enabledFeatures.includes(featureId);
}

function guardOk(requires: string[] | undefined, slot: Record<string, string | number | boolean>) {
  if (!requires?.length) return true;
  return requires.every((rule) => {
    const [key, val] = rule.split("=");
    if (!key) return true;
    if (val === undefined) return true;
    return String(slot[key] ?? "") === val;
  });
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
}): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const fault = opts.health?.[device.id];
  if (fault && !fault.ok) return { ok: false, message: `${device.name} is flagged in error — ${fault.message}` };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "Driver missing" };
  if (!featureAllowed(device, opts.commandId)) return { ok: false, message: "Feature not enabled" };
  const command = commandById(driver, opts.commandId);
  if (!command) return { ok: false, message: "Unknown command" };
  const slot = (opts.state[device.id] ??= {});
  if (!guardOk(command.requires, slot)) {
    return { ok: false, message: `Blocked: ${command.requires?.join(", ")}` };
  }
  const value = resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables);
  if (device.simulate) {
    const delay = Math.min(driver.pacing?.minIntervalMs ?? 80, 400);
    await sleep(delay);
    applySim(command, value, slot);
    applyMonitors(opts.config, opts.state, opts.vars ?? {});
    return { ok: true, message: "simulated" };
  }
  const payload = renderPayload(command.payload, value, device.auth);
  const result = await sendLan(driver, device, payload, command);
  if (result.ok) {
    applySim(command, value, slot);
    applyMonitors(opts.config, opts.state, opts.vars ?? {});
  }
  return result;
}

export async function runMacro(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: VarMap;
  health?: DeviceHealth;
  macro: Macro;
}): Promise<CommandResult> {
  const attempts = Math.max(0, opts.macro.retries) + 1;
  let last: CommandResult = { ok: false, message: "empty macro" };
  for (let i = 0; i < attempts; i++) {
    last = await runMacroOnce(opts);
    if (last.ok) {
      applyMonitors(opts.config, opts.state, opts.vars);
      return last;
    }
  }
  if (opts.macro.onFail.kind === "macro" && opts.macro.onFail.id) {
    const fallback = opts.config.macros.find((m) => m.id === opts.macro.onFail.id);
    if (fallback && fallback.id !== opts.macro.id) {
      return runMacro({ ...opts, macro: fallback });
    }
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
}): Promise<CommandResult> {
  for (const step of opts.macro.steps) {
    if (step.setVar) {
      const def = opts.config.variables.find((v) => v.id === step.setVar);
      const resolved = resolveTemplate(step.value, opts.vars, opts.config.variables);
      opts.vars[step.setVar] = def ? clampVar(def, resolved ?? def.default) : (resolved ?? "");
      if (step.delayMsAfter) await sleep(step.delayMsAfter);
      continue;
    }
    if (!step.device || !step.command) continue;
    const slot = opts.state[step.device] ?? {};
    if (step.skipIf && String(slot[step.skipIf.feedback] ?? "") === step.skipIf.equals) {
      continue;
    }
    const result = await executeCommand({
      config: opts.config,
      drivers: opts.drivers,
      state: opts.state,
      vars: opts.vars,
      health: opts.health,
      deviceId: step.device,
      commandId: step.command,
      value: step.value,
    });
    if (opts.health && step.device) {
      opts.health[step.device] = { ok: result.ok, message: result.message };
    }
    if (!result.ok) return { ok: false, message: `${step.device}.${step.command}: ${result.message}` };
    if (step.delayMsAfter) await sleep(step.delayMsAfter);
  }
  return { ok: true, message: "ok" };
}

export async function authenticateDevice(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  deviceId: string;
  host?: string;
}): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const live = { ...device, host: opts.host ?? device.host, simulate: false };
  const driver = opts.drivers[live.driver];
  if (!driver?.auth?.pairing) return { ok: false, message: "This driver has no authenticate step" };
  if (driver.auth.pairing.kind === "http-handshake") {
    return sendLan(driver, live, driver.probe?.payload ?? "{\"devicetype\":\"relay#room\"}");
  }
  const first = await sendLan(driver, live, "");
  if (first.pairedToken) return first;
  await sleep(1500);
  const second = await sendLan(driver, live, "");
  if (second.pairedToken) return second;
  if (first.ok || second.ok) {
    return {
      ok: true,
      message: "Authenticate finished. This TV did not return a token — that is normal on some Q65T units. Do not click Authenticate again unless the TV forgot Relay.",
      pairedPort: second.pairedPort ?? first.pairedPort,
    };
  }
  return {
    ok: false,
    message: `${second.message || first.message} Look at the TV and tap Allow while Authenticate is running (about 15 seconds).`,
  };
}

export async function pingReachable(opts: {
  host: string;
  port?: number;
  path?: string;
  timeoutMs?: number;
}): Promise<CommandResult> {
  const host = opts.host.trim();
  if (!host) return { ok: false, message: "No host" };
  const port = opts.port || 80;
  const path = opts.path || "/";
  const timeout = Math.min(opts.timeoutMs ?? 800, 1200);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`http://${host}:${port}${path}`, { method: "GET", signal: ctrl.signal });
    return { ok: true, message: `HTTP ${res.status}` };
  } catch {
    try {
      const net = await import("node:net");
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host, port });
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error("timeout"));
        }, timeout);
        sock.on("connect", () => {
          clearTimeout(timer);
          sock.destroy();
          resolve();
        });
        sock.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return { ok: true, message: `TCP ${port} open` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "unreachable" };
    }
  } finally {
    clearTimeout(t);
  }
}

export async function probeDevice(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  deviceId: string;
  host?: string;
  simulate?: boolean;
}): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const live = {
    ...device,
    host: opts.host ?? device.host,
    simulate: opts.simulate ?? device.simulate,
  };
  const driver = opts.drivers[live.driver];
  if (!driver) return { ok: false, message: "Driver missing" };
  if (live.simulate) return { ok: true, message: "Simulation only — not a live check" };
  if (driver.auth?.pairing?.kind === "websocket-handshake") {
    return pingReachable({
      host: live.host,
      port: live.port || driver.transports.lan?.port || 8001,
      path: driver.auth.pairing.discoverPath || "/api/v2/",
      timeoutMs: 800,
    });
  }
  if (!driver.probe) return { ok: false, message: "No probe defined on this driver" };
  return sendLan(driver, live, driver.probe.payload);
}

export async function readMonitorValue(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  deviceId: string;
  feedbackId: string;
}): Promise<{ ok: boolean; value: string; message: string }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, value: "", message: "Unknown device" };
  const slot = opts.state[device.id] ?? {};
  const current = slot[opts.feedbackId];
  if (device.simulate) {
    return { ok: true, value: current === undefined ? "" : String(current), message: "sim" };
  }
  const driver = opts.drivers[device.driver];
  const fb = driver?.feedback.find((item) => item.id === opts.feedbackId);
  if (!driver || !fb) return { ok: false, value: "", message: "Feedback missing" };
  if (driver.auth?.pairing?.kind === "websocket-handshake" || driver.auth?.pairing?.kind === "http-handshake") {
    return { ok: true, value: current === undefined ? "" : String(current), message: "no control-socket poll" };
  }
  const payload = fb.query ?? driver.probe?.payload;
  if (!payload) return { ok: current !== undefined, value: current === undefined ? "" : String(current), message: "no query" };
  const result = await sendLan(driver, device, payload);
  if (!result.ok) return { ok: false, value: "", message: result.message };
  const parsed = parseFeedback(fb.parse, result.message);
  return { ok: true, value: parsed, message: result.message };
}

function parseFeedback(rule: DriverSpec["feedback"][number]["parse"] | undefined, raw: string): string {
  if (!rule) return raw.trim();
  if (rule.type === "contains") return raw.includes(rule.value ?? "") ? (rule.map ? Object.values(rule.map)[0] ?? raw : raw) : raw;
  if (rule.type === "exact") return raw.trim() === (rule.value ?? "") ? raw.trim() : raw.trim();
  if (rule.type === "regex" && rule.pattern) {
    const match = raw.match(new RegExp(rule.pattern));
    const token = match?.[1] ?? match?.[0] ?? raw;
    return rule.map?.[token] ?? token;
  }
  return raw.trim();
}
