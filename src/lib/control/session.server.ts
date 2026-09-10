import { dropExpiredSessions } from "./session-expire.ts";
import { memory, persist } from "./store.server.ts";

export {
  ensureLoaded,
  memory,
  persist,
  persistNow,
  pushLog,
  clearLog,
  normalize,
  writeDriverFile,
  removeDriverFile,
  loadDriverFiles,
  safeDriverName,
} from "./store.server.ts";
export { hashPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "./pins.server.ts";

const g = globalThis as typeof globalThis & {
  __relayTokens__?: Map<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
};

export function tokenStore() {
  if (!g.__relayTokens__) g.__relayTokens__ = new Map();
  return g.__relayTokens__;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function mint(kind: "config" | "panel", label?: string) {
  const id = randomHex(8);
  const secret = `${kind}-${randomHex(18)}`;
  const row = { id, secret, kind, exp: Date.now() + SESSION_TTL_MS, created: Date.now(), lastSeen: Date.now(), label: (label || kind).slice(0, 80) };
  tokenStore().set(secret, row);
  const mem = memory();
  mem.sessions = mem.sessions ?? {};
  mem.sessions[id] = row;
  persist();
  return secret;
}

export function findSessionBySecret(token: string | undefined) {
  if (!token) return undefined;
  return tokenStore().get(token) ?? Object.values(memory().sessions ?? {}).find((item) => item.secret === token);
}

export function pruneExpiredSessions(now = Date.now()) {
  const mem = memory();
  const { kept, dropped } = dropExpiredSessions(mem.sessions ?? {}, now);
  if (!dropped.length && Object.keys(kept).length === Object.keys(mem.sessions ?? {}).length) return false;
  for (const secret of dropped) tokenStore().delete(secret);
  mem.sessions = kept;
  persist();
  return true;
}

export function validToken(token: string | undefined, kind: "config" | "panel") {
  if (!token) return false;
  pruneExpiredSessions();
  const mem = memory();
  const row = findSessionBySecret(token);
  if (!row || row.kind !== kind) return false;
  if (!row.exp) row.exp = Date.now() + SESSION_TTL_MS;
  if (row.exp < Date.now()) {
    tokenStore().delete(token);
    const id = Object.entries(mem.sessions ?? {}).find(([, item]) => item === row || item.secret === token)?.[0];
    if (id && mem.sessions) delete mem.sessions[id];
    persist();
    return false;
  }
  row.lastSeen = Date.now();
  row.exp = Date.now() + SESSION_TTL_MS;
  tokenStore().set(token, row);
  return true;
}

export { redactAuth } from "./secrets.ts";

export function allowLanControl(token?: string) {
  if (memory().config.room.externalControl === true) return true;
  return validToken(token, "panel") || validToken(token, "config");
}

export function sessionKind(token?: string | null) {
  if (!token) return null;
  if (validToken(token, "config")) return "config" as const;
  if (validToken(token, "panel")) return "panel" as const;
  return null;
}
