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
  whenFalse?: { variable: string; compare?: string; equals: string }[];
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

/** Primary edge, then extra AND clauses on the true or false side. Empty extras always pass. */
export function triggerPathHit(
  rule: TriggerLike,
  vars: Record<string, string | number>,
  path: "t" | "f",
  value: (raw: string) => string = (raw) => raw,
) {
  if (!rule.variable) return false;
  const primary = matchesTrigger(String(vars[rule.variable] ?? ""), rule.compare || "eq", value(rule.equals ?? ""));
  if (path === "t") return primary && clausesPass(rule.whenTrue, vars, value);
  return !primary && clausesPass(rule.whenFalse, vars, value);
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
