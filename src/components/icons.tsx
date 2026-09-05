import {
  House,
  Monitor,
  Power,
  Presentation,
  Scan,
  Speaker,
  Tv,
  User,
  Users,
  Video,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  house: House,
  monitor: Monitor,
  power: Power,
  presentation: Presentation,
  scan: Scan,
  speaker: Speaker,
  tv: Tv,
  user: User,
  users: Users,
  video: Video,
  waypoints: Waypoints,
  hdmi: Monitor,
};

export function NamedIcon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  const Icon = MAP[name] ?? Monitor;
  return <Icon className={className} strokeWidth={1.75} />;
}
