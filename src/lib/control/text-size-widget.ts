import type { Widget, WidgetTextSize, WidgetType } from "./types";

const SIZES: readonly WidgetTextSize[] = ["xs", "sm", "md", "lg"];

/** Dropdown → fraction of *usable* tile height (after padding). */
const SIZE_FRACTION: Record<WidgetTextSize, number> = {
  xs: 1 / 8,
  sm: 1 / 4,
  md: 1 / 2,
  lg: 1,
};

/** Padding each side as a fraction of tile height (user: ~1/16). */
export const TEXT_SIZE_PAD_FRAC = 1 / 16;

/** Chip / secondary scale relative to primary body fraction. */
const CHIP_OF_BODY = 0.4;
const SECONDARY_OF_BODY = 0.7;

export type WidgetTextRole = "body" | "chip" | "secondary";

/**
 * Font size as a fraction of the widget tile's height.
 *
 * Formula:
 *   usable = height * (1 - 2 * (1/16)) = height * 7/8   // pad top+bottom
 *   fontSize = SIZE_FRACTION[size] * usable
 *     xs → (1/8)*(7/8) = 7/64 ≈ 0.109375 of height
 *     sm → (1/4)*(7/8) = 7/32 ≈ 0.21875 of height
 *     md → (1/2)*(7/8) = 7/16 ≈ 0.4375 of height
 *     lg → (1)*(7/8)   = 7/8  ≈ 0.875 of height
 *
 * Applied via `cqh` (container query height); the tile must be a size container
 * (see `.widget-text-container` in panel-layout.css).
 */
export function widgetTextHeightFraction(size: WidgetTextSize | undefined): number {
  const s = coerceTextSize(size);
  const usable = 1 - 2 * TEXT_SIZE_PAD_FRAC;
  return SIZE_FRACTION[s] * usable;
}

/** Inline style: font-size in cqh. Ancestor needs `container-type: size`. */
export function widgetTextSizeStyle(
  size: WidgetTextSize | undefined,
  role: WidgetTextRole = "body",
): { fontSize: string; lineHeight: number } {
  const base = widgetTextHeightFraction(size);
  const mult = role === "chip" ? CHIP_OF_BODY : role === "secondary" ? SECONDARY_OF_BODY : 1;
  return { fontSize: `${base * mult * 100}cqh`, lineHeight: 1.15 };
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
