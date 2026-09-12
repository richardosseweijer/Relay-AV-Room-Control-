import type {
  CommandResult,
  DeviceHealth,
  DeviceInstance,
  DeviceInventory,
  DeviceStateMap,
  DriverCommand,
  DriverSpec,
  HostInterface,
  InventoryItem,
  InventoryResource,
  Macro,
  RoomConfig,
  TraceLine,
} from "./types";
import { NONE_MACRO_ID } from "./types";
import { inferPairingSteps } from "./schema";
import { gatewayIoTemplate, gatewayProfile, gatewaySlot, isGatewayKind } from "./gateway";
import { applyMonitors, clampVar, resolveTemplate, type VarMap } from "./vars";
import { fetchTextBounded, requestHttpExact, DEFAULT_MAX_RESPONSE_BYTES } from "./http-client";
import { wsPoolSize, sendControlSocket, buildWsTarget } from "./ws";
import { sendPjlink } from "./pjlink";
import { sendCast, castPoolSize } from "./cast";
import { sendWol } from "./wol";
import { sendUdp } from "./udp";
import { sendOscCommand } from "./osc";
import { sendSacnCommand } from "./sacn";
import { sendUsbMidi } from "./midi";
import { sendIpmidi } from "./ipmidi";
import { sendRtpMidiCommand, rtpMidiPoolSize } from "./rtp-midi";
import { encodeMtcQf, encodeMtcSysex } from "./midi-in";

const g = globalThis as typeof globalThis & { __relayTraces__?: Record<string, TraceLine[]> };

export function traces(): Record<string, TraceLine[]> {
  if (!g.__relayTraces__) g.__relayTraces__ = {};
  return g.__relayTraces__;
}

export function socketStats() {
  return {
    ws: wsPoolSize(),
    tcp: sessions.size,
    cast: castPoolSize(),
    rtpMidi: rtpMidiPoolSize(),
  };
}

