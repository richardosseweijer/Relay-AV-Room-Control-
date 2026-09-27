import type { RoomConfig, Widget } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { fieldClass } from "./config-ui";
import { SuggestField } from "./suggest-field";

/** Preview widget sidebar: stream URL, device bind, RTSP transport/delay/fit, optional tap macro. */
export function PagesPreviewFields({
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
  return (
    <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">Stream</p>
      <label className="grid gap-1 text-sm text-muted">Stream URL
        <input
          className={fieldClass()}
          placeholder="rtsp://10.0.10.40:554/sub/av"
          value={selected.streamUrl ?? ""}
          onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) w.streamUrl = e.target.value;
          })}
        />
      </label>
      <label className="grid gap-1 text-sm text-muted">Device (empty URL → rtsp://IP:554/sub/av)
        <SuggestField
          className={fieldClass()}
          value={selected.bind.device ?? ""}
          options={[{ id: "", label: "None" }, ...draft.devices.map((d) => ({ id: d.id, label: d.name }))]}
          onChange={(id) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) w.bind.device = id;
          })}
        />
      </label>
      <label className="grid gap-1 text-sm text-muted">RTSP transport
        <select className={fieldClass()} value={selected.previewTransport ?? "auto"} onChange={(e) => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (w) w.previewTransport = (e.target.value === "udp" || e.target.value === "tcp" ? e.target.value : "auto");
        })}>
          <option value="auto">Auto (UDP then TCP)</option>
          <option value="udp">UDP</option>
          <option value="tcp">TCP</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm text-muted">Behind live (seconds)
        <input
          className={fieldClass()}
          inputMode="decimal"
          placeholder="1.2"
          value={selected.previewDelay ?? ""}
          onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) w.previewDelay = e.target.value;
          })}
        />
        <span className="text-[11px] text-subtle">Match I-frame interval. 30 fps × I-frame 30 → 1. Too small = black picture.</span>
      </label>
      <label className="grid gap-1 text-sm text-muted">Picture
        <select className={fieldClass()} value={selected.previewFit ?? "contain"} onChange={(e) => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (w) w.previewFit = e.target.value === "cover" ? "cover" : "contain";
        })}>
          <option value="contain">Fit (keep aspect)</option>
          <option value="cover">Fill tile</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm text-muted">Tap macro (optional)
        <SuggestField
          className={fieldClass()}
          value={selected.bind.id ?? NONE_MACRO_ID}
          options={[{ id: NONE_MACRO_ID, label: "None" }, ...draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => ({ id: m.id, label: m.label }))]}
          onChange={(id) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) { w.bind.kind = "macro"; w.bind.id = id; }
          })}
        />
      </label>
    </div>
  );
}
