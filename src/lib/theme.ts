export type RoomTheme = "dark" | "peach" | "green" | "office";

export const ROOM_THEME_LABELS: Record<RoomTheme, string> = {
  dark: "Dark",
  peach: "Peach picnic",
  green: "Outdoors",
  office: "Modern office",
};

export const THEME_CHROME: Record<RoomTheme, string> = {
  dark: "#0a0a0b",
  peach: "#dcc4b8",
  green: "#c5d0c4",
  office: "#cfcbc4",
};

export function resolveRoomTheme(raw?: string | null): RoomTheme {
  if (raw === "peach" || raw === "green" || raw === "office") return raw;
  if (raw === "pastel" || raw === "lilac") return "peach";
  if (raw === "coral") return "office";
  return "dark";
}

export function applyRoomTheme(raw?: string | null) {
  if (typeof document === "undefined") return;
  const theme = resolveRoomTheme(raw);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_CHROME[theme]);
}
