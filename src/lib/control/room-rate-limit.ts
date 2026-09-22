/** /api/room poll rate-limit: keyed by token or IP; idle keys expire with the window. */
const WINDOW_MS = 10_000;
const MAX_HITS = 120;
const hits = new Map<string, number[]>();

function pruneIdle(now: number) {
  for (const [key, times] of hits) {
    const recent = times.filter((at) => now - at < WINDOW_MS);
    if (!recent.length) hits.delete(key);
    else if (recent.length !== times.length) hits.set(key, recent);
  }
}

/** Returns true when the key is over the window budget. */
export function roomRateLimited(key: string, now = Date.now()) {
  pruneIdle(now);
  const recent = hits.get(key) ?? [];
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_HITS;
}

export function roomRateLimitSize() {
  return hits.size;
}

/** Test helper */
export function roomRateLimitReset() {
  hits.clear();
}
