import type { Widget, WidgetTextSize, WidgetType } from "./types";

const SIZES: readonly WidgetTextSize[] = ["sm", "md", "lg"];

/** Widget types that expose a configurator text-size control. */
export function supportsTextSize(type: WidgetType): boolean {
  return type !== "preview" && type !== "image";
}

export function coerceTextSize(value: unknown): WidgetTextSize {
  return SIZES.includes(value as WidgetTextSize) ? (value as WidgetTextSize) : "md";
}

/**
 * Normalize textSize for button/slider/label/status/schedule.
 * Missing/invalid → "md". Preview/image left untouched (field unused).
 */
export function normalizeTextSizeFields<T extends Widget>(widget: T): T {
  if (!supportsTextSize(widget.type)) return widget;
  const textSize = coerceTextSize(widget.textSize);
  if (textSize === widget.textSize) return widget;
  return { ...widget, textSize };
}

/** Uppercase chip / slider label class (default md = text-[11px]). */
export function widgetChipTextClass(size: WidgetTextSize | undefined): string {
  const s = coerceTextSize(size);
  if (s === "sm") return "text-[10px]";
  if (s === "lg") return "text-xs";
  return "text-[11px]";
}

/** Main body / value class. Status stays one step larger than buttons. */
export function widgetBodyTextClass(
  size: WidgetTextSize | undefined,
  opts?: { status?: boolean },
): string {
  const s = coerceTextSize(size);
  if (opts?.status) {
    if (s === "sm") return "text-2xl";
    if (s === "lg") return "text-4xl";
    return "text-3xl";
  }
  if (s === "sm") return "text-base";
  if (s === "lg") return "text-2xl";
  return "text-xl";
}

/** Standalone label tile class (default md = text-sm). */
export function widgetLabelTileTextClass(size: WidgetTextSize | undefined): string {
  const s = coerceTextSize(size);
  if (s === "sm") return "text-xs";
  if (s === "lg") return "text-base";
  return "text-sm";
}

/** Schedule secondary "when" line. */
export function widgetSecondaryTextClass(size: WidgetTextSize | undefined): string {
  const s = coerceTextSize(size);
  if (s === "sm") return "text-sm";
  if (s === "lg") return "text-lg";
  return "text-base";
}
