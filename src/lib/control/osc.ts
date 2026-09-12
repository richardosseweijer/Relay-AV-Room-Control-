import type { CommandResult } from "./types";
import { sendUdp } from "./udp.ts";

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

export async function sendOsc(host: string, port: number, path: string, args: OscArg[] = []): Promise<CommandResult> {
  try {
    const buf = encodeOsc(path, args);
    return sendUdp(host, port, buf);
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
  return sendOsc(opts.host, opts.port, opts.path, args);
}
