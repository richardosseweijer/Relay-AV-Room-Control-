import { createHmac, timingSafeEqual } from "node:crypto";

const used = new Map<string, number>();

export function peerKey(room: { peerSecret?: string | null; configPin?: string | null }) {
  return String(room.peerSecret || "").trim();
}

/** TCP peer only. Host / X-Forwarded-* are not loopback. */
export function isLoopbackIp(ip: string) {
  const a = ip.trim().toLowerCase();
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

type NodeReq = { socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string } };

export function tcpPeerAddress(request: Request): string | null {
  const row = request as Request & {
    socket?: { remoteAddress?: string };
    runtime?: { node?: { req?: NodeReq } };
  };
  const raw =
    row.runtime?.node?.req?.socket?.remoteAddress
    || row.runtime?.node?.req?.connection?.remoteAddress
    || row.socket?.remoteAddress
    || "";
  const ip = String(raw).trim();
  return ip || null;
}

export function isTcpLoopback(request: Request) {
  const ip = tcpPeerAddress(request);
  if (!ip) return false;
  return isLoopbackIp(ip);
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
  if (opts.sig !== opts.sig.trim().toLowerCase()) return false;
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

/** Unsigned GET only if the TCP peer is loopback. HMAC, if sent, must match. POST still requires HMAC. */
export function authorizePeerGet(opts: { key: string; request: Request; path?: string }) {
  const sig = opts.request.headers.get("x-relay-auth") || "";
  const ts = opts.request.headers.get("x-relay-ts") || "";
  if (isTcpLoopback(opts.request) && !sig && !ts) return true;
  if (!opts.key) return false;
  return verifyPeerRequest({
    key: opts.key,
    method: "GET",
    path: opts.path ?? "/api/peer",
    ts,
    body: "",
    sig,
  });
}
