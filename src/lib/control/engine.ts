import type {
  CommandResult,
  DeviceHealth,
  DeviceInstance,
  DeviceInventory,
  DeviceStateMap,
  DriverCommand,
  DriverSpec,
  InventoryItem,
  Macro,
  RoomConfig,
  TraceLine,
} from "./types";
import { inferPairingSteps } from "./schema";
import { applyMonitors, clampVar, resolveTemplate, type VarMap } from "./vars";

const g = globalThis as typeof globalThis & { __relayTraces__?: Record<string, TraceLine[]> };

export function traces(): Record<string, TraceLine[]> {
  if (!g.__relayTraces__) g.__relayTraces__ = {};
  return g.__relayTraces__;
}

export function pushTrace(deviceId: string, dir: TraceLine["dir"], text: string) {
  const bag = traces();
  const list = bag[deviceId] ?? (bag[deviceId] = []);
  list.unshift({ at: Date.now(), dir, text: text.slice(0, 500) });
  if (list.length > 40) list.length = 40;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickJsonField(raw: string, path: string): string | undefined {
  const named = raw.match(/"displayName"\s*:\s*"([^"]+)"/)?.[1];
  if (path.toLowerCase().includes("displayname") && named) return named;
  try {
    const start = raw.indexOf("{");
    const json = start >= 0 ? raw.slice(start) : raw;
    let cur: unknown = JSON.parse(json);
    for (const key of path.split(".")) {
      if (Array.isArray(cur)) {
        const i = Number(key);
        cur = Number.isFinite(i) ? cur[i] : cur[0];
        continue;
      }
      if (!cur || typeof cur !== "object") return undefined;
      const rec = cur as Record<string, unknown>;
      const hit = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
      if (!hit) return undefined;
      cur = rec[hit];
    }
    return cur === undefined || cur === null ? undefined : String(cur);
  } catch {
    return named;
  }
}

function mapCommandValue(command: DriverCommand, raw: string | number | undefined) {
  const spec = command.valueMap;
  if (!spec || raw === undefined || spec.kind === "text") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const inMin = spec.inMin ?? command.min ?? 0;
  const inMax = spec.inMax ?? command.max ?? 100;
  const outMin = spec.outMin ?? 0;
  const outMax = spec.outMax ?? 1;
  const t = inMax === inMin ? 0 : (n - inMin) / (inMax - inMin);
  const out = outMin + Math.min(1, Math.max(0, t)) * (outMax - outMin);
  if (spec.kind === "int") {
    const rounded = Math.round(out);
    if (spec.hexBytes && spec.hexBytes > 0) return rounded.toString(16).padStart(spec.hexBytes * 2, "0");
    return rounded;
  }
  return Number(out.toFixed(spec.decimals ?? 3));
}

function renderPayload(template: string, value?: string | number, auth: Record<string, string> = {}) {
  const raw = String(value ?? "");
  const n = Number(value);
  const hex2 = Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0") : raw;
  const n14 = Number.isFinite(n) ? Math.max(0, Math.min(16383, Math.round(n))) : 0;
  const nrpn = `${((n14 >> 7) & 0x7f).toString(16).padStart(2, "0")}${(n14 & 0x7f).toString(16).padStart(2, "0")}`;
  const channel = auth.midiChannel || auth.channel || "1";
  const ch = Math.max(1, Math.min(16, Number(channel) || 1));
  let out = template
    .replaceAll("{value:hex2}", hex2)
    .replaceAll("{value:nrpn14}", nrpn)
    .replaceAll("{midiChannel}", String(ch))
    .replaceAll("{channel}", String(ch))
    .replaceAll("{value}", raw);
  for (const [k, v] of Object.entries(auth)) out = out.replaceAll(`{auth.${k}}`, v);
  return out;
}

function applySim(command: DriverCommand, value: string | number | undefined, slot: Record<string, string | number | boolean>) {
  const id = command.id;
  if (id.endsWith(".on")) slot[`${id.slice(0, -3)}.state`] = "on";
  if (id.endsWith(".off")) slot[`${id.slice(0, -4)}.state`] = "off";
  if (id.startsWith("power.")) slot["power.state"] = id.includes("off") ? "off" : "on";
  if (command.kind === "range" && value !== undefined) slot[id === "volume.set" ? "volume.level" : id] = Number(value);
  if (id.startsWith("input.")) slot["input.current"] = id.split(".")[1] ?? "";
}

function guardOk(requires: string[] | undefined, slot: Record<string, string | number | boolean>, vars: VarMap = {}) {
  if (!requires?.length) return true;
  return requires.every((rule) => {
    const [key, want] = rule.split("=");
    const have = String(slot[key ?? ""] ?? vars[key ?? ""] ?? "").trim().toLowerCase();
    return have === String(want ?? "").trim().toLowerCase();
  });
}

async function runToolStdin(cmd: string, args: string[], stdin: string, timeout = 2000): Promise<CommandResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${cmd} timeout` }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `${cmd} ${code}` }); });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

async function runTool(cmd: string, args: string[], timeout = 2000): Promise<CommandResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${cmd} timeout` }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `${cmd} ${code}` }); });
  });
}

