/** One UDP socket per device while session.keepMs is set. Not a product protocol. */
import dgram from "node:dgram";
import type { CommandResult } from "./types";
import { decodeWire } from "./engine-wire.ts";

type Waiter = { resolve: (buf: Buffer | null) => void; timer: ReturnType<typeof setTimeout> };

type Hold = {
  key: string;
  host: string;
  port: number;
  localAddress?: string;
  sock: dgram.Socket;
  keepMs: number;
  timer?: ReturnType<typeof setTimeout>;
  waiter?: Waiter;
};

const g = globalThis as typeof globalThis & { __relayUdpHold__?: Map<string, Hold> };
const pool = (g.__relayUdpHold__ ??= new Map());
const tails = new Map<string, Promise<unknown>>();

type PushHandler = (deviceId: string, buf: Buffer) => void;
let pushHandler: PushHandler | undefined;

export function setUdpPushHandler(fn: PushHandler | undefined) {
  pushHandler = fn;
}

export function noteUdpPush(deviceId: string, buf: Buffer) {
  pushHandler?.(deviceId, buf);
}

export function udpHoldPoolSize() {
  return pool.size;
}

function closeSock(sock?: dgram.Socket) {
  if (!sock) return;
  try { sock.close(); } catch { /* ignore */ }
}

export function dropUdpHold(key: string) {
  const row = pool.get(key);
  if (!row) return;
  pool.delete(key);
  if (row.timer) clearTimeout(row.timer);
  if (row.waiter) {
    clearTimeout(row.waiter.timer);
    const waiter = row.waiter;
    row.waiter = undefined;
    waiter.resolve(null);
  }
  closeSock(row.sock);
}

function bump(row: Hold) {
  if (row.timer) clearTimeout(row.timer);
  row.timer = setTimeout(() => dropUdpHold(row.key), row.keepMs);
}

function onMessage(row: Hold, msg: Buffer) {
  bump(row);
  if (row.waiter) {
    clearTimeout(row.waiter.timer);
    const waiter = row.waiter;
    row.waiter = undefined;
    waiter.resolve(Buffer.from(msg));
    return;
  }
  pushHandler?.(row.key, Buffer.from(msg));
}

function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const done = run.then(() => undefined, () => undefined);
  tails.set(key, done);
  void done.then(() => { if (tails.get(key) === done) tails.delete(key); });
  return run;
}

function openHold(opts: { key: string; host: string; port: number; keepMs: number; localAddress?: string }): Promise<Hold> {
  const existing = pool.get(opts.key);
  if (existing && existing.host === opts.host && existing.port === opts.port && existing.localAddress === opts.localAddress) {
    return Promise.resolve(existing);
  }
  if (existing) dropUdpHold(opts.key);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const row: Hold = {
      key: opts.key,
      host: opts.host,
      port: opts.port,
      localAddress: opts.localAddress,
      sock,
      keepMs: opts.keepMs,
    };
    let settled = false;
    sock.on("error", (err) => {
      if (pool.get(opts.key)?.sock === sock) dropUdpHold(opts.key);
      else closeSock(sock);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    sock.on("message", (msg) => onMessage(row, msg));
    const ready = () => {
      if (settled) return;
      settled = true;
      pool.set(opts.key, row);
      bump(row);
      resolve(row);
    };
    if (opts.localAddress) sock.bind(0, opts.localAddress, ready);
    else ready();
  });
}

function waitOne(row: Hold, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (row.waiter) row.waiter = undefined;
      resolve(null);
    }, timeoutMs);
    row.waiter = { resolve, timer };
  });
}

export async function sendUdpHeld(opts: {
  key: string;
  host: string;
  port: number;
  buf: Buffer;
  keepMs: number;
  timeoutMs: number;
  localAddress?: string;
  encoding?: string;
  reply: boolean;
}): Promise<CommandResult & { raw?: Buffer }> {
  return lock(opts.key, async () => {
    let row: Hold;
    try {
      row = await openHold(opts);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "udp failed" };
    }
    bump(row);
    const pending = opts.reply ? waitOne(row, opts.timeoutMs) : undefined;
    const sent = await new Promise<CommandResult | undefined>((resolve) => {
      row.sock.send(opts.buf, opts.port, opts.host, (err) => {
        resolve(err ? { ok: false, message: err.message } : undefined);
      });
    });
    if (sent) {
      if (row.waiter) {
        clearTimeout(row.waiter.timer);
        row.waiter = undefined;
      }
      return sent;
    }
    if (!pending) return { ok: true, message: "udp sent" };
    const msg = await pending;
    if (!msg) return { ok: false, message: "timeout" };
    return { ok: true, message: decodeWire(msg, opts.encoding), raw: msg };
  });
}
