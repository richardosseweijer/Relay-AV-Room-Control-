import type { Widget, WidgetTextSize, WidgetType } from "./types";

const SIZES: readonly WidgetTextSize[] = ["xs", "sm", "md", "lg"];

/**
 * Former height-relative fractions of tile height (pad 1/16 each side → usable 7/8):
 *   xs = (1/8)*(7/8) = 7/64 ≈ 0.109375
 *   sm = (1/4)*(7/8) = 7/32 ≈ 0.21875
 *   md = (1/2)*(7/8) = 7/16 ≈ 0.4375
 *   lg = (1)*(7/8)   = 7/8  ≈ 0.875
 *
 * Frozen at a reference 1-row tile of TEXT_SIZE_REF_REM (≈ default landscape row
 * on a 1080p 8-row panel). No longer scales with widget.h via cqh.
 */
export const TEXT_SIZE_REF_REM = 8;

/** Body font-size in rem for each textSize (fraction × TEXT_SIZE_REF_REM). */
export const TEXT_SIZE_BODY_REM: Record<WidgetTextSize, number> = {
  xs: (7 / 64) * TEXT_SIZE_REF_REM, // 0.875rem  (14px @ 16px root)
  sm: (7 / 32) * TEXT_SIZE_REF_REM, // 1.75rem   (28px)
  md: (7 / 16) * TEXT_SIZE_REF_REM, // 3.5rem    (56px)
  lg: (7 / 8) * TEXT_SIZE_REF_REM, // 7rem      (112px)
};

/** Chip / secondary scale relative to primary body size. */
const CHIP_OF_BODY = 0.4;
const SECONDARY_OF_BODY = 0.7;

export type WidgetTextRole = "body" | "chip" | "secondary";

/** Body rem for a textSize (invalid/missing → md). */
export function widgetTextBodyRem(size: WidgetTextSize | undefined): number {
  return TEXT_SIZE_BODY_REM[coerceTextSize(size)];
}

/** Inline style: fixed rem font-size (no longer height / cqh dependent). */
export function widgetTextSizeStyle(
  size: WidgetTextSize | undefined,
  role: WidgetTextRole = "body",
): { fontSize: string; lineHeight: number } {
  const base = widgetTextBodyRem(size);
  const mult = role === "chip" ? CHIP_OF_BODY : role === "secondary" ? SECONDARY_OF_BODY : 1;
  return { fontSize: `${base * mult}rem`, lineHeight: 1.15 };
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