export type HostPort = { kind: string; path: string; label: string };

export async function listHostInterfaces(): Promise<{ ok: boolean; message: string; ports: HostPort[] }> {
  const ports: HostPort[] = [];
  const seen = new Set<string>();
  const add = (kind: string, path: string, label?: string) => {
    const key = `${kind}:${path}`;
    if (!path || seen.has(key)) return;
    seen.add(key);
    ports.push({ kind, path, label: label || path });
  };
  const win = process.platform === "win32";
  try {
    if (win) {
      const { execFile } = await import("node:child_process");
      const raw = await new Promise<string>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames()"], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of raw.split(/\r?\n/)) {
        const name = line.trim();
        if (/^COM\d+$/i.test(name)) add("serial", name.toUpperCase(), name.toUpperCase());
      }
      const cim = await new Promise<string>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_SerialPort | ForEach-Object { $_.DeviceID + '|' + $_.Name }"], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of cim.split(/\r?\n/)) {
        const [id, name] = line.split("|");
        if (id && /^COM\d+/i.test(id.trim())) add("serial", id.trim().toUpperCase(), (name || id).trim());
      }
    } else {
      const fs = await import("node:fs/promises");
      const names = await fs.readdir("/dev").catch(() => [] as string[]);
      for (const name of names) {
        if (/^tty(USB|ACM|AMA|S)\d+$/i.test(name)) add("serial", `/dev/${name}`);
        if (/^gpiochip\d+$/i.test(name)) add("gpio", `/dev/${name}`, name);
        if (/^i2c-\d+$/i.test(name)) add("i2c", `/dev/${name}`, name);
        if (/^spidev\d+\.\d+$/i.test(name)) add("spi", `/dev/${name}`);
        if (/^cec\d+$/i.test(name)) add("cec", `/dev/${name}`);
        if (/^lirc\d+$/i.test(name)) add("ir", `/dev/${name}`);
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "scan failed", ports };
  }
  if (!ports.length) {
    if (win) {
      for (let i = 1; i <= 8; i++) add("serial", `COM${i}`, `COM${i} (not detected)`);
    } else {
      add("serial", "/dev/ttyUSB0", "/dev/ttyUSB0 (not detected)");
      add("serial", "/dev/ttyACM0", "/dev/ttyACM0 (not detected)");
      add("gpio", "/dev/gpiochip0", "gpiochip0 (not detected)");
    }
  }
  return { ok: true, message: `${ports.length} found`, ports };
}

async function sendLocal(driver: DriverSpec, device: DeviceInstance, payload: string): Promise<CommandResult> {
  const local = driver.transports.local;
  const serial = driver.transports.rs232;
  const kind = device.auth?.ifaceKind || local?.kind || (device.transport === "rs232" || serial ? "serial" : null);
  if (!kind) return { ok: false, message: "No local transport on this driver" };
  const path = device.interface || device.host || local?.path || "COM1";
  pushTrace(device.id, "tx", `${kind} ${path} ${payload.slice(0, 80)}`);
  if (kind === "gpio") {
    const line = Number(device.auth?.pin ?? device.port ?? local?.line ?? 0);
    const chip = device.auth?.chip || local?.chip || "gpiochip0";
    const level = /off|low|0/i.test(payload) ? "0" : /on|high|1/i.test(payload) ? "1" : payload.trim();
    return runTool("gpioset", [chip, `${line}=${level}`], local?.timeoutMs ?? 1500);
  }
  if (kind === "serial") {
    try {
      const fs = await import("node:fs/promises");
      const target = path.startsWith("COM") ? `\\\\.\\${path}` : path;
      await fs.writeFile(target, payload + (serial?.lineEnding ?? "\r"));
      return { ok: true, message: target };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "serial failed" };
    }
  }
  if (kind === "i2c") {
    return runTool("i2cset", ["-y", String(device.bus ?? local?.bus ?? 1), device.address || local?.address || "0x3c", ...payload.trim().split(/\s+/)]);
  }
  if (kind === "ir") {
    const remote = device.auth?.remote || "relay";
    if (/^[a-z0-9]+:/i.test(payload.trim())) {
      return runTool("ir-ctl", ["-d", path === "COM1" ? "/dev/lirc0" : path, `--scancode=${payload.trim()}`], local?.timeoutMs ?? 2000);
    }
    return runTool("irsend", ["SEND_ONCE", remote, payload.trim()], local?.timeoutMs ?? 2000);
  }
  if (kind === "cec") {
    const args = ["-s", "-d", "1"];
    if (path && path !== "COM1") args.unshift("-p", path);
    return runToolStdin("cec-client", args, `${payload.trim()}\n`, local?.timeoutMs ?? 4000);
  }
  return runTool("spidev_test", ["-D", path || "/dev/spidev0.0", "-p", payload]);
}

