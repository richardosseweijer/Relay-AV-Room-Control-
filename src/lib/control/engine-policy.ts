import type { TraceLine } from "./types";

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

export function scrubSecret(text: string) {
  return String(text ?? "")
    .replace(/("(?:token|password|secret|username|user)"\s*:\s*")[^"]*/gi, "$1***")
    .replace(/\btoken\s+[A-Za-z0-9._+/=-]{3,}/gi, "token ***")
    .replace(/((?:token|password|secret)=)[^&\s"]+/gi, "$1***");
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
