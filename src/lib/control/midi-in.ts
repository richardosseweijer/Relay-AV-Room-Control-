import { spawn, type ChildProcess } from "node:child_process";
import type { DeviceStateMap, DriverSpec, MidiWatch, MidiWatchKind, RoomConfig } from "./types";
import { midiPortOk } from "./midi.ts";
import { listenUdpMulticast } from "./udp.ts";
import { IPMIDI_GROUP, IPMIDI_PORT } from "./ipmidi.ts";
import { setRtpMidiBytesHandler } from "./rtp-midi.ts";

export type MidiMsg = {
  kind: MidiWatchKind;
  channel?: number;
  data1?: number;
  data2?: number;
  time?: string;
};

const mtcSlots = new Map<string, number[]>();
const clockTicks = new Map<string, number>();
const usbChildren = new Map<string, ChildProcess>();
const ipmidiClosers = new Map<string, () => void>();
const rtpDevices = new Map<string, string>();
let midiFp = "";

export function parseMidi(buf: Buffer): MidiMsg[] {
  const out: MidiMsg[] = [];
  let status = 0;
  let need = 0;
  let data: number[] = [];
  const emit = () => {
    const msg = msgFrom(status, data);
    if (msg) out.push(msg);
    data = [];
  };
  const dataBytes = (st: number) => {
    if (st >= 0x80 && st <= 0xbf) return 2;
    if (st >= 0xc0 && st <= 0xdf) return 1;
    if (st >= 0xe0 && st <= 0xef) return 2;
    if (st === 0xf1 || st === 0xf3) return 1;
    if (st === 0xf2) return 2;
    return 0;
  };
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    if (b === 0xfe) continue;
    if (b >= 0xf8) {
      if (b === 0xf8) out.push({ kind: "clock" });
      else if (b === 0xfa) out.push({ kind: "start" });
      else if (b === 0xfb) out.push({ kind: "cont" });
      else if (b === 0xfc) out.push({ kind: "stop" });
      continue;
    }
    if (b === 0xf0) {
      const end = buf.indexOf(0xf7, i + 1);
      if (end < 0) break;
      const sysex = buf.subarray(i, end + 1);
      const time = parseMtcSysex(sysex);
      if (time) out.push({ kind: "mtc", time });
      i = end;
      continue;
    }
    if (b >= 0x80) {
      if (need && data.length) emit();
      status = b;
      need = dataBytes(status);
      data = [];
      if (!need) emit();
      continue;
    }
    if (!status) continue;
    data.push(b);
    if (!need) need = dataBytes(status);
    if (data.length >= need) {
      emit();
      if (status < 0xf0) need = dataBytes(status);
      else {
        status = 0;
        need = 0;
      }
    }
  }
  return out;
}

function msgFrom(status: number, data: number[]): MidiMsg | null {
  if (status === 0xf1) {
    return { kind: "mtc", data1: data[0] ?? 0 };
  }
  const cmd = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (cmd === 0x80) return { kind: "noteOff", channel, data1: data[0] ?? 0, data2: data[1] ?? 0 };
  if (cmd === 0x90) {
    const vel = data[1] ?? 0;
    if (!vel) return { kind: "noteOff", channel, data1: data[0] ?? 0, data2: 0 };
    return { kind: "note", channel, data1: data[0] ?? 0, data2: vel };
  }
  if (cmd === 0xb0) return { kind: "cc", channel, data1: data[0] ?? 0, data2: data[1] ?? 0 };
  if (cmd === 0xc0) return { kind: "pc", channel, data1: data[0] ?? 0 };
  return null;
}

export function applyMidiWatch(watch: MidiWatch[], msg: MidiMsg): { feedback: string; value: string }[] {
  const hits: { feedback: string; value: string }[] = [];
  for (const rule of watch ?? []) {
    if (rule.kind !== msg.kind) continue;
    if (rule.channel != null && msg.channel != null && rule.channel !== msg.channel) continue;
    if (rule.kind === "cc" && rule.controller != null && rule.controller !== msg.data1) continue;
    let value = "";
    if (rule.kind === "cc") value = String(msg.data2 ?? 0);
    else if (rule.kind === "note" || rule.kind === "noteOff") value = String(msg.data1 ?? 0);
    else if (rule.kind === "pc") value = String(msg.data1 ?? 0);
    else if (rule.kind === "clock") value = "1";
    else if (rule.kind === "start" || rule.kind === "cont") value = "1";
    else if (rule.kind === "stop") value = "0";
    else continue;
    hits.push({ feedback: rule.feedback, value });
  }
  return hits;
}