function encodeWire(payload: string, encoding: string | undefined, lineEnding?: string) {
  const ending = lineEnding === undefined ? "" : lineEnding.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  if (encoding === "hex") {
    const hex = payload.replace(/[^0-9a-f]/gi, "");
    if (hex.length % 2) return Buffer.from(payload);
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(`${payload}${ending}`, "utf8");
}

async function tcpWrite(host: string, port: number, payload: Buffer, timeout: number): Promise<CommandResult> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: "timeout" }); }, timeout);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    sock.on("connect", () => { sock.write(payload); setTimeout(() => sock.end(), 80); });
    sock.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    sock.on("close", () => { clearTimeout(timer); resolve({ ok: true, message: buf.toString("utf8").slice(0, 300) || "ok" }); });
  });
}

type SessionSock = { sock: import("node:net").Socket; timer?: ReturnType<typeof setTimeout>; ready: Promise<void> };
const sessions = ((globalThis as typeof globalThis & { __relayTcp__?: Map<string, SessionSock> }).__relayTcp__ ??= new Map());

async function tcpSessionWrite(
  key: string,
  host: string,
  port: number,
  payload: Buffer,
  session: NonNullable<NonNullable<DriverSpec["transports"]["lan"]>["session"]>,
  auth: Record<string, string>,
  timeout: number,
): Promise<CommandResult> {
  const net = await import("node:net");
  let row = sessions.get(key);
  if (!row || row.sock.destroyed) {
    const sock = net.connect({ host, port });
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d) => { buf += d.toString(); });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("login timeout")), timeout);
      sock.once("error", reject);
      sock.once("connect", async () => {
        try {
          const waitFor = async (token?: string) => {
            if (!token) return;
            const start = Date.now();
            while (!buf.toLowerCase().includes(token.toLowerCase())) {
              if (Date.now() - start > timeout) throw new Error(`no ${token}`);
              await sleep(50);
            }
          };
          await waitFor(session.loginPrompt);
          const user = auth[session.usernameFrom || "user"] || auth.user || "";
          if (user) sock.write(`${user}\r`);
          await waitFor(session.passwordPrompt);
          const pass = auth[session.passwordFrom || "password"] || auth.password || "";
          if (pass) sock.write(`${pass}\r`);
          await waitFor(session.readyContains);
          clearTimeout(timer);
          resolve();
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
    row = { sock, ready };
    sessions.set(key, row);
  }
  try {
    await row.ready;
    let reply = "";
    const onData = (d: Buffer | string) => { reply += d.toString(); };
    row.sock.on("data", onData);
    row.sock.write(payload);
    await sleep(120);
    row.sock.off("data", onData);
    if (row.timer) clearTimeout(row.timer);
    row.timer = setTimeout(() => {
      row?.sock.destroy();
      sessions.delete(key);
    }, session.keepMs ?? 15000);
    return { ok: true, message: reply.slice(0, 300) || "ok" };
  } catch (err) {
    row.sock.destroy();
    sessions.delete(key);
    return { ok: false, message: err instanceof Error ? err.message : "session failed" };
  }
}

async function sendHttp(url: string, method: string, body: string, timeout: number): Promise<CommandResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { method, body: method === "GET" ? undefined : body, headers: { "content-type": "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    return { ok: res.ok, message: (await res.text()).slice(0, 400) || String(res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "http failed" };
  }
}

function maskWsFrame(text: string) {
  const data = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length]) : Buffer.concat([Buffer.from([0x81, 0xfe]), Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])]);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

