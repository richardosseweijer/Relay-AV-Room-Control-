/** Engine framing for one reliable UDP session. Not a product protocol.
 *  A different header is another module, not new driver keys.
 *
 *  Bytes: "RS" | type u8 | 0 | session u32 | seq u32 | ack u32 | len u16 | payload.
 *  Types: 1 hello, 2 hello-ok, 3 data, 4 ack.
 *  The driver supplies the hello payload and the inner command bytes. */
import dgram from "node:dgram";
import type { CommandResult } from "./types";
import { decodeWire, encodeWire } from "./engine-wire.ts";
import { noteUdpPush } from "./udp-hold.ts";

export const UDP_SEQ_HELLO = 1;
export const UDP_SEQ_OK = 2;
export const UDP_SEQ_DATA = 3;
export const UDP_SEQ_ACK = 4;

const HEAD = 18;

export type UdpSeqPacket = {
  type: number;
  sessionId: number;
  seq: number;
  ack: number;
  payload: Buffer;
};

export function packUdpSeq(opts: { type: number; sessionId: number; seq: number; ack: number; payload?: Buffer }): Buffer {
  const payload = opts.payload ?? Buffer.alloc(0);
  const buf = Buffer.alloc(HEAD + payload.length);
  buf.write("RS", 0, "ascii");
  buf[2] = opts.type & 0xff;
  buf[3] = 0;
  buf.writeUInt32BE(opts.sessionId >>> 0, 4);
  buf.writeUInt32BE(opts.seq >>> 0, 8);
  buf.writeUInt32BE(opts.ack >>> 0, 12);
  buf.writeUInt16BE(payload.length & 0xffff, 16);
  payload.copy(buf, HEAD);
  return buf;
}

/** Every complete frame in the datagram. Length is consumed so a skipped message does not eat the next one. */
export function unpackUdpSeqAll(buf: Buffer): UdpSeqPacket[] {
  if (!Buffer.isBuffer(buf)) return [];
  const out: UdpSeqPacket[] = [];
  let off = 0;
  while (off + HEAD <= buf.length) {
    if (buf[off] !== 0x52 || buf[off + 1] !== 0x53) break;
    const len = buf.readUInt16BE(off + 16);
    if (len < 0 || off + HEAD + len > buf.length) break;
    out.push({
      type: buf[off + 2] ?? 0,
      sessionId: buf.readUInt32BE(off + 4),
      seq: buf.readUInt32BE(off + 8),
      ack: buf.readUInt32BE(off + 12),
      payload: Buffer.from(buf.subarray(off + HEAD, off + HEAD + len)),
    });
    off += HEAD + len;
  }
  return out;
}

export function unpackUdpSeq(buf: Buffer): UdpSeqPacket | null {
  return unpackUdpSeqAll(buf)[0] ?? null;
}

/** Opening bytes from driver.session.connect[0]. Missing means an empty hello, not a hex error. */
export function udpSeqOpening(connect: string | undefined, encoding: string | undefined, lineEnding?: string): Buffer | { error: string } {
  if (!connect) return Buffer.alloc(0);
  return encodeWire(connect, encoding, lineEnding);
}

type Live = {
  key: string;
  host: string;
  port: number;
  localAddress?: string;
  sock: dgram.Socket;
  keepMs: number;
  timer?: ReturnType<typeof setTimeout>;
  sessionId: number;
  localSeq: number;
  peerSeq: number;
  inbox: UdpSeqPacket[];
  wake?: () => void;
  busy: boolean;
  closed: boolean;
};

const g = globalThis as typeof globalThis & { __relayUdpSeq__?: Map<string, Live> };
const pool = (g.__relayUdpSeq__ ??= new Map());
const tails = new Map<string, Promise<unknown>>();

export function udpSeqPoolSize() {
  return pool.size;
}

function closeSock(sock?: dgram.Socket) {
  if (!sock) return;
  try { sock.close(); } catch { /* ignore */ }
}

function abandon(row: Live) {
  if (row.closed) return;
  row.closed = true;
  if (pool.get(row.key) === row) pool.delete(row.key);
  if (row.timer) clearTimeout(row.timer);
  row.wake?.();
  closeSock(row.sock);
}

export function dropUdpSeq(key: string) {
  const row = pool.get(key);
  if (!row) return;
  abandon(row);
}

function bump(row: Live) {
  if (row.closed) return;
  if (row.timer) clearTimeout(row.timer);
  row.timer = setTimeout(() => dropUdpSeq(row.key), row.keepMs);
}

function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const done = run.then(() => undefined, () => undefined);
  tails.set(key, done);
  void done.then(() => { if (tails.get(key) === done) tails.delete(key); });
  return run;
}

function randId() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

function bindSock(sock: dgram.Socket, localAddress: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      sock.off("error", fail);
      reject(err);
    };
    sock.on("error", fail);
    sock.bind(0, localAddress, () => {
      sock.off("error", fail);
      resolve();
    });
  });
}

function send(row: Live, buf: Buffer): Promise<CommandResult | undefined> {
  if (row.closed) return Promise.resolve({ ok: false, message: "timeout" });
  return new Promise((resolve) => {
    try {
      row.sock.send(buf, row.port, row.host, (err) => {
        resolve(err ? { ok: false, message: err.message } : undefined);
      });
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : "udp failed" });
    }
  });
}

function ackPeer(row: Live, seq: number): Promise<void> {
  row.peerSeq = seq >>> 0;
  const buf = packUdpSeq({
    type: UDP_SEQ_ACK,
    sessionId: row.sessionId,
    seq: row.localSeq,
    ack: seq >>> 0,
    payload: Buffer.alloc(0),
  });
  return send(row, buf).then(() => undefined);
}

