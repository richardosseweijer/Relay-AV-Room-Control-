import dgram from "node:dgram";
import type { CommandResult } from "./types";

export type AppleCmd = "IN" | "OK" | "NO" | "BY";

const SIGNATURE = Buffer.from([0xff, 0xff]);

function rand32() {
  return ((Math.random() * 0x100000000) >>> 0) || 1;
}

function nowTs() {
  return BigInt(Date.now()) * 10n;
}

export function packAppleMidi(opts: {
  cmd: AppleCmd;
  version?: number;
  initiator: number;
  ssrc: number;
  name?: string;
}): Buffer {
  const name = opts.cmd === "IN" || opts.cmd === "OK" ? `${opts.name || "Relay"}\0` : "";
  const buf = Buffer.alloc(16 + name.length);
  SIGNATURE.copy(buf, 0);
  buf.write(opts.cmd, 2, "ascii");
  buf.writeUInt32BE(opts.version ?? 2, 4);
  buf.writeUInt32BE(opts.initiator >>> 0, 8);
  buf.writeUInt32BE(opts.ssrc >>> 0, 12);
  if (name) buf.write(name, 16, "ascii");
  return buf;
}

export function unpackAppleMidi(buf: Buffer): {
  cmd: AppleCmd;
  version: number;
  initiator: number;
  ssrc: number;
  name?: string;
} | null {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xff) return null;
  const cmd = buf.toString("ascii", 2, 4);
  if (cmd !== "IN" && cmd !== "OK" && cmd !== "NO" && cmd !== "BY") return null;
  const nameRaw = buf.length > 16 ? buf.toString("utf8", 16).replace(/\0.*$/, "") : "";
  return {
    cmd,
    version: buf.readUInt32BE(4),
    initiator: buf.readUInt32BE(8),
    ssrc: buf.readUInt32BE(12),
    name: nameRaw || undefined,
  };
}

export function packCk(opts: {
  ssrc: number;
  count: 0 | 1 | 2;
  timestamps: [bigint, bigint, bigint];
}): Buffer {
  const buf = Buffer.alloc(36);
  SIGNATURE.copy(buf, 0);
  buf.write("CK", 2, "ascii");
  buf.writeUInt32BE(opts.ssrc >>> 0, 4);
  buf[8] = opts.count;
  buf.writeBigUInt64BE(opts.timestamps[0], 12);
  buf.writeBigUInt64BE(opts.timestamps[1], 20);
  buf.writeBigUInt64BE(opts.timestamps[2], 28);
  return buf;
}

export function unpackCk(buf: Buffer): {
  ssrc: number;
  count: number;
  timestamps: [bigint, bigint, bigint];
} | null {
  if (!Buffer.isBuffer(buf) || buf.length < 36) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xff) return null;
  if (buf.toString("ascii", 2, 4) !== "CK") return null;
  return {
    ssrc: buf.readUInt32BE(4),
    count: buf[8] ?? 0,
    timestamps: [buf.readBigUInt64BE(12), buf.readBigUInt64BE(20), buf.readBigUInt64BE(28)],
  };
}

export function wrapRtpMidi(ssrc: number, seq: number, midiBytes: Buffer, timestamp = 0): Buffer {
  if (!midiBytes.length) throw new Error("RTP-MIDI empty");
  const len = midiBytes.length;
  const long = len >= 16;
  const rtp = Buffer.alloc(12 + (long ? 2 : 1) + len);
  rtp[0] = 0x80;
  rtp[1] = 0xe1;
  rtp.writeUInt16BE(seq & 0xffff, 2);
  rtp.writeUInt32BE(timestamp >>> 0, 4);
  rtp.writeUInt32BE(ssrc >>> 0, 8);
  if (long) {
    rtp[12] = 0x80 | ((len >> 8) & 0x0f);
    rtp[13] = len & 0xff;
    midiBytes.copy(rtp, 14);
  } else {
    rtp[12] = len & 0x0f;
    midiBytes.copy(rtp, 13);
  }
  return rtp;
}