function decodeWsText(buf: Buffer) {
  if (buf.length < 2) return "";
  const len = buf[1]! & 0x7f;
  const start = len === 126 ? 4 : 2;
  return buf.slice(start).toString("utf8").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

const keepWs = ((globalThis as typeof globalThis & { __relayWs__?: Map<string, { sock: import("node:net").Socket; timer?: ReturnType<typeof setTimeout> }> }).__relayWs__ ??= new Map());

function bumpKeep(key: string, sock: import("node:net").Socket, ms = 20000) {
  const row = keepWs.get(key) ?? { sock };
  if (row.timer) clearTimeout(row.timer);
  row.sock = sock;
  row.timer = setTimeout(() => {
    sock.destroy();
    keepWs.delete(key);
  }, ms);
  keepWs.set(key, row);
}

async function sendControlSocket(opts: { host: string; port: number; path: string; payload: string; timeout: number; tls: boolean }): Promise<CommandResult> {
  const key = `${opts.host}:${opts.port}:${opts.path.split("?")[0]}`;
  const live = keepWs.get(key);
  if (live && !live.sock.destroyed && opts.payload) {
    try {
      live.sock.write(maskWsFrame(opts.payload));
      bumpKeep(key, live.sock);
      return { ok: true, message: "key sent" };
    } catch {
      live.sock.destroy();
      keepWs.delete(key);
    }
  }
  const mod = opts.tls ? await import("node:tls") : await import("node:net");
  const cryptoKey = (await import("node:crypto")).randomBytes(16).toString("base64");
  const req = `GET ${opts.path} HTTP/1.1\r\nHost: ${opts.host}:${opts.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${cryptoKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
  return new Promise((resolve) => {
    const sock = opts.tls
      ? (mod as typeof import("node:tls")).connect({ host: opts.host, port: opts.port, rejectUnauthorized: false })
      : (mod as typeof import("node:net")).connect({ host: opts.host, port: opts.port });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let sent = false;
    let token = "";
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: token ? `token ${token}` : "control timeout" }); }, opts.timeout);
    const finish = (ok: boolean, message: string) => {
      clearTimeout(timer);
      if (ok) bumpKeep(key, sock);
      else sock.end();
      resolve({ ok, message });
    };
    sock.on("error", (err) => { clearTimeout(timer); keepWs.delete(key); resolve({ ok: false, message: err.message }); });
    sock.on("connect", () => { if (!opts.tls) sock.write(req); });
    sock.on("secureConnect", () => sock.write(req));
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString("utf8");
      if (!upgraded) {
        if (!/101 Switching Protocols/i.test(text)) return;
        upgraded = true;
      }
      const body = text + decodeWsText(buf);
      const found = body.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
      if (found) token = found;
      if (/ms.channel.connect/i.test(body) && opts.payload && !sent) {
        sent = true;
        sock.write(maskWsFrame(opts.payload));
        finish(true, token ? `token ${token}` : "key sent");
        return;
      }
      if (/ms.channel.connect/i.test(body) && !opts.payload) {
        finish(Boolean(token), token ? `token ${token}` : "Accept Allow on the TV");
      }
    });
  });
}

async function sendSamsungKey(host: string, port: number, payload: string, token: string | undefined, timeout: number): Promise<CommandResult> {
  const name = Buffer.from("Relay").toString("base64");
  const q = token ? `name=${name}&token=${encodeURIComponent(token)}` : `name=${name}`;
  const path = `/api/v2/channels/samsung.remote.control?${q}`;
  const tls = port === 8002;
  return sendControlSocket({ host, port, path, payload, timeout, tls });
}

function statusPlane(driver: DriverSpec, device: DeviceInstance, feedback?: { httpPath?: string }) {
  if (driver.transports.lan?.protocol === "cast") return null;
  const path = feedback?.httpPath || driver.status?.path;
  if (!path) return null;
  const port = driver.status?.port ?? driver.auth?.pairing?.ports?.[0] ?? 8001;
  const proto = driver.status?.protocol ?? "http";
  return `${proto}://${device.host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
}

function extractCastApp(buf: Buffer): string | undefined {
  const text = buf.toString("utf8");
  return text.match(/"displayName"\s*:\s*"([^"]+)"/)?.[1];
}

const keepCast = ((globalThis as typeof globalThis & { __relayCast__?: Map<string, { sock: import("node:tls").TLSSocket; timer?: ReturnType<typeof setTimeout>; frame: (ns: string, body: string, dest?: string) => Buffer }> }).__relayCast__ ??= new Map());

async function sendCast(host: string, port: number, payload: string, timeout: number, namespace?: string): Promise<CommandResult> {
  const tls = await import("node:tls");
  let json = payload.trim().startsWith("{") ? payload.trim() : '{"type":"GET_STATUS","requestId":1}';
  if (!/"requestId"/.test(json)) json = json.replace(/\}$/, ',"requestId":1}');
  const frame = (ns: string, body: string, dest = "receiver-0") => {
    const parts: Buffer[] = [];
    const putVarint = (tag: number, n: number) => {
      const out = [tag];
      let v = n >>> 0;
      while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
      out.push(v);
      parts.push(Buffer.from(out));
    };
    const putBytes = (tag: number, data: Buffer) => {
      const head = [tag];
      let len = data.length;
      while (len > 0x7f) { head.push((len & 0x7f) | 0x80); len >>>= 7; }
      head.push(len);
      parts.push(Buffer.concat([Buffer.from(head), data]));
    };
    putVarint(8, 0);
    putBytes(18, Buffer.from("sender-0"));
    putBytes(26, Buffer.from(dest));
    putBytes(34, Buffer.from(ns));
    putVarint(40, 0);
    putBytes(50, Buffer.from(body));
    const proto = Buffer.concat(parts);
    const out = Buffer.alloc(4 + proto.length);
    out.writeUInt32BE(proto.length, 0);
    proto.copy(out, 4);
    return out;
  };
  const key = `${host}:${port}`;
  const live = keepCast.get(key);
  if (live && !live.sock.destroyed) {
    try {
      live.sock.write(live.frame("urn:x-cast:com.google.cast.tp.heartbeat", '{"type":"PING"}'));
      live.sock.write(live.frame(namespace || "urn:x-cast:com.google.cast.receiver", json));
      if (live.timer) clearTimeout(live.timer);
      live.timer = setTimeout(() => { live.sock.destroy(); keepCast.delete(key); }, 20000);
      if (!/"GET_STATUS"/.test(json)) return { ok: true, message: "sent" };
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, message: "Cast timeout" }), timeout);
        const onData = (chunk: Buffer) => {
          const app = extractCastApp(chunk);
          const raw = chunk.toString("utf8");
          if (app || /MEDIA_STATUS|RECEIVER_STATUS/i.test(raw)) {
            clearTimeout(timer);
            live.sock.off("data", onData);
            resolve({ ok: true, message: app ? `{"displayName":"${app}"}` : raw.slice(0, 240) });
          }
        };
        live.sock.on("data", onData);
      });
    } catch {
      live.sock.destroy();
      keepCast.delete(key);
    }
  }
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      const app = extractCastApp(buf);
      sock.destroy();
      resolve(app ? { ok: true, message: `{"displayName":"${app}"}` } : { ok: false, message: "Cast timeout" });
    }, timeout);
    sock.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    sock.on("secureConnect", () => {
      sock.write(frame("urn:x-cast:com.google.cast.tp.connection", '{"type":"CONNECT","origin":{}}'));
      sock.write(frame("urn:x-cast:com.google.cast.tp.heartbeat", '{"type":"PING"}'));
      keepCast.set(key, { sock, frame, timer: setTimeout(() => { sock.destroy(); keepCast.delete(key); }, 20000) });
      setTimeout(() => {
        sock.write(frame(namespace || "urn:x-cast:com.google.cast.receiver", json));
        if (!/"GET_STATUS"/.test(json)) {
          setTimeout(() => {
            clearTimeout(timer);
            sock.end();
            resolve({ ok: true, message: "sent" });
          }, 400);
        }
      }, 150);
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const raw = buf.toString("utf8");
      if (/"type"\s*:\s*"PONG"/i.test(raw) && !/MEDIA_STATUS|RECEIVER_STATUS|displayName/i.test(raw)) return;
      const app = extractCastApp(buf);
      if (app || /MEDIA_STATUS|RECEIVER_STATUS/i.test(raw)) {
        clearTimeout(timer);
        sock.end();
        resolve({ ok: true, message: app ? `{"displayName":"${app}"}` : raw.slice(0, 240) });
      }
    });
  });
}

