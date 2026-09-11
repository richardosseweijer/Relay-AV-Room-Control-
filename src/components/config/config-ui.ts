import type { WidgetColor } from "@/lib/control/types";

export const COLORS: WidgetColor[] = ["steel", "sage", "clay", "fog", "ink", "ocean", "pine", "rust", "sand", "slate", "rose"];
export const COLOR_FILL: Record<WidgetColor, string> = {
  steel: "bg-steel", sage: "bg-sage", clay: "bg-clay", fog: "bg-fog", ink: "bg-raised",
  ocean: "bg-ocean", pine: "bg-pine", rust: "bg-rust", sand: "bg-sand", slate: "bg-slate", rose: "bg-rose",
};

export function fieldClass() {
  return "h-11 min-w-0 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg";
}