export function allowedLanHost(host: string | undefined, opts?: { localOk?: boolean }) {
  const raw = String(host ?? "").trim();
  if (!raw) return false;
  if (/^(file:|unix:|\\\\)/i.test(raw) || raw.startsWith("/")) return false;
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(raw)) return Boolean(opts?.localOk);
  const m = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function scrubSecret(text: string) {
  return String(text ?? "")
    .replace(/("(?:token|password|secret|username)"\s*:\s*")[^"]*/gi, "$1***")
    .replace(/\btoken\s+[A-Za-z0-9._+/=-]{3,}/gi, "token ***")
    .replace(/((?:token|password|secret)=)[^&\s"]+/gi, "$1***");
}

export function pushTrace(deviceId: string, dir: TraceLine["dir"], text: string) {
  const bag = traces();
  const list = bag[deviceId] ?? (bag[deviceId] = []);
  list.unshift({ at: Date.now(), dir, text: scrubSecret(text).slice(0, 500) });
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

function renderPayload(
  template: string,
  value?: string | number,
  auth: Record<string, string> = {},
  ctx: { host?: string; port?: number | string; id?: string; vars?: Record<string, string | number> } = {},
) {
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
    .replaceAll("{value}", raw)
    .replaceAll("{token}", auth.token ?? "")
    .replaceAll("{host}", ctx.host ?? "")
    .replaceAll("{port}", String(ctx.port ?? ""))
    .replaceAll("{id}", ctx.id ?? "");
  for (const [k, v] of Object.entries(auth)) out = out.replaceAll(`{auth.${k}}`, v ?? "");
  for (const [k, v] of Object.entries(ctx.vars ?? {})) {
    if (["value", "token", "host", "port", "id", "midiChannel", "channel"].includes(k)) continue;
    out = out.replaceAll(`{${k}}`, String(v));
  }
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
        if (/^serial[0-9]+$/i.test(name)) add("serial", `/dev/${name}`, `${name} (Pi UART)`);
        if (/^gpiochip\d+$/i.test(name)) add("gpio", `/dev/${name}`, name);
        if (/^i2c-\d+$/i.test(name)) add("i2c", `/dev/${name}`, name);
        if (/^spidev\d+\.\d+$/i.test(name)) add("spi", `/dev/${name}`);
        if (/^cec\d+$/i.test(name)) add("cec", `/dev/${name}`);
        if (/^lirc\d+$/i.test(name)) add("ir", `/dev/${name}`);
      }
      const { execFile } = await import("node:child_process");
      const amidi = await new Promise<string>((resolve) => {
        execFile("amidi", ["-l"], { timeout: 2000, windowsHide: true }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of amidi.split(/\r?\n/)) {
        const hw = line.match(/\b(hw:[A-Za-z0-9:_,-]{1,24})\b/)?.[1];
        if (hw) add("midi", hw, line.trim());
      }
      for (const alias of ["/dev/serial0", "/dev/serial1", "/dev/ttyAMA0", "/dev/ttyS0"]) {
        const exists = await fs.access(alias).then(() => true).catch(() => false);
        if (exists) add("serial", alias, alias.includes("serial") ? `${alias} (Pi UART)` : alias);
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "scan failed", ports };
  }
  return { ok: true, message: ports.length ? `${ports.length} found` : "None found", ports };
}

export function wireThroughInterface(device: DeviceInstance, iface?: HostInterface): DeviceInstance {
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

function usesLocalPort(iface?: HostInterface) {
  return Boolean(iface && !isGatewayKind(iface.kind));
}

function localArg(value: string | number | undefined, re: RegExp) {
  const s = String(value ?? "").trim();
  return re.test(s) ? s : null;
}

async function sendLocal(driver: DriverSpec, device: DeviceInstance, payload: string): Promise<CommandResult> {
  const local = driver.transports.local;
  const serial = driver.transports.rs232;
  const kind = device.auth?.ifaceKind || local?.kind || (device.transport === "rs232" || serial ? "serial" : null);
  if (!kind) return { ok: false, message: "No local transport on this driver" };
  const path = device.interface || device.host || local?.path || "COM1";
  pushTrace(device.id, "tx", `${kind} ${path} ${payload.slice(0, 80)}`);
  if (kind === "gpio") {
    const line = localArg(device.auth?.pin ?? device.port ?? local?.line ?? 0, /^(0|[1-9]\d{0,2})$/);
    const chip = localArg(device.auth?.chip || local?.chip || "gpiochip0", /^gpiochip\d+$/);
    const level = /off|low|0/i.test(payload) ? "0" : /on|high|1/i.test(payload) ? "1" : null;
    if (!chip || !line || Number(line) > 511 || (level !== "0" && level !== "1")) {
      return { ok: false, message: "GPIO chip/line/level rejected" };
    }
    return runTool("gpioset", [chip, `${line}=${level}`], local?.timeoutMs ?? 1500);
  }
  if (kind === "serial") {
    try {
      const fs = await import("node:fs/promises");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const baud = String(device.baud ?? serial?.baud ?? local?.baud ?? 9600);
      const target = path.startsWith("COM") ? `\\\\.\\${path}` : path;
      if (path.startsWith("COM")) {
        await exec("mode", [`${path}:`, `baud=${baud}`, "parity=n", "data=8", "stop=1"]).catch(() => undefined);
      } else {
        await exec("stty", ["-F", path, baud, "cs8", "-cstopb", "-parenb", "-echo"]).catch(() => undefined);
      }
      const fh = await fs.open(target, "r+");
      try {
        await fh.write(payload + (serial?.lineEnding ?? local?.lineEnding ?? "\r"));
      } finally {
        await fh.close();
      }
      return { ok: true, message: `${target} @ ${baud}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "serial failed" };
    }
  }
  if (kind === "i2c") {
    const bus = localArg(device.bus ?? local?.bus ?? 1, /^(0|[1-9]\d?)$/);
    const address = localArg(device.address || local?.address || "0x3c", /^0x[0-9a-f]{1,2}$/i);
    const hex = payload.replace(/[^0-9a-f]/gi, "");
    if (!bus || !address || !hex.length || hex.length % 2) return { ok: false, message: "I2C bus/address/data rejected" };
    const bytes: string[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(`0x${hex.slice(i, i + 2)}`);
    return runTool("i2cset", ["-y", bus, address, ...bytes]);
  }
  if (kind === "ir") {
    const remote = localArg(device.auth?.remote || "relay", /^[A-Za-z0-9._-]{1,32}$/);
    const scan = localArg(payload, /^[A-Za-z0-9:_-]{1,64}$/);
    if (!remote || !scan) return { ok: false, message: "IR remote/scancode rejected" };
    if (/^[a-z0-9]+:/i.test(scan)) {
      const dev = path === "COM1" ? "/dev/lirc0" : path;
      if (!localArg(dev, /^\/dev\/lirc\d+$/)) return { ok: false, message: "IR device rejected" };
      return runTool("ir-ctl", ["-d", dev, `--scancode=${scan}`], local?.timeoutMs ?? 2000);
    }
    return runTool("irsend", ["SEND_ONCE", remote, scan], local?.timeoutMs ?? 2000);
  }
  if (kind === "cec") {
    const args = ["-s", "-d", "1"];
    if (path && path !== "COM1") {
      const dev = localArg(path, /^\/dev\/cec\d+$/);
      if (!dev) return { ok: false, message: "CEC device rejected" };
      args.unshift("-p", dev);
    }
    const body = localArg(payload.replace(/\s+/g, " ").trim(), /^[A-Za-z0-9 .:_-]{1,80}$/);
    if (!body) return { ok: false, message: "CEC payload rejected" };
    return runToolStdin("cec-client", args, `${body}\n`, local?.timeoutMs ?? 4000);
  }
  if (kind === "midi") {
    return sendUsbMidi({ port: path, payload, timeoutMs: local?.timeoutMs });
  }
  const spiDev = localArg(path || "/dev/spidev0.0", /^\/dev\/spidev\d+\.\d+$/);
  const spiData = localArg(payload, /^[0-9A-Fa-f]{2,128}$/);
  if (!spiDev || !spiData) return { ok: false, message: "SPI device/payload rejected" };
  return runTool("spidev_test", ["-D", spiDev, "-p", spiData]);
}

const paceClock = ((globalThis as typeof globalThis & { __relayPace__?: Map<string, number> }).__relayPace__ ??= new Map());

async function paceDevice(id: string, minIntervalMs?: number) {
  const gap = Math.max(0, minIntervalMs ?? 0);
  if (!gap) return;
  const wait = (paceClock.get(id) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  paceClock.set(id, Date.now());
}

function wireEncoding(driver: DriverSpec, command?: DriverCommand) {
  const lan = driver.transports.lan;
  return command?.payloadEncoding || lan?.payloadEncoding || lan?.encoding;
}

function encodeWire(payload: string, encoding: string | undefined, lineEnding?: string): Buffer | { error: string } {
  const ending = lineEnding === undefined ? "" : lineEnding.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  if (encoding === "hex") {
    const hex = payload.replace(/[^0-9a-f]/gi, "");
    if (!hex.length || hex.length % 2) return { error: "Odd hex payload" };
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(`${payload}${ending}`, "utf8");
}

function decodeWire(buf: Buffer, encoding: string | undefined) {
  if (!buf.length) return "ok";
  if (encoding === "hex") return buf.toString("hex");
  return buf.toString("utf8").slice(0, 400);
}

async function tcpWrite(host: string, port: number, payload: Buffer, timeout: number, encoding?: string): Promise<CommandResult> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: "timeout" }); }, timeout);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    sock.on("connect", () => {
      // Connect-write-close on purpose. Persistent MIDI/TCP is KNOWN_ISSUES.md #4.
      sock.write(payload);
      setTimeout(() => sock.end(), 80);
    });
    sock.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    sock.on("close", () => { clearTimeout(timer); resolve({ ok: true, message: decodeWire(buf, encoding) }); });
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
    sock.on("data", (d) => {
      buf += d.toString();
      if (buf.length > 32768) buf = buf.slice(-8192);
    });
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
          if (session.readyContains) {
            try {
              await waitFor(session.readyContains);
            } catch {
              if (session.reply) sock.write(session.reply);
              try {
                await waitFor(session.readyContains);
              } catch {
                if (/password/i.test(buf)) throw new Error("Turn authentication off (got PASSWORD banner)");
              }
            }
          }
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
    await sleep(Math.min(800, Math.max(200, timeout / 8)));
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

export async function sendHttp(
  url: string,
  method: string,
  body: string,
  timeout: number,
  limits: { maxBytes?: number; maxMessageChars?: number; headers?: Record<string, string> } = {},
): Promise<CommandResult> {
  try {
    const verb = method.toUpperCase();
    let target = url;
    if ((verb === "GET" || verb === "HEAD") && body) {
      target += (url.includes("?") ? "&" : "?") + body.replace(/^\?/, "");
    }
    const headers = limits.headers ?? { "content-type": "application/json" };
    const soap = Object.keys(headers).some((key) => key.toLowerCase() === "soapaction");
    const res = soap
      ? await requestHttpExact(target, verb, verb === "GET" || verb === "HEAD" ? "" : body, headers, timeout, limits.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES)
      : await fetchTextBounded(target, {
          method: verb,
          body: verb === "GET" || verb === "HEAD" ? undefined : body,
          headers,
        }, timeout, limits.maxBytes);
    return { ok: res.ok, message: res.text.slice(0, limits.maxMessageChars ?? 400) || String(res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "http failed" };
  }
}

function statusPlane(driver: DriverSpec, device: DeviceInstance) {
  if (driver.transports.lan?.protocol === "cast") return null;
  const path = driver.status?.path;
  const port = driver.status?.port;
  if (!path || !port) return null;
  const proto = driver.status?.protocol ?? "http";
  return `${proto}://${device.host}:${port}${path.startsWith("/") ? path : `/${path}`}`;
}

async function sendRpcShutdown(host: string, user: string, password: string): Promise<CommandResult> {
  if (!allowedLanHost(host)) return { ok: false, message: "Host not on room LAN" };
  if (process.platform === "win32") {
    return runTool("shutdown", ["/s", "/m", `\\\\${host}`, "/t", "0", "/f"], 8000);
  }
  if (!user) return { ok: false, message: "Set user and password (Windows RPC) or HTTP path" };
  return runTool("net", ["rpc", "shutdown", "-I", host, "-U", `${user}%${password}`, "-f", "-t", "0"], 8000);
}

function wsQueryFromDriver(driver: DriverSpec, device: DeviceInstance): Record<string, string> | undefined {
  const out: Record<string, string> = { ...(driver.transports.lan?.query ?? {}) };
  const pairingQuery = driver.auth?.pairing?.query;
  if (pairingQuery?.nameParam) {
    const raw = pairingQuery.nameFrom === "auth.name" ? (device.auth?.name || "Relay") : "Relay";
    out[pairingQuery.nameParam] = `{base64:${raw}}`;
  }
  if (pairingQuery?.tokenParam) out[pairingQuery.tokenParam] = "{token}";
  return Object.keys(out).length ? out : undefined;
}

async function sendLan(driver: DriverSpec, device: DeviceInstance, payload: string, command?: DriverCommand): Promise<CommandResult> {
  const lan = driver.transports.lan;
  if (!lan) return { ok: false, message: "No LAN transport on this driver" };
  const proto = String(lan.protocol || "");
  if (!proto || /[/\\:]/.test(proto)) return { ok: false, message: "Unknown protocol" };
  const known = new Set(["tcp", "udp", "http", "https", "websocket", "tls-websocket", "pjlink", "cast", "wol", "osc", "sacn", "ipmidi", "rtp-midi"]);
  if (!known.has(proto)) return { ok: false, message: "Unknown protocol" };
  const host = device.host;
  const skipUnicastHost = proto === "sacn" || (proto === "ipmidi" && lan.multicast !== false);
  if (!skipUnicastHost && !allowedLanHost(host, { localOk: device.driver === "relay-host.json" || driver.device.type === "host" })) {
    return { ok: false, message: "Host not on room LAN" };
  }
  const port = device.port ?? lan.port;
  const timeout = lan.timeoutMs ?? 3000;
  const encoding = wireEncoding(driver, command);
  await paceDevice(device.id, driver.pacing?.minIntervalMs);
  pushTrace(device.id, "tx", `${command?.namespace ? command.namespace.split(".").pop() + " " : ""}${payload.slice(0, 160)}`);
  let result: CommandResult;
  const wire = encodeWire(payload, encoding, lan.lineEnding ?? (lan.protocol === "pjlink" ? "\r" : undefined));
  if ("error" in wire) return { ok: false, message: wire.error };
  if (command?.httpMethod === "RPC") result = await sendRpcShutdown(host, device.auth?.user || device.auth?.username || "", device.auth?.password || "");
  else if (lan.protocol === "wol") result = await sendWol(device.auth?.mac || "", host);
  else if (lan.protocol === "cast") result = await sendCast(host, port, payload, timeout, command?.namespace);
  else if (lan.protocol === "http" || lan.protocol === "https") {
    const auth = device.auth || {};
    const ctx = { host, port, id: device.id };
    const path = renderPayload(command?.httpPath || lan.http?.path || "/", undefined, auth, ctx);
    const rawHeaders: Record<string, string> = {
      "content-type": lan.http?.contentType || "application/json",
      ...(lan.http?.headers ?? {}),
      ...(command?.httpHeaders ?? {}),
    };
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawHeaders)) {
      headers[key] = renderPayload(String(val ?? ""), undefined, auth, ctx);
    }
    result = await sendHttp(`${lan.protocol}://${host}:${port}${path}`, command?.httpMethod || lan.http?.method || "GET", payload, timeout, {
      maxMessageChars: lan.http?.contentType?.includes("xml") ? 64 * 1024 : undefined,
      headers,
    });
  } else if (lan.protocol === "websocket" || lan.protocol === "tls-websocket") {
    if (/[/:]/.test(String(lan.protocol))) result = { ok: false, message: "Unknown protocol" };
    else if (/^file:/i.test(lan.path || lan.http?.path || "")) result = { ok: false, message: "Invalid path" };
    else {
      const target = buildWsTarget({
        path: lan.path || lan.http?.path,
        query: wsQueryFromDriver(driver, device),
        port: device.port ?? lan.port,
        tls: lan.protocol === "tls-websocket",
        token: device.auth?.token,
      });
      result = await sendControlSocket({
        host,
        ...target,
        payload,
        timeout: command?.waitContains ? Math.max(timeout, 20000) : timeout,
        waitFor: command?.waitContains,
        handshake: lan.handshake,
        alsoSend: lan.alsoSend,
        alsoSendRaw: command?.alsoSend,
      });
    }
  }
  else if (lan.protocol === "pjlink") result = await sendPjlink(host, port, payload, device.auth?.password || device.auth?.pin, timeout);
  else if (lan.protocol === "osc") {
    const oscPort = Number(port || 9000);
    const ctx = { host, port: oscPort, id: device.id };
    const auth = device.auth || {};
    result = await sendOscCommand({
      host,
      port: oscPort,
      path: renderPayload(payload, undefined, auth, ctx),
      types: command?.osc?.types,
      values: (command?.osc?.values ?? []).map((v) => renderPayload(String(v ?? ""), undefined, auth, ctx)),
    });
  }
  else if (lan.protocol === "sacn") {
    const auth = device.auth || {};
    const ctx = { host, port: 5568, id: device.id };
    const universe = Number(auth.universe || 1);
    result = await sendSacnCommand({
      universe,
      slot: command?.sacn?.slot,
      value: command?.sacn ? renderPayload(String(command.sacn.value ?? payload ?? "0"), undefined, auth, ctx) : undefined,
      cidKey: device.id || host || "relay",
    });
  }
  else if (lan.protocol === "ipmidi") {
    const midiWire = encoding === "hex" ? wire : encodeWire(payload, "hex");
    if ("error" in midiWire) return { ok: false, message: midiWire.error };
    result = await sendIpmidi({
      buf: midiWire,
      multicast: lan.multicast !== false,
      host,
      port: Number(port || 21928),
    });
  }
  else if (lan.protocol === "rtp-midi") {
    const midiWire = encoding === "hex" ? wire : encodeWire(payload, "hex");
    if ("error" in midiWire) return { ok: false, message: midiWire.error };
    const controlPort = Number(port || 5004);
    result = await sendRtpMidiCommand({
      host,
      controlPort,
      dataPort: lan.rtpMidi?.dataPort ?? controlPort + 1,
      midi: midiWire,
      keepMs: lan.session?.keepMs ?? 60_000,
      timeoutMs: timeout,
    });
  }
  else if (lan.protocol === "udp") result = await sendUdp(host, Number(port), wire); else if (lan.session && encoding !== "hex") {
    result = await tcpSessionWrite(device.id, host, port, wire, lan.session, device.auth || {}, timeout);
  } else result = await tcpWrite(host, port, wire, timeout, encoding);
  pushTrace(device.id, result.ok ? "rx" : "note", result.message);
  return result;
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

export async function probeDevice(opts: { config: RoomConfig; drivers: Record<string, DriverSpec>; deviceId: string; host?: string; simulate?: boolean }): Promise<CommandResult & { pairedToken?: string; pairedPort?: number }> {
  const device = opts.config.devices.find((d) => d.id === opts.deviceId);
  if (!device) return { ok: false, message: "Unknown device" };
  const driver = opts.drivers[device.driver];
  if (!driver) return { ok: false, message: "No driver" };
  if (opts.simulate ?? device.simulate) return { ok: true, message: "simulated" };
  const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
  const wired = wireThroughInterface(device, iface);
  const host = opts.host ?? wired.host;
  const probe = driver.probe;
  if (probe?.payload) {
    const result = await sendLan(driver, { ...wired, host }, probe.payload);
    if (!probe.success) return result;
    const hit = parseFeedback(probe.success, result.message);
    const matched = probe.success.type === "contains" || probe.success.type === "exact" ? Boolean(hit) : hit.length > 0;
    return { ok: result.ok && matched, message: result.message };
  }
  const status = driver.status;
  if (status?.path || driver.auth?.pairing?.discoverPath) {
    return pingReachable({ host, port: status?.port ?? driver.auth?.pairing?.ports?.[0] ?? wired.port ?? 80, path: status?.path ?? driver.auth?.pairing?.discoverPath ?? "/" });
  }
  return pingReachable({ host, port: wired.port ?? driver.transports.lan?.port });
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

export async function sendGatewayRaw(opts: { config: RoomConfig; interfaceId: string; payload: string }): Promise<CommandResult> {
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
  const result = await tcpSessionWrite(
    `gw:${wired.host}:${port}`,
    wired.host,
    port,
    buf,
    { keepMs: 20000 },
    {},
    1200,
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
  return usesLocalPort(iface) ? sendLocal(driver, wired, opts.payload) : sendLan(driver, wired, opts.payload);
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
      });
      if (!res.ok) return { ok: false, message: res.message };
      raw = res.message;
    } else if (resource.httpPath) {
      const path = renderPayload(resource.httpPath, undefined, device.auth, { host: device.host, port: device.port, id: device.id });
      const port = driver.status?.port ?? device.port ?? driver.transports.lan?.port ?? 80;
      const url = `http://${device.host}:${port}${path}`;
      const inventoryLimit = 2 * 1024 * 1024;
      const res = await sendHttp(url, resource.httpMethod || "GET", "", 8000, {
        maxBytes: inventoryLimit,
        maxMessageChars: inventoryLimit,
      });
      if (!res.ok) return { ok: false, message: res.message };
      raw = res.message;
    } else continue;
    inventory[resource.id] = parseInventoryItems(raw, resource);
  }
  const count = Object.values(inventory).reduce((n, list) => n + list.length, 0);
  return { ok: true, message: count ? `${count} items` : "No items in reply", inventory };
}

function jsonAt(raw: string, path?: string): unknown {
  const startObj = raw.search(/[\[{]/);
  const json = startObj >= 0 ? raw.slice(startObj) : raw;
  let cur: unknown = JSON.parse(json);
  if (!path) return cur;
  for (const key of path.split(".").filter(Boolean)) {
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
  return cur;
}

function fieldFromRow(row: Record<string, unknown>, path: string | undefined, fallbacks: string[]): string {
  const blob = JSON.stringify(row);
  if (path) {
    const hit = pickJsonField(blob, path);
    if (hit && hit !== "[object Object]") return hit;
  }
  for (const key of fallbacks) {
    const hit = pickJsonField(blob, key);
    if (hit && hit !== "[object Object]") return hit;
  }
  return "";
}

function parseInventoryItems(raw: string, resource: InventoryResource): InventoryItem[] {
  const paths = resource.parsePath ? [resource.parsePath] : [""];
  for (const path of paths) {
    try {
      const node = jsonAt(raw, path || undefined);
      const rows: Record<string, unknown>[] = [];
      if (Array.isArray(node)) {
        for (const row of node) {
          if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
        }
      } else if (node && typeof node === "object") {
        for (const [id, row] of Object.entries(node as Record<string, unknown>)) {
          if (row && typeof row === "object") rows.push({ id, ...(row as Record<string, unknown>) });
          else rows.push({ id, value: row });
        }
      }
      const items = rows.map((row) => {
        const id = fieldFromRow(row, resource.idField, []) || String(row.id || "");
        const name = fieldFromRow(row, resource.nameField || resource.itemName, []) || id;
        const value = fieldFromRow(row, resource.valueField, []);
        return { id, name, value, group: resource.label, kind: resource.id };
      }).filter((item) => item.id);
      if (items.length) return items;
    } catch {
      /* try next path */
    }
  }
  return [];
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
  else if (rule.type === "map") out = raw.trim();
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
        else if (parsed.vars?.[opts.feedbackId]) value = String(parsed.vars[opts.feedbackId]!.value ?? "");
        else value = "";
        opts.state[device.id] = { ...slot, [opts.feedbackId]: value };
        return { ok: res.ok, value, message: value || "peer" };
      } catch (err) {
        return { ok: false, value: "", message: err instanceof Error ? err.message : "peer poll failed" };
      }
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
      const response = await fetchTextBounded(url, {}, 2000);
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
  });
  if (!result.ok) return { ok: false, value: "", message: result.message };
  const parsed = parseFeedback(fb.parse, result.message);
  opts.state[device.id] = { ...slot, [opts.feedbackId]: parsed };
  return { ok: true, value: parsed, message: parsed };
}

export async function applyHost(
  commandId: string,
  value: string | number | undefined,
  host: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null; pageAt?: number; fullscreenAt?: number },
  vars?: Record<string, string | number>,
  flags?: { allowReboot?: boolean; allowAdmin?: boolean },
): Promise<CommandResult> {
  if (commandId === "display.dim") host.dim = true;
  else if (commandId === "display.wake") host.dim = false;
  else if (commandId === "panel.lock") host.locked = true;
  else if (commandId === "panel.unlock") host.locked = false;
  else if (commandId === "ui.toast") { host.toast = String(value ?? ""); host.toastAt = Date.now(); }
  else if (commandId === "ui.block") { host.block = String(value ?? ""); }
  else if (commandId === "ui.unblock") { host.block = null; }
  else if (commandId === "ui.clear") { host.toast = null; host.toastAt = Date.now(); }
  else if (commandId === "ui.page") { host.pageId = String(value ?? ""); host.pageAt = Date.now(); }
  else if (commandId === "display.fullscreen") { host.fullscreenAt = Date.now(); }
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
    if (!flags?.allowAdmin) return { ok: false, message: "Restart only from configurator" };
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
    if (process.env.INVOCATION_ID && process.platform !== "win32") {
      setTimeout(() => process.exit(1), 400);
      return { ok: true, message: "Restarting (systemd Restart=always)" };
    }
    const preview = process.env.npm_lifecycle_event === "start" || process.argv.includes("preview") || process.env.NODE_ENV === "production";
    const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
    const args = preview
      ? (fs.existsSync(viteJs) ? [viteJs, "preview", "--host", "0.0.0.0", "--port", String(port)] : ["--yes", "vite", "preview", "--host", "0.0.0.0", "--port", String(port)])
      : (fs.existsSync(viteJs) ? [viteJs, "dev", "--host", "0.0.0.0", "--port", String(port)] : ["--yes", "vite", "dev", "--host", "0.0.0.0", "--port", String(port)]);
    const cmd = fs.existsSync(viteJs) ? process.execPath : "npx";
    spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      cwd: root,
      shell: !fs.existsSync(viteJs),
      env: { ...process.env, CHOKIDAR_USEPOLLING: "1" },
    }).unref();
    setTimeout(() => process.exit(0), 400);
    return { ok: true, message: preview ? `Relay preview restarting in ${root}` : `Relay restarting in ${root}` };
  }
  else if (commandId === "system.update") {
    if (!flags?.allowAdmin) return { ok: false, message: "Update only from configurator" };
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
    if (!fs.existsSync(path.join(root, ".git"))) return { ok: false, message: "Not a git checkout. Clone the GitHub repo to use Update." };
    const script = path.join(root, "scripts", "update-relay.mjs");
    if (!fs.existsSync(script)) return { ok: false, message: "Update script missing" };
    const port = process.env.PORT || process.argv.find((a, i, all) => all[i - 1] === "--port") || "8081";
    spawn(process.execPath, [script], {
      detached: true,
      stdio: "ignore",
      cwd: root,
      env: { ...process.env, PORT: String(port), CHOKIDAR_USEPOLLING: "1", RELAY_PID: String(process.pid), MAINPID: process.env.MAINPID || String(process.pid) },
    }).unref();
    return { ok: true, message: "Updating from GitHub. The room stays up until the new build is ready." };
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

export function isLocalRelayHost(host?: string) {
  const h = String(host ?? "").trim().toLowerCase();
  return !h || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
}

function relayPeerUrl(device: { host: string; port?: number }, path: string) {
  return `http://${device.host}:${device.port || 8081}${path}`;
}

async function signedPeerFetch(device: { host: string; port?: number; auth?: Record<string, string> }, method: string, path: string, body?: string) {
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
      if (opts.commandId === "macro.run") {
        const target = String(resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables) ?? "");
        return callRelayPeer(device, "POST", "/api/peer", { macroId: target });
      }
      const resolved = resolveTemplate(opts.value, opts.vars ?? {}, opts.config.variables);
      return callRelayPeer(device, "POST", "/api/peer", { command: opts.commandId, value: resolved });
    }
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
    const wol = await sendWol(device.auth?.mac || "", wired.host);
    pushTrace(device.id, "note", wol.message);
    if (!payload && !path) return wol;
    if (!wol.ok && !payload) return wol;
    await sleep(driver.pacing?.powerOnDelayMs ?? 2500);
  }
  let result = usesLocalPort(iface) ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand);
  if (!result.ok && command.wake?.protocol === "wol") {
    await sleep(2000);
    result = usesLocalPort(iface) ? await sendLocal(driver, wired, payload) : await sendLan(driver, wired, payload, wiredCommand);
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
