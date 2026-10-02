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

export type TriggerLike = {
  variable?: string;
  compare?: string;
  equals?: string;
  whenTrue?: { variable: string; compare?: string; equals: string }[];
};

function clausesPass(
  clauses: { variable: string; compare?: string; equals: string }[] | undefined,
  vars: Record<string, string | number>,
  value: (raw: string) => string,
) {
  return (clauses ?? []).every((row) => {
    if (!row.variable) return false;
    return matchesTrigger(String(vars[row.variable] ?? ""), row.compare || "eq", value(row.equals));
  });
}

/** True when every If row passes. False path is any row failing. No variable → neither path. */
export function triggerPathHit(
  rule: TriggerLike,
  vars: Record<string, string | number>,
  path: "t" | "f",
  value: (raw: string) => string = (raw) => raw,
) {
  if (!rule.variable) return false;
  const primary = matchesTrigger(String(vars[rule.variable] ?? ""), rule.compare || "eq", value(rule.equals ?? ""));
  const allTrue = primary && clausesPass(rule.whenTrue, vars, value);
  return path === "t" ? allTrue : !allTrue;
}

/** change: fire only on false→true. interval: ready whenever hit. boot: not used (see runBootTriggers). */
export function triggerStep(mode: string | undefined, prev: string | undefined, hit: boolean) {
  if (!hit) return "reset" as const;
  if (mode === "change") {
    if (prev === undefined) return "arm" as const;
    if (prev.startsWith("true:")) return "hold" as const;
  }
  return "ready" as const;
}

/**
 * Boot trigger path at process start.
 * No variable → unconditional true path only. With variable → same If/and as change/interval.
 */
export function bootTriggerPaths(
  rule: TriggerLike & { mode?: string },
  vars: Record<string, string | number>,
  value: (raw: string) => string = (raw) => raw,
): ("t" | "f")[] {
  if (rule.mode !== "boot") return [];
  if (!rule.variable) {
    // No primary: empty and-rows → always true; leftover and-rows still apply.
    return clausesPass(rule.whenTrue, vars, value) ? ["t"] : ["f"];
  }
  return triggerPathHit(rule, vars, "t", value) ? ["t"] : ["f"];
}

export class TriggerReservations {
  private readonly pending = new Set<string>();

  reserve(key: string) {
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    return true;
  }

  has(key: string) {
    return this.pending.has(key);
  }

  release(key: string) {
    this.pending.delete(key);
  }
}
