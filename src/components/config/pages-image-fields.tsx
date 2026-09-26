import { useState } from "react";
import type { RoomConfig, Widget } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { fieldClass } from "./config-ui";

function configAuthHeaders(): HeadersInit {
  return { Authorization: `Bearer ${sessionStorage.getItem("relay-config-token") || ""}` };
}

function isHostMediaSrc(src: string): boolean {
  return src.startsWith("/api/media/");
}

/** Image widget sidebar: upload/clear host media, picture fit, optional tap macro. */
export function PagesImageFields({
  selected,
  pageId,
  draft,
  update,
}: {
  selected: Widget;
  pageId: string;
  draft: RoomConfig;
  update: (mut: (c: RoomConfig) => void) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const src = selected.imageSrc?.trim() || "";

  const patchWidget = (mut: (w: Widget) => void) => {
    update((c) => {
      const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
      if (w) mut(w);
    });
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/media", {
        method: "POST",
        headers: configAuthHeaders(),
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; message?: string };
      if (!res.ok || !data.ok || !data.url) {
        setMessage(data.message || `Upload failed (HTTP ${res.status})`);
        return;
      }
      patchWidget((w) => {
        w.imageSrc = data.url;
      });
      setMessage(null);
    } catch {
      setMessage("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (src && isHostMediaSrc(src)) {
        const res = await fetch(src, {
          method: "DELETE",
          headers: configAuthHeaders(),
        });
        if (!res.ok && res.status !== 404) {
          const data = (await res.json().catch(() => ({}))) as { message?: string };
          setMessage(data.message || `Clear failed (HTTP ${res.status})`);
          // Still clear the widget field so the editor is not stuck on a bad src.
        }
      }
      patchWidget((w) => {
        w.imageSrc = undefined;
      });
    } catch {
      setMessage("Clear failed");
      patchWidget((w) => {
        w.imageSrc = undefined;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">Image</p>
      <label className="grid gap-1 text-sm text-muted">File
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          className={fieldClass()}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void onUpload(file);
          }}
        />
        <span className="text-[11px] text-subtle">PNG, JPEG, or WebP. Stored on this host via /api/media.</span>
      </label>
      {src ? (
        <div className="grid gap-1">
          <p className="truncate font-mono text-[11px] text-fg" title={src}>{src}</p>
          <button
            type="button"
            disabled={busy}
            className="h-9 w-fit rounded-md border border-border bg-surface px-3 text-sm text-muted disabled:opacity-50"
            onClick={() => void onClear()}
          >Clear image</button>
        </div>
      ) : (
        <p className="text-[11px] text-subtle">No image uploaded yet.</p>
      )}
      {message ? <p className="text-[11px] text-clay">{message}</p> : null}
      <label className="grid gap-1 text-sm text-muted">Picture
        <select className={fieldClass()} value={selected.imageFit ?? "contain"} onChange={(e) => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (w) w.imageFit = e.target.value === "cover" ? "cover" : "contain";
        })}>
          <option value="contain">Fit (keep aspect)</option>
          <option value="cover">Fill tile</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={selected.imageBorderless === true}
          onChange={(e) => patchWidget((w) => {
            w.imageBorderless = e.target.checked;
          })}
        />
        Borderless
      </label>
      <label className="grid gap-1 text-sm text-muted">Tap macro (optional)
        <select className={fieldClass()} value={selected.bind.id ?? NONE_MACRO_ID} onChange={(e) => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (w) { w.bind.kind = "macro"; w.bind.id = e.target.value; }
        })}>
          <option value={NONE_MACRO_ID}>None</option>
          {draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
    </div>
  );
}
