import type { CommandResult } from "./types";
import { sendUdp, sendUdpReply } from "./udp.ts";
import { sendUdpHeld } from "./udp-hold.ts";

export type OscArg = { type: "s" | "i" | "f" | "b"; value: string | number | Buffer };

function pad4(buf: Buffer): Buffer {
  const n = (4 - (buf.length % 4)) % 4;
  return n ? Buffer.concat([buf, Buffer.alloc(n)]) : buf;
}

function oscString(text: string): Buffer {
  return pad4(Buffer.concat([Buffer.from(String(text), "utf8"), Buffer.from([0])]));
}

export function encodeOsc(path: string, args: OscArg[] = []): Buffer {
  const addr = String(path || "").trim();
  if (!addr.startsWith("/")) throw new Error("OSC path must start with /");
  const parts: Buffer[] = [oscString(addr)];
  const tags = `,${args.map((a) => a.type).join("")}`;
  parts.push(oscString(tags));
  for (const arg of args) {
    if (arg.type === "i") {
      const n = Number(arg.value);
      if (!Number.isFinite(n)) throw new Error("OSC int is not a number");
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.trunc(n), 0);
      parts.push(b);
    } else if (arg.type === "f") {
      const n = Number(arg.value);
      if (!Number.isFinite(n)) throw new Error("OSC float is not a number");
      const b = Buffer.alloc(4);
      b.writeFloatBE(n, 0);
      parts.push(b);
    } else if (arg.type === "s") {
      parts.push(oscString(String(arg.value ?? "")));
    } else if (arg.type === "b") {
      const raw = Buffer.isBuffer(arg.value) ? arg.value : Buffer.from(String(arg.value ?? ""), "utf8");
      const head = Buffer.alloc(4);
      head.writeInt32BE(raw.length, 0);
      parts.push(pad4(Buffer.concat([head, raw])));
    } else {
      throw new Error("OSC type not s/i/f/b");
    }
  }
  return Buffer.concat(parts);
}

function readPaddedString(buf: Buffer, offset: number): { text: string; next: number } | null {
  if (offset >= buf.length) return null;
  const end = buf.indexOf(0, offset);
  if (end < 0) return null;
  const text = buf.toString("utf8", offset, end);
  const next = end + 1 + ((4 - ((end + 1 - offset) % 4)) % 4);
  if (next > buf.length) return null;
  return { text, next };
}

export function decodeOsc(buf: Buffer): { path: string; args: string[] } | null {
  if (!Buffer.isBuffer(buf) || !buf.length || buf[0] !== 0x2f) return null;
  const path = readPaddedString(buf, 0);
  if (!path) return null;
  const tags = readPaddedString(buf, path.next);
  if (!tags || !tags.text.startsWith(",")) return null;
  const args: string[] = [];
  let off = tags.next;
  for (const tag of tags.text.slice(1)) {
    if (tag === "i") {
      if (off + 4 > buf.length) return null;
      args.push(String(buf.readInt32BE(off)));
      off += 4;
    } else if (tag === "f") {
      if (off + 4 > buf.length) return null;
      args.push(String(buf.readFloatBE(off)));
      off += 4;
    } else if (tag === "s") {
      const text = readPaddedString(buf, off);
      if (!text) return null;
      args.push(text.text);
      off = text.next;
    } else if (tag === "b") {
      if (off + 4 > buf.length) return null;
      const len = buf.readInt32BE(off);
      off += 4;
      if (len < 0 || off + len > buf.length) return null;
      args.push(buf.subarray(off, off + len).toString("utf8"));
      off += len + ((4 - (len % 4)) % 4);
    } else {
      return null;
    }
  }
  return { path: path.text, args };
}

/** One argument is the result text. Several are joined. None falls back to the path. */
export function oscReplyText(message: { path: string; args: string[] }): string {
  if (message.args.length === 1) return message.args[0] ?? "";
  if (message.args.length > 1) return message.args.join(" ");
  return message.path;
}

async function oscFromRaw(raw: Buffer | undefined): Promise<CommandResult> {
  if (!raw) return { ok: false, message: "bad osc" };
  const decoded = decodeOsc(raw);
  if (!decoded) return { ok: false, message: "bad osc" };
  return { ok: true, message: oscReplyText(decoded) };
}

export async function sendOsc(host: string, port: number, path: string, args: OscArg[] = [], localAddress?: string): Promise<CommandResult> {
  try {
    const buf = encodeOsc(path, args);
    return sendUdp(host, port, buf, localAddress);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "OSC encode failed" };
  }
}

export async function sendOscCommand(opts: {
  host: string;
  port: number;
  path: string;
  types?: string;
  values?: string[];
  localAddress?: string;
  reply?: { timeoutMs: number };
  hold?: { key: string; keepMs: number };
}): Promise<CommandResult> {
  const types = opts.types || "";
  const values = opts.values || [];
  if (types.length !== values.length) return { ok: false, message: "OSC types/values length" };
  const args: OscArg[] = [];
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    if (t !== "s" && t !== "i" && t !== "f" && t !== "b") return { ok: false, message: "OSC type not s/i/f/b" };
    args.push({ type: t, value: values[i] ?? "" });
  }
  let buf: Buffer;
  try {
    buf = encodeOsc(opts.path, args);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "OSC encode failed" };
  }
  if (opts.hold) {
    const got = await sendUdpHeld({
      key: opts.hold.key,
      host: opts.host,
      port: opts.port,
      buf,
      keepMs: opts.hold.keepMs,
      timeoutMs: opts.reply?.timeoutMs ?? 3000,
      localAddress: opts.localAddress,
      reply: Boolean(opts.reply),
    });
    if (!opts.reply) return got.ok ? { ok: true, message: "udp sent" } : got;
    if (!got.ok) return got;
    return oscFromRaw(got.raw);
  }
  if (opts.reply) {
    const got = await sendUdpReply({
      host: opts.host,
      port: opts.port,
      buf,
      timeoutMs: opts.reply.timeoutMs,
      localAddress: opts.localAddress,
    });
    if (!got.ok) return got;
    return oscFromRaw(got.raw);
  }
  return sendUdp(opts.host, opts.port, buf, opts.localAddress);
}
