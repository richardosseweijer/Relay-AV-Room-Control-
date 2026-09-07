export function scheduleShouldRun(job: { enabled?: boolean; time: string; days: number[] }, time: string, day: number) {
  if (!job.enabled || job.time !== time) return false;
  if (!job.days.length) return false;
  return job.days.includes(day);
}

export function matchesTrigger(left: string, compare: string, right: string) {
  if (compare === "gt" || compare === "lt") {
    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return compare === "gt" ? a > b : a < b;
  }
  const same = left.trim().toLowerCase() === right.trim().toLowerCase();
  return compare === "neq" ? !same : same;
}

/** change: fire only on false→true. interval: ready whenever hit. */
export function triggerStep(mode: string | undefined, prev: string | undefined, hit: boolean) {
  if (!hit) return "reset" as const;
  if (mode === "change") {
    if (prev === undefined) return "arm" as const;
    if (prev.startsWith("true:")) return "hold" as const;
  }
  return "ready" as const;
}
