import type { RoomConfig, Widget } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";

/** Widget enableWhen conditions editor (AND rows: variable / op / value). */
export function PagesEnableWhen({
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
    <div className="grid gap-2">
      <p className="text-sm text-muted">Enable when</p>
      {(selected.enableWhen?.all ?? (selected.enableWhen?.variable ? [{ variable: selected.enableWhen.variable, op: "eq" as const, equals: selected.enableWhen.equals }] : [])).map((row, ri) => (
        <div key={ri} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)_auto] gap-1">
          <select className={fieldClass()} value={row.variable ?? ""} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
            all[ri] = { ...all[ri]!, variable: e.target.value, equals: all[ri]?.equals ?? "", op: all[ri]?.op ?? "eq" };
            w.enableWhen = { equals: all[0]?.equals ?? "", all };
          })}>
            {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <select className={fieldClass()} value={row.op ?? "eq"} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            const all = [...(w.enableWhen?.all ?? [])];
            if (!all.length && w.enableWhen?.variable) all.push({ variable: w.enableWhen.variable, op: "eq", equals: w.enableWhen.equals });
            all[ri] = { ...all[ri]!, op: e.target.value as "eq" | "neq" | "gt" | "lt" | "gte" | "lte" };
            w.enableWhen = { equals: all[0]?.equals ?? "", all };
          })}>
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="gt">{">"}</option>
            <option value="lt">{"<"}</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          <input className={fieldClass()} placeholder="value" value={row.equals} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
            all[ri] = { ...all[ri]!, equals: e.target.value };
            w.enableWhen = { equals: all[0]?.equals ?? "", all };
          })} />
          <Button size="sm" variant="ghost" onClick={() => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            const all = [...(w.enableWhen?.all ?? [])].filter((_, i) => i !== ri);
            w.enableWhen = all.length ? { equals: all[0]?.equals ?? "", all } : null;
          })}>×</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => update((c) => {
        const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
        if (!w) return;
        const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
        all.push({ variable: c.variables[0]?.id ?? "", op: "eq", equals: "" });
        w.enableWhen = { equals: all[0]?.equals ?? "", all };
      })}>Add condition</Button>
      {selected.type === "label" ? (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={selected.hideWhenDisabled === true}
            onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (w) w.hideWhenDisabled = e.target.checked;
            })}
          />
          Hide when disabled
        </label>
      ) : null}
    </div>
  );
}
