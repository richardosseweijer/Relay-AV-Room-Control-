import type { CommandResult } from "./types";
import { sendUdpMulticast } from "./udp.ts";

const ACN_PID = Buffer.from("ASC-E1.17\0\0\0", "ascii");
const seqByKey = new Map<string, number>();

export function sacnGroup(universe: number): string {
  const u = universe & 0xffff;
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

export function cidFrom(key: string): Buffer {
  const out = Buffer.alloc(16);
  const src = Buffer.from(String(key || "relay"), "utf8");
  for (let i = 0; i < 16; i++) out[i] = src[i % Math.max(1, src.length)]!;
  return out;
}

export function encodeSacn(opts: {
  universe: number;
  priority: number;
  cid: Buffer;
  sequence: number;
  slots: Uint8Array;
  sourceName?: string;
}): Buffer {
  const buf = Buffer.alloc(638);
  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  ACN_PID.copy(buf, 4);
  buf.writeUInt16BE(0x726e, 16);
  buf.writeUInt32BE(4, 18);
  opts.cid.subarray(0, 16).copy(buf, 22);
  buf.writeUInt16BE(0x7258, 38);
  buf.writeUInt32BE(2, 40);
  Buffer.from(String(opts.sourceName || "Relay").slice(0, 63), "utf8").copy(buf, 44);
  buf[108] = Math.max(0, Math.min(200, opts.priority | 0));
  buf.writeUInt16BE(0, 109);
  buf[111] = opts.sequence & 0xff;
  buf[112] = 0;
  buf.writeUInt16BE(opts.universe & 0xffff, 113);
  buf.writeUInt16BE(0x720b, 115);
  buf[117] = 0x02;
  buf[118] = 0xa1;
  buf.writeUInt16BE(0, 119);
  buf.writeUInt16BE(1, 121);
  buf.writeUInt16BE(513, 123);
  buf[125] = 0;
  Buffer.from(opts.slots.subarray(0, 512)).copy(buf, 126);
  return buf;
}

export async function sendSacnCommand(opts: {
  universe: number;
  slot?: number;
  value?: string | number;
  cidKey: string;
  priority?: number;
}): Promise<CommandResult> {
  const universe = Number(opts.universe);
  if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
    return { ok: false, message: "sACN universe 1–63999" };
  }
  const slots = new Uint8Array(512);
  if (opts.slot !== undefined) {
    const slot = Number(opts.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 512) return { ok: false, message: "sACN slot 1–512" };
    const n = Number(opts.value);
    if (!Number.isFinite(n)) return { ok: false, message: "sACN value 0–255" };
    slots[slot - 1] = Math.max(0, Math.min(255, Math.trunc(n)));
  }
  const seq = (seqByKey.get(opts.cidKey) ?? 0) & 0xff;
  seqByKey.set(opts.cidKey, seq + 1);
  const buf = encodeSacn({
    universe,
    priority: opts.priority ?? 100,
    cid: cidFrom(opts.cidKey),
    sequence: seq,
    slots,
  });
  return sendUdpMulticast({ group: sacnGroup(universe), port: 5568, buf, ttl: 1 });
}
