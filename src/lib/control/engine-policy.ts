import type { TraceLine } from "./types";
import { isSecretKey } from "./secrets.ts";

const g = globalThis as typeof globalThis & { __relayTraces__?: Record<string, TraceLine[]> };

export function traces(): Record<string, TraceLine[]> {
  if (!g.__relayTraces__) g.__relayTraces__ = {};
  return g.__relayTraces__;
}

export function allowedLanHost(host: string | undefined, opts?: { localOk?: boolean }) {
  const raw = String(host ?? "").trim();
  if (!raw) return false;
  if (/^(file:|unix:|\\\\)/i.test(raw) || raw.startsWith("/")) return false;
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(raw)) return Boolean(opts?.localOk);
  const m = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Build http(s)://host:port + path without letting path rewrite authority (SSRF).
 * Path must be path-only: start with `/`, no `@`. After parse, hostname/port must match.
 */
export function safeLanHttpUrl(
  proto: string,
  host: string,
  port: number | string | undefined,
  path: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const scheme = String(proto || "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return { ok: false, message: "Invalid protocol" };
  const h = String(host ?? "").trim();
  if (!h) return { ok: false, message: "No host" };
  const rawPath = String(path ?? "");
  if (!rawPath.startsWith("/") || rawPath.includes("@")) {
    return { ok: false, message: "Invalid path" };
  }
  const portNum = Number(port);
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, message: "Invalid port" };
  }
  const url = `${scheme}://${h}:${portNum}${rawPath}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Invalid path" };
  }
  if (parsed.hostname.toLowerCase() !== h.toLowerCase()) {
    return { ok: false, message: "Invalid path" };
  }
  const defaultPort = scheme === "https" ? 443 : 80;
  const actualPort = Number(parsed.port || defaultPort);
  if (actualPort !== portNum) {
    return { ok: false, message: "Invalid path" };
  }
  return { ok: true, url };
}


/** Scrub free-text logs/traces using the same key policy as redactAuth / isSecretKey. */
export function scrubSecret(text: string) {
  return String(text ?? "")
    .replace(/("([^"]+)"\s*:\s*")[^"]*/g, (match, prefix: string, key: string) =>
      isSecretKey(key) ? `${prefix}***` : match,
    )
    .replace(/\btoken\s+[A-Za-z0-9._+/=-]{3,}/gi, "token ***")
    .replace(/\bbearer\s+[A-Za-z0-9._+/=-]{3,}/gi, "Bearer ***")
    .replace(/([A-Za-z0-9_.-]+)=([^&\s"]+)/gi, (match, key: string) =>
      isSecretKey(key) ? `${key}=***` : match,
    )
    // Telegram Bot API path + BotFather-shaped literals (never log the token).
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/gi, "/bot***")
    .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***");
}

export function pushTrace(deviceId: string, dir: TraceLine["dir"], text: string) {
  const bag = traces();
  const list = bag[deviceId] ?? (bag[deviceId] = []);
  list.unshift({ at: Date.now(), dir, text: scrubSecret(text).slice(0, 500) });
  if (list.length > 40) list.length = 40;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