export function unwrapRtpMidi(buf: Buffer): Buffer | null {
  if (!Buffer.isBuffer(buf) || buf.length < 13) return null;
  if ((buf[0] & 0xc0) !== 0x80) return null;
  const long = Boolean(buf[12]! & 0x80);
  const start = long ? 14 : 13;
  if (buf.length < start) return null;
  const len = long ? ((buf[12]! & 0x0f) << 8) | buf[13]! : buf[12]! & 0x0f;
  if (buf.length < start + len) return null;
  return Buffer.from(buf.subarray(start, start + len));
}

type AppleSession = {
  host: string;
  controlPort: number;
  dataPort: number;
  ssrc: number;
  initiator: number;
  seq: number;
  sockControl: dgram.Socket;
  sockData: dgram.Socket;
  lastCk: number;
  timer?: ReturnType<typeof setTimeout>;
  keepMs: number;
  timestamps: [bigint, bigint, bigint];
};

const g = globalThis as typeof globalThis & { __relayRtpMidi__?: Map<string, AppleSession> };
const sessions = (g.__relayRtpMidi__ ??= new Map());

type RtpMidiBytesHandler = (host: string, controlPort: number, midi: Buffer) => void;
let dataHandler: RtpMidiBytesHandler | undefined;

export function setRtpMidiBytesHandler(fn: RtpMidiBytesHandler | undefined) {
  dataHandler = fn;
}

export function sessionKey(host: string, controlPort: number) {
  return `${host}:${controlPort}`;
}

export function rtpMidiPoolSize() {
  return sessions.size;
}

function closeSock(sock?: dgram.Socket) {
  if (!sock) return;
  try { sock.close(); } catch { /* ignore */ }
}

export function dropSession(key: string) {
  const row = sessions.get(key);
  if (!row) return;
  sessions.delete(key);
  if (row.timer) clearTimeout(row.timer);
  const bye = packAppleMidi({ cmd: "BY", initiator: row.initiator, ssrc: row.ssrc });
  try { row.sockControl.send(bye, row.controlPort, row.host); } catch { /* ignore */ }
  try { row.sockData.send(bye, row.dataPort, row.host); } catch { /* ignore */ }
  closeSock(row.sockControl);
  closeSock(row.sockData);
}

function bumpIdle(row: AppleSession) {
  if (row.timer) clearTimeout(row.timer);
  row.timer = setTimeout(() => dropSession(sessionKey(row.host, row.controlPort)), row.keepMs);
}

function onControlMessage(row: AppleSession, msg: Buffer) {
  const ck = unpackCk(msg);
  if (ck) {
    row.lastCk = Date.now();
    if (ck.count === 0) {
      const ts: [bigint, bigint, bigint] = [ck.timestamps[0], nowTs(), 0n];
      try { row.sockControl.send(packCk({ ssrc: row.ssrc, count: 1, timestamps: ts }), row.controlPort, row.host); } catch { /* ignore */ }
    } else if (ck.count === 1) {
      const ts: [bigint, bigint, bigint] = [ck.timestamps[0], ck.timestamps[1], nowTs()];
      try { row.sockControl.send(packCk({ ssrc: row.ssrc, count: 2, timestamps: ts }), row.controlPort, row.host); } catch { /* ignore */ }
    }
    return;
  }
  const cmd = unpackAppleMidi(msg);
  if (cmd?.cmd === "BY") dropSession(sessionKey(row.host, row.controlPort));
}

function waitApple(sock: dgram.Socket, initiator: number, timeoutMs: number): Promise<{ cmd: AppleCmd; ssrc: number } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off("message", onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (msg: Buffer) => {
      const parsed = unpackAppleMidi(msg);
      if (!parsed || parsed.initiator !== initiator) return;
      if (parsed.cmd !== "OK" && parsed.cmd !== "NO") return;
      clearTimeout(timer);
      sock.off("message", onMsg);
      resolve({ cmd: parsed.cmd, ssrc: parsed.ssrc });
    };
    sock.on("message", onMsg);
  });
}

function bindEphemeral(sock: dgram.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(0, () => resolve());
  });
}

