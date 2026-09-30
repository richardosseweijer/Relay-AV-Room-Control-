import type { RoomConfig, Widget, WidgetColor } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { valueSuggestions } from "@/lib/control/suggest";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { SuggestField } from "./suggest-field";
import { VarTokenField } from "./var-token-field";

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
  const bound = draft.variables.find((v) => v.id === selected.bind.variable);
  const enumHints = valueSuggestions({ varId: bound?.id, varKind: bound?.kind, varValues: bound?.values });
  const macroOptions = [{ id: NONE_MACRO_ID, label: "No macro" }, ...draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => ({ id: m.id, label: m.label }))];
  return (
    <>
      <label className="grid gap-1 text-sm text-muted">Variable
        <SuggestField
          className={fieldClass()}
          value={selected.bind.variable ?? ""}
          options={draft.variables.map((v) => ({ id: v.id, label: v.label }))}
          onChange={(id) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind = { kind: "variable", variable: id }; })}
        />
      </label>
      <div className="grid gap-2 rounded-lg border border-border bg-raised/40 p-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">Color when (first match)</p>
        {(selected.colorWhen ?? []).map((row, ri) => (
          <div key={ri} className="grid gap-1 rounded-md border border-border/60 p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
              <SuggestField
                mode="type"
                className={fieldClass()}
                placeholder="equals"
                value={row.equals}
                options={enumHints}
                onChange={(value) => update((c) => {
                  const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const rows = [...(w.colorWhen ?? [])];
                  rows[ri] = { ...rows[ri]!, equals: value };
                  w.colorWhen = rows;
                })}
              />
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
            <VarTokenField className={fieldClass()} placeholder="Label (optional)" value={row.label ?? ""} variables={draft.variables} onChange={(value) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              const rows = [...(w.colorWhen ?? [])];
              rows[ri] = { ...rows[ri]!, label: value || undefined };
              w.colorWhen = rows;
            })} />
            <SuggestField
              className={fieldClass()}
              value={row.macroId ?? NONE_MACRO_ID}
              options={macroOptions}
              onChange={(id) => update((c) => {
                const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                if (!w) return;
                const rows = [...(w.colorWhen ?? [])];
                rows[ri] = { ...rows[ri]!, macroId: id === NONE_MACRO_ID ? undefined : id };
                w.colorWhen = rows;
              })}
            />
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
          <VarTokenField className={fieldClass()} placeholder="Optional" value={selected.statusDefault?.label ?? ""} variables={draft.variables} disabled={!selected.statusDefault?.color} onChange={(value) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w?.statusDefault) return;
            w.statusDefault = { ...w.statusDefault, label: value || undefined };
          })} />
        </label>
        <label className="grid gap-1 text-sm text-muted">Catch-all macro
          <SuggestField
            className={fieldClass()}
            value={selected.statusDefault?.macroId ?? NONE_MACRO_ID}
            options={macroOptions}
            disabled={!selected.statusDefault?.color}
            onChange={(id) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (!w?.statusDefault) return;
              w.statusDefault = { ...w.statusDefault, macroId: id === NONE_MACRO_ID ? undefined : id };
            })}
          />
        </label>
      </div>
    </>
  );
}
