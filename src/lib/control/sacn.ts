import type { CommandResult } from "./types";
import { sendUdpMulticast } from "./udp.ts";

const ACN_PID = Buffer.from("ASC-E1.17\0\0\0", "ascii");
const seqByKey = new Map<string, number>();
/** Retained DMX slots per source/universe/iface so channel writes merge instead of zero-filling. */
const slotsByKey = new Map<string, Uint8Array>();
/** Last write time per slots key — used for LRU bound (universe churn). */
const slotsTouch = new Map<string, number>();
/** Hard cap so abandoned universe/iface keys cannot grow without bound. */
const MAX_SLOT_KEYS = 64;

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

function slotsKey(cidKey: string, universe: number, localAddress?: string): string {
  return `${cidKey}\0${universe}\0${localAddress ?? ""}`;
}

function evictOldestSlots(count: number) {
  if (count <= 0) return;
  const ranked = [...slotsTouch.entries()].sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < count && i < ranked.length; i++) {
    const key = ranked[i]![0];
    slotsByKey.delete(key);
    slotsTouch.delete(key);
  }
}

function getOrCreateSlots(cidKey: string, universe: number, localAddress?: string): Uint8Array {
  const key = slotsKey(cidKey, universe, localAddress);
  let slots = slotsByKey.get(key);
  if (!slots) {
    slots = new Uint8Array(512);
    slotsByKey.set(key, slots);
  }
  slotsTouch.set(key, Date.now());
  if (slotsByKey.size > MAX_SLOT_KEYS) evictOldestSlots(slotsByKey.size - MAX_SLOT_KEYS);
  return slots;
}

/** Test helper: copy of retained slots, or undefined if never written. */
export function peekSacnSlots(opts: {
  universe: number;
  cidKey: string;
  localAddress?: string;
}): Uint8Array | undefined {
  const slots = slotsByKey.get(slotsKey(opts.cidKey, opts.universe, opts.localAddress));
  return slots ? Uint8Array.from(slots) : undefined;
}

/** Test helper: drop retained universe buffers (and leave sequence counters alone). */
export function clearSacnSlotBuffers(): void {
  slotsByKey.clear();
  slotsTouch.clear();
}

/** Drop seq + slot buffers for cidKeys not in keep (device removed). Live devices untouched. */
export function retainSacnCidKeys(keep: Iterable<string>): void {
  const set = new Set([...keep].map(String).filter(Boolean));
  for (const cid of [...seqByKey.keys()]) {
    if (!set.has(cid)) seqByKey.delete(cid);
  }
  for (const key of [...slotsByKey.keys()]) {
    const cid = key.split("\0")[0] ?? "";
    if (!set.has(cid)) {
      slotsByKey.delete(key);
      slotsTouch.delete(key);
    }
  }
}

/** Test helper */
export function sacnMapSizes() {
  return { seq: seqByKey.size, slots: slotsByKey.size };
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
  localAddress?: string;
}): Promise<CommandResult> {
  const universe = Number(opts.universe);
  if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
    return { ok: false, message: "sACN universe 1–63999" };
  }
  const slots = getOrCreateSlots(opts.cidKey, universe, opts.localAddress);
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
  return sendUdpMulticast({ group: sacnGroup(universe), port: 5568, buf, ttl: 1, localAddress: opts.localAddress });
}
