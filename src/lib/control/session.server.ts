import { dropExpiredSessions, sessionSlideShouldPersist } from "./session-expire.ts";
import { memory, persist } from "./store.server.ts";

export {
  ensureLoaded,
  memory,
  persist,
  persistNow,
  reloadSecretsFromDisk,
  pushLog,
  clearLog,
  normalize,
  writeDriverFile,
  removeDriverFile,
  loadDriverFiles,
  readLibrarySpec,
  pruneRoomDrivers,
  safeDriverName,
  processStatus,
  drainQueuedTriggers,
} from "./store.server.ts";
export { hashPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "./pins.server.ts";

const g = globalThis as typeof globalThis & {
  __relayTokens__?: Map<string, { id?: string; secret?: string; kind: "config" | "panel"; exp: number; created?: number; label?: string; lastSeen?: number }>;
  /** Last slid exp written (or seeded) per token secret — F2 throttle. */
  __relaySlidePersistedExp__?: Map<string, number>;
};

export function tokenStore() {
  if (!g.__relayTokens__) g.__relayTokens__ = new Map();
  return g.__relayTokens__;
}

function slidePersistedExp() {
  if (!g.__relaySlidePersistedExp__) g.__relaySlidePersistedExp__ = new Map();
  return g.__relaySlidePersistedExp__;
}

function markSlidePersisted(token: string, exp: number) {
  slidePersistedExp().set(token, exp);
}

function clearSlidePersisted(token: string) {
  slidePersistedExp().delete(token);
}

/** Dirty persist only when slid exp advanced by ≥ SESSION_SLIDE_PERSIST_ADVANCE_MS (F2). */
function maybePersistSessionSlide(token: string, nextExp: number) {
  const map = slidePersistedExp();
  if (!sessionSlideShouldPersist(map.get(token), nextExp)) return;
  map.set(token, nextExp);
  persist();
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
  markSlidePersisted(secret, row.exp);
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
  for (const secret of dropped) {
    tokenStore().delete(secret);
    clearSlidePersisted(secret);
  }
  mem.sessions = kept;
  persist();
  return true;
}

/** Accept session if kind matches `kind`, or either panel|config when kind is omitted (F4). */
function acceptToken(token: string | undefined, kind?: "config" | "panel") {
  if (!token) return false;
  pruneExpiredSessions();
  const mem = memory();
  const row = findSessionBySecret(token);
  if (!row) return false;
  if (kind ? row.kind !== kind : row.kind !== "panel" && row.kind !== "config") return false;
  if (!row.exp) row.exp = Date.now() + SESSION_TTL_MS;
  if (row.exp < Date.now()) {
    tokenStore().delete(token);
    clearSlidePersisted(token);
    const id = Object.entries(mem.sessions ?? {}).find(([, item]) => item === row || item.secret === token)?.[0];
    if (id && mem.sessions) delete mem.sessions[id];
    persist();
    return false;
  }
  row.lastSeen = Date.now();
  row.exp = Date.now() + SESSION_TTL_MS;
  tokenStore().set(token, row);
  // F2: throttle slide persist — only dirty when exp advanced by ≥10m since last slide write.
  // Mint/revoke/persistNow stay immediate. Crash may lose up to that window of slid expiry.
  maybePersistSessionSlide(token, row.exp);
  return true;
}

export function validToken(token: string | undefined, kind: "config" | "panel") {
  return acceptToken(token, kind);
}

/** Panel OR config in one prune/lookup/slide — room poll must not double work (F4). */
export function validTokenAny(token: string | undefined) {
  return acceptToken(token);
}

export { redactAuth } from "./secrets.ts";

export function allowLanControl(token?: string) {
  if (memory().config.room.externalControl === true) return true;
  return validTokenAny(token);
}

export function sessionKind(token?: string | null) {
  if (!token) return null;
  if (validToken(token, "config")) return "config" as const;
  if (validToken(token, "panel")) return "panel" as const;
  return null;
}
