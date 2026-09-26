import type { Widget, WidgetTextAlign, WidgetType } from "./types";

const ALIGNS: readonly WidgetTextAlign[] = ["left", "center", "right"];

/** Widget types that expose a configurator text-align control. */
export function supportsTextAlign(type: WidgetType): boolean {
  return type === "label" || type === "button" || type === "status";
}

export function coerceTextAlign(value: unknown): WidgetTextAlign {
  return ALIGNS.includes(value as WidgetTextAlign) ? (value as WidgetTextAlign) : "left";
}

/**
 * Normalize textAlign for label/button/status.
 * Missing/invalid → "left" (matches prior panel look). Other types left untouched.
 */
export function normalizeTextAlignFields<T extends Widget>(widget: T): T {
  if (!supportsTextAlign(widget.type)) return widget;
  const textAlign = coerceTextAlign(widget.textAlign);
  if (textAlign === widget.textAlign) return widget;
  return { ...widget, textAlign };
}

/** Tailwind text-align class. Default left. */
export function textAlignClass(align: WidgetTextAlign | undefined): string {
  const a = coerceTextAlign(align);
  return a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";
}

/** Tailwind justify-* for flex row/column content placement. Default start (left). */
export function textAlignJustifyClass(align: WidgetTextAlign | undefined): string {
  const a = coerceTextAlign(align);
  return a === "center" ? "justify-center" : a === "right" ? "justify-end" : "justify-start";
}

/** Tailwind items-* when flex-col and horizontal alignment is via cross-axis. */
export function textAlignItemsClass(align: WidgetTextAlign | undefined): string {
  const a = coerceTextAlign(align);
  return a === "center" ? "items-center" : a === "right" ? "items-end" : "items-start";
}
