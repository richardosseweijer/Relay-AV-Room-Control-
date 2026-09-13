import { createHmac, timingSafeEqual } from "node:crypto";

const used = new Map<string, number>();

export function peerKey(room: { peerSecret?: string | null; configPin?: string | null }) {
  return String(room.peerSecret || "").trim();
}

export function hostnameOf(host: string) {
  const t = host.trim().toLowerCase();
  if (!t) return "";
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    return end > 0 ? t.slice(1, end) : t;
  }
  if (/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(t)) return t.split(":")[0];
  if (t.includes(":") && !t.startsWith("::") && t.split(":").length === 2) return t.split(":")[0];
  return t;
}

export function isLoopbackHostname(host: string) {
  const name = hostnameOf(host);
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

export function isLoopbackRequest(request: Request) {
  const hosts: string[] = [];
  try {
    hosts.push(new URL(request.url).hostname);
  } catch {
    /* ignore */
  }
  const header = request.headers.get("host");
  if (header) hosts.push(header);
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) hosts.push(fwd);
  const fwdHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwdHost) hosts.push(fwdHost);
  const named = hosts.map((h) => h.trim()).filter(Boolean);
  if (!named.length) return false;
  return named.every(isLoopbackHostname);
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

/** Loopback GET may be unsigned so Foyer can read occupancy before a secret is pasted. HMAC, if sent, must match. POST still requires HMAC. */
export function authorizePeerGet(opts: { key: string; request: Request; path?: string }) {
  const sig = opts.request.headers.get("x-relay-auth") || "";
  const ts = opts.request.headers.get("x-relay-ts") || "";
  if (isLoopbackRequest(opts.request) && !sig && !ts) return true;
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
