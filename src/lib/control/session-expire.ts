export function dropExpiredSessions<T extends { secret?: string; exp?: number }>(
  sessions: Record<string, T>,
  now = Date.now(),
) {
  const kept: Record<string, T> = {};
  const dropped: string[] = [];
  for (const [id, row] of Object.entries(sessions)) {
    if (row.exp && row.exp < now) {
      if (row.secret) dropped.push(row.secret);
    } else {
      kept[id] = row;
    }
  }
  return { kept, dropped };
}