export function pushMtcQf(deviceId: string, qfByte: number): string | null {
  const type = (qfByte >> 4) & 0x07;
  const nibble = qfByte & 0x0f;
  const slot = mtcSlots.get(deviceId) ?? [0, 0, 0, 0, 0, 0, 0, 0];
  slot[type] = nibble;
  mtcSlots.set(deviceId, slot);
  if (type !== 7) return null;
  for (let i = 0; i < 8; i++) if (slot[i] == null) return null;
  const ff = (slot[0]! & 0x0f) | ((slot[1]! & 0x01) << 4);
  const ss = (slot[2]! & 0x0f) | ((slot[3]! & 0x03) << 4);
  const mm = (slot[4]! & 0x0f) | ((slot[5]! & 0x03) << 4);
  const hh = (slot[6]! & 0x0f) | ((slot[7]! & 0x01) << 4);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

export function parseMtcSysex(buf: Buffer): string | null {
  if (buf.length < 10) return null;
  if (buf[0] !== 0xf0 || buf[1] !== 0x7f || buf[3] !== 0x01 || buf[4] !== 0x01) return null;
  if (buf[buf.length - 1] !== 0xf7) return null;
  const hh = buf[5]! & 0x1f;
  const mm = buf[6]! & 0x3f;
  const ss = buf[7]! & 0x3f;
  const ff = buf[8]! & 0x1f;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

export function parseMtcTime(raw: string): { hh: number; mm: number; ss: number; ff: number } | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ff = Number(m[4]);
  if (hh > 23 || mm > 59 || ss > 59 || ff > 29) return null;
  return { hh, mm, ss, ff };
}

export function encodeMtcQf(time: string): Buffer | null {
  const t = parseMtcTime(time);
  if (!t) return null;
  const nibbles = [
    t.ff & 0x0f,
    (t.ff >> 4) & 0x01,
    t.ss & 0x0f,
    (t.ss >> 4) & 0x03,
    t.mm & 0x0f,
    (t.mm >> 4) & 0x03,
    t.hh & 0x0f,
    ((t.hh >> 4) & 0x01) | 0x06,
  ];
  const out = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = 0xf1;
    out[i * 2 + 1] = (i << 4) | nibbles[i]!;
  }
  return out;
}

export function encodeMtcSysex(time: string): Buffer | null {
  const t = parseMtcTime(time);
  if (!t) return null;
  return Buffer.from([0xf0, 0x7f, 0x7f, 0x01, 0x01, (3 << 5) | t.hh, t.mm, t.ss, t.ff, 0xf7]);
}

function pad2(n: number) {
  return String(Math.max(0, n | 0)).padStart(2, "0");
}

export function onMidiBytes(deviceId: string, buf: Buffer, watch: MidiWatch[], state: DeviceStateMap): { feedback: string; value: string }[] {
  const msgs = parseMidi(buf);
  const hits: { feedback: string; value: string }[] = [];
  const slot = (state[deviceId] ??= {});
  for (const msg of msgs) {
    if (msg.kind === "mtc") {
      let time = msg.time ?? null;
      if (!time && msg.data1 != null && msg.data1 >= 0) time = pushMtcQf(deviceId, msg.data1);
      if (!time) continue;
      for (const rule of watch ?? []) {
        if (rule.kind !== "mtc") continue;
        hits.push({ feedback: rule.feedback, value: time });
        slot[rule.feedback] = time;
      }
      continue;
    }
    if (msg.kind === "clock") {
      const n = (clockTicks.get(deviceId) ?? 0) + 1;
      clockTicks.set(deviceId, n);
      for (const rule of watch ?? []) {
        if (rule.kind !== "clock") continue;
        const value = String(n);
        hits.push({ feedback: rule.feedback, value });
        slot[rule.feedback] = value;
      }
      continue;
    }
    for (const hit of applyMidiWatch(watch, msg)) {
      hits.push(hit);
      slot[hit.feedback] = hit.value;
    }
  }
  return hits;
}

function midiDevPathOk(path: string) {
  return /^\/dev\/(snd\/midiC\d+D\d+|midi\d+)$/.test(path);
}