function subnetBroadcast(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return "255.255.255.255";
  return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
}

async function sendWol(mac: string, host: string): Promise<CommandResult> {
  const clean = mac.replace(/[^0-9a-f]/gi, "");
  if (clean.length !== 12) return { ok: false, message: "Need the TV MAC in the mac field (wired MAC if the set is on Ethernet)" };
  const dgram = await import("node:dgram");
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  const macBuf = Buffer.from(clean, "hex");
  for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  const targets = [...new Set([host, subnetBroadcast(host), "255.255.255.255"].filter(Boolean))];
  const ports = [9, 7];
  try {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      sock.once("error", reject);
      sock.bind(0, "0.0.0.0", () => {
        try { sock.setBroadcast(true); } catch { /* ignore */ }
        resolve();
      });
    });
    for (let n = 0; n < 8; n++) {
      for (const dest of targets) {
        for (const port of ports) {
          await new Promise<void>((resolve) => sock.send(packet, port, dest, () => resolve()));
        }
      }
      await sleep(60);
    }
    sock.close();
    return { ok: true, message: `WOL ${clean} → ${targets.join(", ")}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "WOL failed" };
  }
}

async function sendLan(driver: DriverSpec, device: DeviceInstance, payload: string, command?: DriverCommand): Promise<CommandResult> {
  const lan = driver.transports.lan;
  if (!lan) return { ok: false, message: "No LAN transport on this driver" };
  const host = device.host;
  const port = device.port ?? lan.port;
  const timeout = lan.timeoutMs ?? 3000;
  pushTrace(device.id, "tx", `${command?.namespace ? command.namespace.split(".").pop() + " " : ""}${payload.slice(0, 160)}`);
  let result: CommandResult;
  const wire = encodeWire(payload, command?.payloadEncoding || lan.encoding, lan.lineEnding ?? (lan.protocol === "pjlink" ? "\r" : undefined));
  if (lan.protocol === "wol") result = await sendWol(device.auth?.mac || "", host);
  else if (lan.protocol === "cast") result = await sendCast(host, port, payload, timeout, command?.namespace);
  else if (lan.protocol === "http" || lan.protocol === "https") {
    const path = (command?.httpPath || lan.http?.path || "/").replace("{auth.token}", device.auth?.token ?? "");
    result = await sendHttp(`${lan.protocol}://${host}:${port}${path}`, command?.httpMethod || lan.http?.method || "GET", payload, timeout);
  } else if (lan.protocol === "websocket") result = await sendSamsungKey(host, port, payload, device.auth?.token, timeout);
  else if (lan.protocol === "udp") {
    const dgram = await import("node:dgram");
    result = await new Promise((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.send(wire, port, host, (err) => { sock.close(); resolve(err ? { ok: false, message: err.message } : { ok: true, message: "udp sent" }); });
    });
  } else if (lan.session) {
    result = await tcpSessionWrite(device.id, host, port, wire, lan.session, device.auth || {}, timeout);
  } else result = await tcpWrite(host, port, wire, timeout);
  pushTrace(device.id, result.ok ? "rx" : "note", result.message);
  return result;
}

