import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isHashedPin } from "./pins";

const FAIL = new Map<string, { n: number; until: number }>();
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60_000;

export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyStoredPin(pin: string, stored: string | null | undefined) {
  const value = String(stored ?? "");
  if (!value) return false;
  if (!isHashedPin(value)) return String(pin) === value;
  const parts = value.split("$");
  const salt = parts[1];
  const hash = parts[2];
  if (!salt || !hash || hash.length !== 64) return false;
  const next = scryptSync(String(pin), salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export function lockoutKey(kind: string, extra = "") {
  return `${kind}:${extra}`;
}

export function checkLockout(key: string) {
  const row = FAIL.get(key);
  if (!row) return { blocked: false, left: 0 };
  if (row.until && Date.now() < row.until) return { blocked: true, left: row.until - Date.now() };
  return { blocked: false, left: 0 };
}

export function notePinFail(key: string) {
  const row = FAIL.get(key) ?? { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= LOCK_AFTER) {
    row.until = Date.now() + LOCK_MS;
    row.n = 0;
  }
  FAIL.set(key, row);
  return checkLockout(key);
}

export function clearPinFail(key: string) {
  FAIL.delete(key);
}

export { isHashedPin };