function killUsb(id: string) {
  const child = usbChildren.get(id);
  if (!child) return;
  usbChildren.delete(id);
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  try { (child as unknown as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
}

function closeIpmidi(id: string) {
  const close = ipmidiClosers.get(id);
  if (!close) return;
  ipmidiClosers.delete(id);
  try { close(); } catch { /* ignore */ }
}

function startUsbMidiIn(deviceId: string, port: string, watch: MidiWatch[], state: DeviceStateMap) {
  if (process.platform === "win32") return;
  killUsb(deviceId);
  if (midiDevPathOk(port)) {
    import("node:fs").then((fs) => {
      const stream = fs.createReadStream(port);
      usbChildren.set(deviceId, stream as unknown as ChildProcess);
      stream.on("data", (chunk: string | Buffer) => onMidiBytes(deviceId, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), watch, state));
      stream.on("error", () => killUsb(deviceId));
    }).catch(() => undefined);
    return;
  }
  if (!midiPortOk(port)) return;
  const child = spawn("amidi", ["-p", port, "-d"], { windowsHide: true });
  usbChildren.set(deviceId, child);
  let tail = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    tail += chunk.toString("utf8");
    const lines = tail.split(/\r?\n/);
    tail = lines.pop() ?? "";
    for (const line of lines) {
      const hex = line.replace(/[^0-9a-f]/gi, "");
      if (hex.length >= 2 && hex.length % 2 === 0) onMidiBytes(deviceId, Buffer.from(hex, "hex"), watch, state);
    }
  });
  child.on("error", () => killUsb(deviceId));
  child.on("close", () => usbChildren.delete(deviceId));
}

async function startIpmidiIn(deviceId: string, watch: MidiWatch[], state: DeviceStateMap, port?: number) {
  closeIpmidi(deviceId);
  const got = await listenUdpMulticast({
    group: IPMIDI_GROUP,
    port: port || IPMIDI_PORT,
    onMessage: (buf) => onMidiBytes(deviceId, buf, watch, state),
  });
  if ("error" in got) return;
  ipmidiClosers.set(deviceId, got.close);
}

export function syncMidiWatchers(opts: {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  state: DeviceStateMap;
}) {
  const fp = opts.config.devices.map((d) => `${d.id}:${d.driver}:${d.interfaceId ?? ""}:${d.host}`).join("|");
  if (fp !== midiFp) {
    for (const id of [...usbChildren.keys()]) killUsb(id);
    for (const id of [...ipmidiClosers.keys()]) closeIpmidi(id);
    midiFp = fp;
  }
  rtpDevices.clear();
  for (const device of opts.config.devices) {
    const driver = opts.drivers[device.driver];
    const watch = driver?.midiWatch ?? [];
    if (!watch.length) continue;
    const proto = driver.transports.lan?.protocol;
    const local = driver.transports.local?.kind;
    if (local === "midi") {
      const iface = opts.config.interfaces?.find((item) => item.id === device.interfaceId);
      const port = iface?.path || device.interface || driver.transports.local?.path || "";
      if (port && !usbChildren.has(device.id)) startUsbMidiIn(device.id, port, watch, opts.state);
    }
    if (proto === "ipmidi" && !ipmidiClosers.has(device.id)) {
      startIpmidiIn(device.id, watch, opts.state, driver.transports.lan?.port).catch(() => undefined);
    }
    if (proto === "rtp-midi") {
      const control = device.port ?? driver.transports.lan?.port ?? 5004;
      rtpDevices.set(`${device.host}:${control}`, device.id);
    }
  }
  setRtpMidiBytesHandler((host, controlPort, midi) => {
    const id = rtpDevices.get(`${host}:${controlPort}`);
    if (!id) return;
    const driver = opts.drivers[opts.config.devices.find((d) => d.id === id)?.driver ?? ""];
    if (!driver?.midiWatch?.length) return;
    onMidiBytes(id, midi, driver.midiWatch, opts.state);
  });
}

export function stopMidiWatchers() {
  for (const id of [...usbChildren.keys()]) killUsb(id);
  for (const id of [...ipmidiClosers.keys()]) closeIpmidi(id);
  rtpDevices.clear();
  midiFp = "";
}

export function _testOnlyUsbCount() {
  return usbChildren.size;
}