export async function pingReachable(opts: { host: string; port?: number; path?: string; timeoutMs?: number }): Promise<CommandResult> {
  if (!opts.host) return { ok: false, message: "No host" };
  const local = /^(localhost|127\.0\.0\.1|::1)$/i.test(opts.host.trim());
  if (local && (!opts.port || opts.port === 0)) return { ok: true, message: "local" };
  const port = opts.port ?? 80;
  const timeout = Math.max(opts.timeoutMs ?? 800, 1500);
  const path = opts.path || "/";
  const httpPorts = new Set([80, 443, 8001, 8080, 8443]);
  if (httpPorts.has(port) || path.startsWith("/api")) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const prefer = port === 8002 ? 8001 : port;
      const res = await fetch(`http://${opts.host}:${prefer}${path.startsWith("/") ? path : `/${path}`}`, { signal: ctrl.signal });
      clearTimeout(t);
      const text = await res.text();
      const power = pickJsonField(text, "device.PowerState");
      return { ok: true, message: power ? `Power ${power}` : String(res.status) };
    } catch {
      /* fall through to TCP */
    }
  }
  return new Promise((resolve) => {
    import("node:net").then((net) => {
      const sock = net.connect({ host: opts.host, port });
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
      const result = await sendSamsungKey(host, port, "", undefined, step.timeoutMs ?? 12000);
      const token = result.message.match(/token\s+([A-Za-z0-9._-]+)/)?.[1] || result.message.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
      if (token) return { ok: true, message: "Paired", pairedToken: token, pairedPort: step.nextPort ?? port };
      if (/Accept Allow|ms.channel.connect/i.test(result.message)) return { ok: false, message: "Accept Allow on the device, then Authenticate again" };
    }
  }
  return { ok: false, message: "No token from pairing steps" };
}

export async function probeDevice(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; host?: string; simulate?: boolean }): Promise<CommandResult & { pairedToken?: string; pairedPort?: number }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "No driver" };
  if (opts.simulate ?? device.simulate) return { ok: true, message: "simulated" };
  const host = opts.host ?? device.host;
  const status = driver.status;
  if (status?.path || driver.auth?.pairing?.discoverPath) {
    return pingReachable({ host, port: status?.port ?? driver.auth?.pairing?.ports?.[0] ?? device.port ?? 80, path: status?.path ?? driver.auth?.pairing?.discoverPath ?? "/" });
  }
  return pingReachable({ host, port: device.port ?? driver.transports.lan?.port });
}

export async function scanDevicePorts(host: string, ports?: number[]) {
  const list = ports ?? [80, 8001, 8002, 8008, 8009, 4352, 51325, 51326, 51327];
  const open: number[] = [];
  for (const port of list) {
    const res = await pingReachable({ host, port, timeoutMs: 400 });
    if (res.ok) open.push(port);
  }
  return { ok: open.length > 0, message: open.join(", ") || "none open", open };
}

export async function sendRaw(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; payload: string }): Promise<CommandResult> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "No driver" };
  const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
  const wired = { ...device, interface: iface?.path || device.interface, auth: { ...device.auth, ifaceKind: iface?.kind || "" } };
  return iface ? sendLocal(driver, wired, opts.payload) : sendLan(driver, wired, opts.payload);
}

export async function syncInventory(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; vars?: Record<string, string | number> }): Promise<{ ok: boolean; message: string; inventory?: DeviceInventory }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  const resources = driver?.inventory?.resources ?? [];
  if (!resources.length) return { ok: false, message: "No inventory on driver" };
  if (driver.device.type === "host" || device.driver === "relay-host.json") {
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
    const path = renderPayload(resource.httpPath, undefined, device.auth);
    const url = `http://${device.host}:${device.port ?? driver.transports.lan?.port ?? 80}${path}`;
    const res = await sendHttp(url, resource.httpMethod || "GET", "", 3000);
    const items: InventoryItem[] = [];
    try {
      const parsed = JSON.parse(res.message) as Record<string, { name?: string; value?: string | number; group?: string; type?: string; class?: string }>;
      for (const [id, row] of Object.entries(parsed)) {
        if (typeof row === "object" && row) {
          items.push({
            id,
            name: String(row.name || id),
            value: row.value,
            group: String(row.group || row.type || row.class || resource.label),
            kind: String(row.type || resource.id),
          });
        }
      }
    } catch { /* ignore */ }
    inventory[resource.id] = items;
  }
  return { ok: true, message: "ok", inventory };
}

function parseHaystacks(raw: string, needle?: string) {
  const piles = [raw, raw.trim()];
  const hexNeedle = !!needle && /^[0-9a-fA-F]{2,}(?:\s+[0-9a-fA-F]{2,})*$/.test(needle.trim());
  const binary = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw);
  if (!hexNeedle && !binary) return [...new Set(piles)];
  const hex = Buffer.from(raw, "latin1").toString("hex");
  const spaced = hex.replace(/../g, (b) => `${b} `).trim();
  return [...new Set([...piles, hex, hex.toUpperCase(), spaced, spaced.toUpperCase()])];
}

