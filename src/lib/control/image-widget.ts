import type { Widget } from "./types";

/**
 * Normalize Image widget fields (status-widget pattern).
 * - imageFit → "contain" | "cover" (missing/invalid → contain)
 * - imageSrc → string | undefined (no invented default path)
 */
export function normalizeImageFields<T extends Widget>(widget: T): T {
  if (widget.type !== "image") return widget;

  const imageFit = widget.imageFit === "cover" ? "cover" : "contain";
  const imageSrc = widget.imageSrc == null ? undefined : String(widget.imageSrc);

  if (imageFit === widget.imageFit && imageSrc === widget.imageSrc) return widget;
  return { ...widget, imageFit, imageSrc };
}
