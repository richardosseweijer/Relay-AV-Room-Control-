import { cn } from "@/lib/utils";

const paths: Record<string, string> = {
  power: "M12 3v9M7.5 6.2a7 7 0 1 0 9 0",
  play: "M9 6.5v11l9-5.5z",
  pause: "M9 6.5v11M15 6.5v11",
  stop: "M7.5 7.5h9v9h-9z",
  skip: "M7 7l6 5-6 5zM16.5 7v10",
  back: "M17 7l-6 5 6 5zM7.5 7v10",
  vol: "M5 10h3l4-3v10l-4-3H5zM16 9.5a3.5 3.5 0 0 1 0 5M18.5 7.5a6 6 0 0 1 0 9",
  mute: "M5 10h3l4-3v10l-4-3H5zM16 9l4 6M20 9l-4 6",
  tv: "M4.5 7h15v9.5h-15zM9 19h6M12 16.5V19",
  hdmi: "M4 9h16v6H4zM7 15v2M17 15v2",
  projector: "M5 8h14v7H5zM8 18h8M12 15v3M7 11.5h2",
  cam: "M4.5 9h10v7H4.5zM14.5 11l5-2v8l-5-2z",
  mic: "M12 5.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 5.5zM8 13a4 4 0 0 0 8 0M12 17v2.5",
  speaker: "M8 9h3l4-3v12l-4-3H8z",
  light: "M12 4.5a5 5 0 0 1 3 9v2.5H9V13.5a5 5 0 0 1 3-9zM9 19h6",
  shade: "M4.5 6h15M6 6v12M18 6v12M6 10h12M6 14h12",
  lock: "M8 11h8v8H8zM9.5 11V8.5a2.5 2.5 0 0 1 5 0V11",
  home: "M4.5 12l7.5-7 7.5 7M7 11.5V19h10v-7.5",
  source: "M5 8h6v8H5zM13 8h6v3h-6zM13 13h6v3h-6z",
  cast: "M4.5 7h15v10h-4M4.5 17a3 3 0 0 1 3-3M4.5 17a6 6 0 0 1 6-6",
  scene: "M7 8h10v8H7zM12 8v8M7 12h10",
  off: "M6 12h12M8.5 8.5l7 7",
  on: "M6.5 12.5l3.5 3.5 7.5-8",
  film: "M5 7h14v10H5zM8 7v10M16 7v10M5 12h14",
};

export const ICON_NAMES = ["", ...Object.keys(paths)] as const;

export function NamedIcon({ name, className }: { name?: string; className?: string }) {
  if (!name || name === "none") return null;
  const d = paths[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("stroke-current", className)} aria-hidden>
      <path d={d} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
