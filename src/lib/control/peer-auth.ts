import { createHmac, timingSafeEqual } from "node:crypto";

export function peerKey(room: { peerSecret?: string | null; configPin?: string | null }) {
  return String(room.peerSecret || room.configPin || "").trim();
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
  const expect = signPeer(opts.key, opts.method, opts.path, opts.ts, opts.body);
  try {
    const a = Buffer.from(expect, "hex");
    const b = Buffer.from(opts.sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