function parseFeedback(rule: DriverSpec["feedback"][number]["parse"] | undefined, raw: string): string {
  if (!rule) return raw.trim();
  const piles = parseHaystacks(raw, rule.value ?? rule.pattern);
  let out = raw.trim();
  if (rule.type === "jsonpath") out = pickJsonField(raw, rule.path ?? "") ?? out;
  else if (rule.type === "regex" && rule.pattern) {
    const re = new RegExp(rule.pattern);
    out = piles.map((text) => text.match(re)?.[1]).find(Boolean) ?? out;
  } else if (rule.type === "contains") {
    const want = (rule.value ?? "").toLowerCase();
    out = piles.some((text) => text.toLowerCase().includes(want)) ? (rule.value ?? "1") : "";
  } else if (rule.type === "exact") {
    const want = (rule.value ?? "").trim().toLowerCase();
    out = piles.some((text) => text.trim().toLowerCase() === want) ? (rule.value ?? raw.trim()) : "";
  }
  if (rule.map) {
    const hit = Object.keys(rule.map).find((k) => k.toLowerCase() === out.toLowerCase());
    if (hit) return rule.map[hit] ?? out;
  }
  return out;
}

async function readHostFeedback(id: string, host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null }): Promise<{ ok: boolean; value: string; message: string }> {
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  if (id === "system.uptime") return { ok: true, value: String(Math.round(os.uptime())), message: `${Math.round(os.uptime())}s` };
  if (id === "relay.uptime") return { ok: true, value: String(Math.round(process.uptime())), message: `${Math.round(process.uptime())}s` };
  if (id === "system.temp") {
    try {
      const raw = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
      const c = (Number(raw) / 1000).toFixed(1);
      return { ok: true, value: c, message: `${c}°C` };
    } catch {
      return { ok: true, value: "", message: "n/a" };
    }
  }
  if (id === "system.version") {
    try {
      const pkg = JSON.parse(await fs.readFile("package.json", "utf8")) as { version?: string; name?: string };
      return { ok: true, value: pkg.version || "dev", message: pkg.version || "dev" };
    } catch {
      return { ok: true, value: "dev", message: "dev" };
    }
  }
  if (id === "system.platform") return { ok: true, value: `${os.platform()}-${os.arch()}`, message: `${os.platform()} ${os.arch()}` };
  if (id === "system.memory") {
    const free = Math.round(os.freemem() / 1048576);
    const total = Math.round(os.totalmem() / 1048576);
    return { ok: true, value: String(free), message: `${free}/${total} MB` };
  }
  if (id === "system.load") return { ok: true, value: os.loadavg()[0].toFixed(2), message: os.loadavg()[0].toFixed(2) };
  if (id === "panel.locked") return { ok: true, value: host?.locked ? "1" : "0", message: host?.locked ? "locked" : "open" };
  if (id === "display.dimmed") return { ok: true, value: host?.dim ? "1" : "0", message: host?.dim ? "dim" : "awake" };
  return { ok: false, value: "", message: "Unknown host feedback" };
}

export async function readMonitorValue(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
  deviceId: string;
  feedbackId: string;
  host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null };
}): Promise<{ ok: boolean; value: string; message: string }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, value: "", message: "Unknown device" };
  const slot = opts.state[device.id] ?? {};
  const driver = opts.drivers[device.driver];
  if (driver?.device.type === "host" || device.driver === "relay-host.json") {
    const result = await readHostFeedback(opts.feedbackId, opts.host);
    opts.state[device.id] = { ...slot, [opts.feedbackId]: result.value };
    return result;
  }
  const fb = driver?.feedback.find((item) => item.id === opts.feedbackId);
  if (!driver || !fb) return { ok: false, value: "", message: "Feedback missing" };
  const statusUrl = statusPlane(driver, device, fb);
  if (statusUrl) {
    const url = statusUrl;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const text = await (await fetch(url, { signal: ctrl.signal })).text();
      clearTimeout(t);
      const power = pickJsonField(text, "device.PowerState");
      const parsed = opts.feedbackId.includes("power") && power ? power : parseFeedback(fb.parse, text);
      const value = parsed.toLowerCase() === "standby" ? "off" : parsed.toLowerCase();
      const short = value.length > 32 && power ? power.toLowerCase() : value;
      opts.state[device.id] = { ...slot, [opts.feedbackId]: short };
      return { ok: true, value: short, message: short };
    } catch (err) {
      return { ok: false, value: "", message: err instanceof Error ? err.message : "poll failed" };
    }
  }
  const payload = fb.query ?? driver.probe?.payload ?? '{"type":"GET_STATUS","requestId":1}';
  const result = await sendLan(driver, device, payload);
  const app = pickJsonField(result.message, "displayName");
  const parsed = parseFeedback(fb.parse, result.message);
  const value = opts.feedbackId.includes("app") ? (app || "idle") : parsed;
  opts.state[device.id] = { ...slot, [opts.feedbackId]: value };
  return { ok: result.ok, value, message: value };
}

