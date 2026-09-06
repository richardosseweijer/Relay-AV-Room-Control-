import { createHmac, timingSafeEqual } from "node:crypto";

const used = new Map<string, number>();

export function peerKey(room: { peerSecret?: string | null; configPin?: string | null }) {
  return String(room.peerSecret || "").trim();
}

export function signPeer(key: string, method: string, path: string, ts: string, body: string) {
  return createHmac("sha256", key).update(`${ts}\n${method.toUpperCase()}\n${path}\n${body}`).digest("hex");
}

export function verifyPeerRequest(opts: {
  key: string;
  method: string;
  path: string;
  ts: string;
  body: string;
  sig: string;
}) {
  if (!opts.key || !opts.sig || !opts.ts) return false;
  const stamp = Number(opts.ts);
  if (!Number.isFinite(stamp) || Math.abs(Date.now() - stamp) > 90_000) return false;
  const sig = opts.sig.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expect = signPeer(opts.key, opts.method, opts.path, opts.ts, opts.body);
  const replay = `${expect}:${opts.ts}`;
  const now = Date.now();
  for (const [key, at] of used) {
    if (now - at > 90_000) used.delete(key);
  }
  if (used.has(replay)) return false;
  try {
    const a = Buffer.from(expect, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    used.set(replay, now);
    return true;
  } catch {
    return false;
  }
}
