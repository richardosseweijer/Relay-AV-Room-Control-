import type { RoomConfig, Widget, WidgetColor } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

/** Status widget sidebar: variable bind, colorWhen traffic-light rules, statusDefault catch-all. */
export function PagesStatusFields({
  selected,
  pageId,
  draft,
  update,
  colors,
  fills,
}: {
  selected: Widget;
  pageId: string;
  draft: RoomConfig;
  update: (mut: (c: RoomConfig) => void) => void;
  colors: WidgetColor[];
  fills: Record<WidgetColor, string>;
}) {
  return (
    <>
      <label className="grid gap-1 text-sm text-muted">Variable
        <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind = { kind: "variable", variable: e.target.value }; })}>
          {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <div className="grid gap-2 rounded-lg border border-border bg-raised/40 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">Color when (first match)</p>
        {(selected.colorWhen ?? []).map((row, ri) => (
          <div key={ri} className="grid gap-1 rounded-md border border-border/60 p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
              <input className={fieldClass()} placeholder="equals" value={row.equals} onChange={(e) => update((c) => {
                const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                if (!w) return;
                const rows = [...(w.colorWhen ?? [])];
                rows[ri] = { ...rows[ri]!, equals: e.target.value };
                w.colorWhen = rows;
              })} />
              <Button size="sm" variant="ghost" onClick={() => update((c) => {
                const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                if (!w) return;
                w.colorWhen = (w.colorWhen ?? []).filter((_, i) => i !== ri);
              })}>×</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {colors.map((color) => (
                <button key={color} type="button" className={cn("size-7 rounded-full border", fills[color], row.color === color ? "border-fg" : "border-border")} onClick={() => update((c) => {
                  const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const rows = [...(w.colorWhen ?? [])];
                  rows[ri] = { ...rows[ri]!, color };
                  w.colorWhen = rows;
                })} />
              ))}
            </div>
            <input className={fieldClass()} placeholder="Label (optional)" value={row.label ?? ""} onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              const rows = [...(w.colorWhen ?? [])];
              rows[ri] = { ...rows[ri]!, label: e.target.value || undefined };
              w.colorWhen = rows;
            })} />
            <select className={fieldClass()} value={row.macroId ?? NONE_MACRO_ID} onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              const rows = [...(w.colorWhen ?? [])];
              const macroId = e.target.value === NONE_MACRO_ID ? undefined : e.target.value;
              rows[ri] = { ...rows[ri]!, macroId };
              w.colorWhen = rows;
            })}>
              <option value={NONE_MACRO_ID}>No macro</option>
              {draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (!w) return;
          w.colorWhen = [...(w.colorWhen ?? []), { equals: "", color: w.color, label: undefined, macroId: undefined }];
        })}>Add rule</Button>
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-raised/40 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">When nothing matches</p>
        <label className="grid gap-1 text-sm text-muted">Catch-all color
          <select className={fieldClass()} value={selected.statusDefault?.color ?? ""} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            if (!e.target.value) {
              w.statusDefault = null;
              return;
            }
            w.statusDefault = { ...(w.statusDefault ?? { color: e.target.value as Widget["color"] }), color: e.target.value as Widget["color"] };
          })}>
            <option value="">None (use widget color)</option>
            {colors.map((color) => <option key={color} value={color}>{color}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">Catch-all label
          <input className={fieldClass()} placeholder="Optional" value={selected.statusDefault?.label ?? ""} disabled={!selected.statusDefault?.color} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w?.statusDefault) return;
            w.statusDefault = { ...w.statusDefault, label: e.target.value || undefined };
          })} />
        </label>
        <label className="grid gap-1 text-sm text-muted">Catch-all macro
          <select className={fieldClass()} value={selected.statusDefault?.macroId ?? NONE_MACRO_ID} disabled={!selected.statusDefault?.color} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w?.statusDefault) return;
            const macroId = e.target.value === NONE_MACRO_ID ? undefined : e.target.value;
            w.statusDefault = { ...w.statusDefault, macroId };
          })}>
            <option value={NONE_MACRO_ID}>No macro</option>
            {draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}