export async function applyHost(
  commandId: string,
  value: string | number | undefined,
  host: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null },
  vars?: Record<string, string | number>,
  flags?: { allowReboot?: boolean },
): Promise<CommandResult> {
  if (commandId === "display.dim") host.dim = true;
  else if (commandId === "display.wake") host.dim = false;
  else if (commandId === "panel.lock") host.locked = true;
  else if (commandId === "panel.unlock") host.locked = false;
  else if (commandId === "ui.toast") { host.toast = String(value ?? ""); host.toastAt = Date.now(); }
  else if (commandId === "ui.block") { host.block = String(value ?? ""); }
  else if (commandId === "ui.unblock") { host.block = null; }
  else if (commandId === "ui.clear") { host.toast = null; host.toastAt = Date.now(); }
  else if (commandId === "ui.page") host.pageId = String(value ?? "");
  else if (commandId === "var.get") {
    if (!vars) return { ok: false, message: "No vars" };
    const id = String(value ?? "").split("=")[0] ?? "";
    return { ok: id in vars, message: String(vars[id] ?? "") };
  }
  else if (commandId === "var.set") {
    if (!vars) return { ok: false, message: "No vars" };
    const raw = String(value ?? "");
    const eq = raw.indexOf("=");
    if (eq < 0) return { ok: false, message: "Use id=value" };
    const id = raw.slice(0, eq).trim();
    const next = raw.slice(eq + 1);
    if (!id) return { ok: false, message: "Missing var id" };
    vars[id] = next;
    return { ok: true, message: `${id}=${next}` };
  }
  else if (commandId === "system.restart") {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const path = await import("node:path");
    let root = process.cwd();
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(root, "package.json")) && fs.existsSync(path.join(root, "src", "lib", "control"))) break;
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
    const port = process.env.PORT || process.argv.find((a, i, all) => all[i - 1] === "--port") || "8081";
    const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
    const args = fs.existsSync(viteJs)
      ? [viteJs, "dev", "--host", "0.0.0.0", "--port", String(port)]
      : ["--yes", "vite", "dev", "--host", "0.0.0.0", "--port", String(port)];
    const cmd = fs.existsSync(viteJs) ? process.execPath : "npx";
    spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      cwd: root,
      shell: !fs.existsSync(viteJs),
      env: { ...process.env, CHOKIDAR_USEPOLLING: "1" },
    }).unref();
    setTimeout(() => process.exit(0), 400);
    return { ok: true, message: `Relay restarting in ${root}` };
  }
  else if (commandId === "system.reboot") {
    if (!flags?.allowReboot) return { ok: false, message: "OS reboot only from configurator" };
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "win32" ? "shutdown" : "reboot";
    const args = process.platform === "win32" ? ["/r", "/t", "0"] : [];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "Reboot sent" };
  } else return { ok: false, message: "Unknown host command" };
  return { ok: true, message: commandId };
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
    if (opts.commandId === "macro.run") {
      const target = String(resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables) ?? "");
      const nested = opts.config.macros.find((m) => m.id === target || m.label === target);
      if (!nested) return { ok: false, message: "Unknown macro" };
      return runMacro({ ...opts, macro: nested, vars: opts.vars ?? {}, depth: (opts.depth ?? 0) + 1, stack: opts.stack ?? [] });
    }
    const host = opts.host ?? { dim: false, locked: false, toast: null, pageId: null };
    const resolved = resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables);
    const result = await applyHost(opts.commandId, resolved, host, opts.vars);
    if (opts.host) Object.assign(opts.host, host);
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
  const payload = renderPayload(command.payload, value, device.auth);
  const path = command.httpPath ? renderPayload(command.httpPath, value, device.auth) : command.httpPath;
  const wiredCommand = path ? { ...command, httpPath: path } : command;
  const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
  const wired = {
    ...device,
    interface: iface?.path || device.interface,
    port: iface?.line ?? device.port,
    baud: device.baud ?? iface?.baud,
    auth: { ...device.auth, ifaceKind: iface?.kind || "", chip: iface?.chip || "", pin: iface?.line != null ? String(iface.line) : "" },
  };
  if (command.wake?.protocol === "wol") {
    const wol = await sendWol(device.auth?.mac || "", device.host);
    pushTrace(device.id, "note", wol.message);
    if (!wol.ok && !payload) return wol;
    await sleep(driver.pacing?.powerOnDelayMs ?? 2500);
  }
  let result = iface ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand);
  if (!result.ok && command.wake?.protocol === "wol") {
    await sleep(2000);
    result = iface ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand);
    if (!result.ok) result = { ok: true, message: "WOL sent — TV is waking" };
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
      if (def?.pushDevice && def.pushCommand) {
        await executeCommand({ ...opts, deviceId: def.pushDevice, commandId: def.pushCommand, value: opts.vars[step.setVar] });
      }
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
