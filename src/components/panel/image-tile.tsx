/**
 * Static Image page widget. GET /api/media requires panel|config Bearer (no cookies),
 * so a bare img tag pointing at imageSrc would 401 — fetch with Authorization and use a blob URL
 * (same auth pattern as PreviewTile’s /api/preview fetch).
 *
 * imageBorderless: skip WidgetShell button chrome; image/empty state draws flush in the tile.
 */
import { useEffect, useState } from "react";
import type { Widget } from "@/lib/control/types";
import { cn } from "@/lib/utils";
import { WidgetShell } from "./widget-face";

export function ImageTile({
  widget,
  token,
  disabled,
  onClick,
}: {
  widget: Widget;
  token: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const src = widget.imageSrc?.trim() || "";
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"empty" | "loading" | "ready" | "error">(
    src ? "loading" : "empty",
  );

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      setStatus("empty");
      return;
    }
    if (!token) {
      setBlobUrl(null);
      setStatus("error");
      return;
    }

    const ac = new AbortController();
    let objectUrl = "";
    setStatus("loading");
    setBlobUrl(null);

    void (async () => {
      try {
        const res = await fetch(src, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        if (!res.ok) {
          if (!ac.signal.aborted) setStatus("error");
          return;
        }
        const blob = await res.blob();
        if (ac.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        if (ac.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setBlobUrl(objectUrl);
        setStatus("ready");
      } catch (err) {
        if (ac.signal.aborted) return;
        if (!(err instanceof Error && err.name === "AbortError")) setStatus("error");
      }
    })();

    return () => {
      ac.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token]);

  const fit = widget.imageFit === "cover" ? "object-cover" : "object-contain";
  const borderless = widget.imageBorderless === true;

  const face =
    status === "empty" ? (
      <span className="flex h-full min-h-[3rem] items-center justify-center text-sm font-normal text-muted">
        No image
      </span>
    ) : status === "error" ? (
      <span className="flex h-full min-h-[3rem] items-center justify-center text-sm font-normal text-muted">
        {token ? "Unavailable" : "Locked"}
      </span>
    ) : status === "loading" || !blobUrl ? (
      <span className="flex h-full min-h-[3rem] items-center justify-center text-sm font-normal text-muted">
        …
      </span>
    ) : (
      <img
        src={blobUrl}
        alt=""
        draggable={false}
        className={cn("pointer-events-none absolute inset-0 h-full w-full", fit)}
      />
    );

  if (borderless) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "relative flex h-full min-h-0 min-w-0 w-full overflow-hidden bg-transparent p-0 text-left",
          "active:scale-[0.98]",
          disabled && "opacity-40",
        )}
      >
        <div className="relative min-h-0 h-full w-full overflow-hidden">{face}</div>
      </button>
    );
  }

  return (
    <WidgetShell widget={widget} disabled={disabled} onClick={onClick}>
      {face}
    </WidgetShell>
  );
}
