import type { Schedule } from "./types";

const DAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;

function parts(at: Date, tz?: string | null) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: !tz || tz === "system" ? undefined : tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hourCycle: "h23",
  }).formatToParts(at);
}

function grab(list: Intl.DateTimeFormatPart[], type: string) {
  return list.find((p) => p.type === type)?.value ?? "";
}

export function nextScheduled(jobs: Schedule[] | undefined, tz?: string | null) {
  const enabled = (jobs ?? []).filter((job) => job.enabled && job.time);
  if (!enabled.length) return null;
  const now = new Date();
  const here = parts(now, tz);
  const nowMin = Number(grab(here, "hour")) * 60 + Number(grab(here, "minute"));
  let best: { rank: number; label: string; time: string; when: string } | null = null;
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const at = new Date(now.getTime() + dayOffset * 86400000);
    const row = parts(at, tz);
    const dow = DAY[grab(row, "weekday") as keyof typeof DAY] ?? 0;
    for (const job of enabled) {
      if (!job.days.length || !job.days.includes(dow)) continue;
      const [hh, mm] = job.time.split(":").map(Number);
      const stamp = (Number(hh) || 0) * 60 + (Number(mm) || 0);
      if (dayOffset === 0 && stamp <= nowMin) continue;
      const rank = dayOffset * 1440 + stamp;
      if (best && rank >= best.rank) continue;
      const dayName = dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : grab(row, "weekday");
      best = { rank, label: job.label, time: job.time, when: `${dayName} ${job.time}` };
    }
  }
  return best;
}
