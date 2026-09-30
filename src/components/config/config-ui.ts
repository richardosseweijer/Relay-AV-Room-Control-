import type { WidgetColor } from "@/lib/control/types";

export const COLORS: WidgetColor[] = ["steel", "sage", "clay", "fog", "ink", "ocean", "pine", "rust", "sand", "slate", "rose"];
export const COLOR_FILL: Record<WidgetColor, string> = {
  steel: "bg-steel", sage: "bg-sage", clay: "bg-clay", fog: "bg-fog", ink: "bg-raised",
  ocean: "bg-ocean", pine: "bg-pine", rust: "bg-rust", sand: "bg-sand", slate: "bg-slate", rose: "bg-rose",
};

export function fieldClass() {
  return "h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg";
}

/** "Name copy", then "Name copy copy", so a pasted row is easy to tell apart. */
export function duplicateLabel(labels: string[], label: string) {
  const base = label.trim() || "Copy";
  let next = `${base} copy`;
  const used = new Set(labels);
  while (used.has(next)) next += " copy";
  return next;
}
