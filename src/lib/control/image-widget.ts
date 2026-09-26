import type { Widget } from "./types";

/**
 * Normalize Image widget fields (status-widget pattern).
 * - imageFit → "contain" | "cover" (missing/invalid → contain)
 * - imageSrc → string | undefined (no invented default path)
 * - imageBorderless → boolean (missing/invalid → false)
 */
export function normalizeImageFields<T extends Widget>(widget: T): T {
  if (widget.type !== "image") return widget;

  const imageFit = widget.imageFit === "cover" ? "cover" : "contain";
  const imageSrc = widget.imageSrc == null ? undefined : String(widget.imageSrc);
  const imageBorderless = widget.imageBorderless === true;

  if (
    imageFit === widget.imageFit
    && imageSrc === widget.imageSrc
    && imageBorderless === widget.imageBorderless
  ) {
    return widget;
  }
  return { ...widget, imageFit, imageSrc, imageBorderless };
}