function ingest(row: Live, msg: Buffer) {
  if (row.closed) return;
  const frames = unpackUdpSeqAll(msg);
  if (!frames.length) return;
  let woke = false;
  for (const pkt of frames) {
    if (pkt.sessionId !== row.sessionId) continue;
    bump(row);
    if (row.busy) {
      row.inbox.push(pkt);
      woke = true;
      continue;
    }
    if (pkt.type === UDP_SEQ_DATA) {
      void ackPeer(row, pkt.seq);
      noteUdpPush(row.key, pkt.payload);
    }
  }
  if (woke) row.wake?.();
}

function drainIdle(row: Live) {
  while (row.inbox.length && !row.busy && !row.closed) {
    const pkt = row.inbox.shift();
    if (!pkt || pkt.type !== UDP_SEQ_DATA) continue;
    void ackPeer(row, pkt.seq);
    noteUdpPush(row.key, pkt.payload);
  }
}

function take(row: Live, timeoutMs: number): Promise<UdpSeqPacket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: UdpSeqPacket | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (row.wake === wake) row.wake = undefined;
      resolve(value);
    };
    const wake = () => {
      if (row.closed) {
        finish(null);
        return;
      }
      const pkt = row.inbox.shift();
      if (pkt) finish(pkt);
    };
    const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
    wake();
    if (!settled) {
      row.wake = wake;
      wake();
    }
  });
}

async function openSession(opts: {
  key: string;
  host: string;
  port: number;
  hello: Buffer;
  timeoutMs: number;
  keepMs: number;
  localAddress?: string;
}): Promise<Live | CommandResult> {
  const current = pool.get(opts.key);
  if (current && !current.closed && current.host === opts.host && current.port === opts.port && current.localAddress === opts.localAddress) {
    bump(current);
    return current;
  }
  if (current) abandon(current);
  const sock = dgram.createSocket("udp4");
  const row: Live = {
    key: opts.key,
    host: opts.host,
    port: opts.port,
    localAddress: opts.localAddress,
    sock,
    keepMs: opts.keepMs,
    sessionId: randId(),
    localSeq: 0,
    peerSeq: 0,
    inbox: [],
    busy: true,
    closed: false,
  };
  if (opts.localAddress) {
    try {
      await bindSock(sock, opts.localAddress);
    } catch (err) {
      closeSock(sock);
      return { ok: false, message: err instanceof Error ? err.message : "udp failed" };
    }
  }
  sock.on("message", (msg) => ingest(row, msg));
  sock.on("error", () => {
    if (pool.get(row.key) === row) dropUdpSeq(row.key);
    else abandon(row);
  });
  const hello = packUdpSeq({ type: UDP_SEQ_HELLO, sessionId: row.sessionId, seq: 0, ack: 0, payload: opts.hello });
  const failed = await send(row, hello);
  if (failed) {
    abandon(row);
    return failed;
  }
  const ok = await take(row, opts.timeoutMs);
  if (row.closed || !ok || ok.type !== UDP_SEQ_OK || ok.sessionId !== row.sessionId) {
    abandon(row);
    return { ok: false, message: "timeout" };
  }
  pool.set(opts.key, row);
  bump(row);
  return row;
}

function resultFrom(body: Buffer | undefined, reply: boolean, encoding: string | undefined): CommandResult {
  if (body && body.length) return { ok: true, message: decodeWire(body, encoding) };
  if (reply && body) return { ok: true, message: decodeWire(body, encoding) };
  return { ok: true, message: "ok" };
}

export async function sendUdpSeq(opts: {
  key: string;
  host: string;
  port: number;
  payload: Buffer;
  hello: Buffer;
  timeoutMs: number;
  keepMs: number;
  localAddress?: string;
  encoding?: string;
  reply: boolean;
}): Promise<CommandResult> {
  return lock(opts.key, async () => {
    const opened = await openSession(opts);
    if (!("sock" in opened)) return opened;
    const row = opened;
    if (row.closed) return { ok: false, message: "timeout" };
    row.busy = true;
    const budget = Math.max(1, opts.timeoutMs);
    try {
      row.localSeq = (row.localSeq + 1) >>> 0;
      const seq = row.localSeq;
      const packet = packUdpSeq({
        type: UDP_SEQ_DATA,
        sessionId: row.sessionId,
        seq,
        ack: row.peerSeq,
        payload: opts.payload,
      });
      const failed = await send(row, packet);
      if (failed) {
        abandon(row);
        return failed;
      }
      bump(row);
      let until = Date.now() + budget;
      let resent = false;
      let acked = false;
      let body: Buffer | undefined;
      while (Date.now() < until) {
        const msg = await take(row, until - Date.now());
        if (row.closed) return { ok: false, message: "timeout" };
        if (!msg) {
          if (!resent) {
            resent = true;
            const again = await send(row, packet);
            if (again) {
              abandon(row);
              return again;
            }
            until = Date.now() + budget;
            continue;
          }
          abandon(row);
          return { ok: false, message: "timeout" };
        }
        if (msg.type === UDP_SEQ_DATA) {
          await ackPeer(row, msg.seq);
          if (msg.ack === seq) {
            body = msg.payload;
            acked = true;
          }
        } else if (msg.type === UDP_SEQ_ACK && msg.ack === seq) {
          acked = true;
        }
        if (acked && (!opts.reply || body)) {
          return resultFrom(body, opts.reply, opts.encoding);
        }
      }
      abandon(row);
      return { ok: false, message: "timeout" };
    } finally {
      if (!row.closed) {
        row.busy = false;
        drainIdle(row);
        bump(row);
      }
    }
  });
}