export async function ensureAppleMidi(opts: {
  host: string;
  controlPort: number;
  dataPort?: number;
  timeoutMs?: number;
  keepMs?: number;
  name?: string;
}): Promise<CommandResult> {
  const host = String(opts.host || "").trim();
  const controlPort = Number(opts.controlPort || 5004);
  const dataPort = Number(opts.dataPort || controlPort + 1);
  const key = sessionKey(host, controlPort);
  const existing = sessions.get(key);
  if (existing) {
    bumpIdle(existing);
    return { ok: true, message: "rtp-midi session" };
  }
  const timeoutMs = Math.max(50, opts.timeoutMs ?? 1500);
  const sockControl = dgram.createSocket("udp4");
  const sockData = dgram.createSocket("udp4");
  const ssrc = rand32();
  const initiator = rand32();
  try {
    await bindEphemeral(sockControl);
    await bindEphemeral(sockData);
  } catch (err) {
    closeSock(sockControl);
    closeSock(sockData);
    return { ok: false, message: err instanceof Error ? err.message : "RTP-MIDI bind failed" };
  }
  const invite = packAppleMidi({ cmd: "IN", initiator, ssrc, name: opts.name || "Relay" });
  sockControl.send(invite, controlPort, host);
  const ok = await waitApple(sockControl, initiator, timeoutMs);
  if (!ok || ok.cmd !== "OK") {
    closeSock(sockControl);
    closeSock(sockData);
    return { ok: false, message: ok?.cmd === "NO" ? "RTP-MIDI invitation rejected" : "RTP-MIDI invitation timeout" };
  }
  const dataInitiator = rand32();
  sockData.send(packAppleMidi({ cmd: "IN", initiator: dataInitiator, ssrc, name: opts.name || "Relay" }), dataPort, host);
  await waitApple(sockData, dataInitiator, Math.min(timeoutMs, 400));
  const timestamps: [bigint, bigint, bigint] = [nowTs(), 0n, 0n];
  sockControl.send(packCk({ ssrc, count: 0, timestamps }), controlPort, host);
  const row: AppleSession = {
    host,
    controlPort,
    dataPort,
    ssrc,
    initiator,
    seq: 1,
    sockControl,
    sockData,
    lastCk: Date.now(),
    keepMs: opts.keepMs ?? 60_000,
    timestamps,
  };
  sockControl.on("message", (msg) => onControlMessage(row, msg));
  sockControl.on("error", () => dropSession(key));
  sockData.on("error", () => dropSession(key));
  sockData.on("message", (msg) => {
    if (unpackAppleMidi(msg) || unpackCk(msg)) return;
    const midi = unwrapRtpMidi(msg);
    if (midi && dataHandler) dataHandler(row.host, row.controlPort, midi);
  });
  sessions.set(key, row);
  bumpIdle(row);
  return { ok: true, message: "rtp-midi session" };
}

export async function sendRtpMidiCommand(opts: {
  host: string;
  controlPort: number;
  dataPort?: number;
  midi: Buffer;
  keepMs?: number;
  timeoutMs?: number;
}): Promise<CommandResult> {
  if (!opts.midi.length) return { ok: false, message: "RTP-MIDI empty" };
  const up = await ensureAppleMidi({
    host: opts.host,
    controlPort: opts.controlPort,
    dataPort: opts.dataPort,
    keepMs: opts.keepMs,
    timeoutMs: opts.timeoutMs,
  });
  if (!up.ok) return up;
  const row = sessions.get(sessionKey(opts.host, opts.controlPort));
  if (!row) return { ok: false, message: "RTP-MIDI no session" };
  row.seq = (row.seq + 1) & 0xffff;
  const pkt = wrapRtpMidi(row.ssrc, row.seq, opts.midi);
  return new Promise((resolve) => {
    row.sockData.send(pkt, row.dataPort, row.host, (err: Error | null) => {
      bumpIdle(row);
      resolve(err ? { ok: false, message: err.message } : { ok: true, message: "rtp-midi sent" });
    });
  });
}
