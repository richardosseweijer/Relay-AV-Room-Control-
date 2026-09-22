export function dropExpiredSessions<T extends { secret?: string; exp?: number }>(
  sessions: Record<string, T>,
  now = Date.now(),
) {
  const kept: Record<string, T> = {};
  const dropped: string[] = [];
  for (const [id, row] of Object.entries(sessions)) {
    // Fail closed: missing/invalid exp is treated as expired (legacy/orphan rows).
    const exp = row.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp < now) {
      if (row.secret) dropped.push(row.secret);
    } else {
      kept[id] = row;
    }
  }
  return { kept, dropped };
}

/** Min slid `exp` advance before dirtying disk again (F2). Crash may lose up to this window of slid TTL. */
export const SESSION_SLIDE_PERSIST_ADVANCE_MS = 10 * 60 * 1000;

/** True when nextExp advanced enough past last persisted slide to warrant persist(). */
export function sessionSlideShouldPersist(
  lastPersistedExp: number | undefined,
  nextExp: number,
  minAdvanceMs = SESSION_SLIDE_PERSIST_ADVANCE_MS,
) {
  const last =
    typeof lastPersistedExp === "number" && Number.isFinite(lastPersistedExp) ? lastPersistedExp : 0;
  return nextExp - last >= minAdvanceMs;
}
