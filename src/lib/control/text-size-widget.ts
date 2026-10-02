import type { Widget, WidgetTextSize, WidgetType } from "./types";

const SIZES: readonly WidgetTextSize[] = ["xs", "sm", "md", "lg"];

/**
 * Height-linked body sizes with clamp(min, Ncqh, max).
 *
 * Preferred middle term = former height-relative fractions of tile height
 * (pad 1/16 each side → usable 7/8), applied as cqh:
 *   xs = (1/8)*(7/8) = 7/64 ≈ 10.9375cqh
 *   sm = (1/4)*(7/8) = 7/32 ≈ 21.875cqh
 *   md = (1/2)*(7/8) = 7/16 ≈ 43.75cqh
 *   lg = (1)*(7/8)   = 7/8  ≈ 87.5cqh
 *
 * MAX = fixed rem from #199 / 0.9.80 (caps large tiles at today’s sizes).
 * MIN ≈ half of max where readable, else slightly above crushed short-tile
 * sizes (documented below) so laptop short rows stay legible vs tablets.
 *
 * Chosen mins (rem): xs 0.75, sm 1, md 1.75, lg 3.5.
 * Requires `container-type: size` on `.widget-text-container`.
 */
export const TEXT_SIZE_REF_REM = 8;

/** Body font-size MAX in rem (former fixed scale / large-tile cap). */
export const TEXT_SIZE_BODY_MAX_REM: Record<WidgetTextSize, number> = {
  xs: (7 / 64) * TEXT_SIZE_REF_REM, // 0.875rem
  sm: (7 / 32) * TEXT_SIZE_REF_REM, // 1.75rem
  md: (7 / 16) * TEXT_SIZE_REF_REM, // 3.5rem
  lg: (7 / 8) * TEXT_SIZE_REF_REM, // 7rem
};

/** @deprecated Alias of TEXT_SIZE_BODY_MAX_REM (0.9.80 fixed rem values). */
export const TEXT_SIZE_BODY_REM = TEXT_SIZE_BODY_MAX_REM;

/**
 * Body font-size MIN in rem — short-tile floor.
 * xs 0.75 (≈0.86× max; half of max would be unreadable),
 * sm 1 (half of 1.75 ≈ 0.875 → bump),
 * md 1.75 (= half of 3.5),
 * lg 3.5 (= half of 7).
 */
export const TEXT_SIZE_BODY_MIN_REM: Record<WidgetTextSize, number> = {
  xs: 0.75,
  sm: 1,
  md: 1.75,
  lg: 3.5,
};

/** Body preferred size as fraction of container height (cqh / 100). */
export const TEXT_SIZE_BODY_CQH_FRAC: Record<WidgetTextSize, number> = {
  xs: 7 / 64, // 10.9375%
  sm: 7 / 32, // 21.875%
  md: 7 / 16, // 43.75%
  lg: 7 / 8, // 87.5%
};

/** Chip / secondary scale relative to primary body size. */
const CHIP_OF_BODY = 0.4;
const SECONDARY_OF_BODY = 0.7;

export type WidgetTextRole = "body" | "chip" | "secondary";

/** Body max rem for a textSize (invalid/missing → md). */
export function widgetTextBodyRem(size: WidgetTextSize | undefined): number {
  return TEXT_SIZE_BODY_MAX_REM[coerceTextSize(size)];
}

function roleMult(role: WidgetTextRole): number {
  return role === "chip" ? CHIP_OF_BODY : role === "secondary" ? SECONDARY_OF_BODY : 1;
}

/** Trim float noise for CSS (e.g. 0.7000000000000001 → 0.7). */
function cssNum(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** Inline style: clamp(min rem, Ncqh, max rem); ancestor needs container-type: size. */
export function widgetTextSizeStyle(
  size: WidgetTextSize | undefined,
  role: WidgetTextRole = "body",
): { fontSize: string; lineHeight: number } {
  const key = coerceTextSize(size);
  const mult = roleMult(role);
  const min = TEXT_SIZE_BODY_MIN_REM[key] * mult;
  const max = TEXT_SIZE_BODY_MAX_REM[key] * mult;
  const cqh = TEXT_SIZE_BODY_CQH_FRAC[key] * mult * 100;
  return {
    fontSize: `clamp(${cssNum(min)}rem, ${cssNum(cqh)}cqh, ${cssNum(max)}rem)`,
    lineHeight: 1.15,
  };
}

export function widgetBodyTextStyle(size: WidgetTextSize | undefined) {
  return widgetTextSizeStyle(size, "body");
}

export function widgetChipTextStyle(size: WidgetTextSize | undefined) {
  return widgetTextSizeStyle(size, "chip");
}

export function widgetSecondaryTextStyle(size: WidgetTextSize | undefined) {
  return widgetTextSizeStyle(size, "secondary");
}

export function widgetLabelTileTextStyle(size: WidgetTextSize | undefined) {
  return widgetTextSizeStyle(size, "body");
}

/** Widget types that expose a configurator text-size control. */
export function supportsTextSize(type: WidgetType): boolean {
  return type === "button" || type === "label" || type === "status" || type === "schedule";
}

export function coerceTextSize(value: unknown): WidgetTextSize {
  return SIZES.includes(value as WidgetTextSize) ? (value as WidgetTextSize) : "md";
}

/**
 * Normalize textSize for button/label/status/schedule.
 * Missing/invalid → "md". Slider: strip dead `textSize` (fixed face sizing).
 * Preview/image left untouched (field unused).
 */
export function normalizeTextSizeFields<T extends Widget>(widget: T): T {
  if (widget.type === "slider") {
    if (widget.textSize === undefined) return widget;
    const { textSize: _drop, ...rest } = widget;
    return rest as T;
  }
  if (!supportsTextSize(widget.type)) return widget;
  const textSize = coerceTextSize(widget.textSize);
  if (textSize === widget.textSize) return widget;
  return { ...widget, textSize };
}
