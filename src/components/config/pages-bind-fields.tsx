import type { RoomConfig, RoomSnapshot, Widget } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { fieldClass } from "./config-ui";

/** Button/slider sidebar: macro/goto/highlight (button) and device/command/range (slider). */
export function PagesBindFields({
  selected,
  pageId,
  draft,
  snap,
  update,
}: {
  selected: Widget;
  pageId: string;
  draft: RoomConfig;
  snap: RoomSnapshot;
  update: (mut: (c: RoomConfig) => void) => void;
}) {
  return (
    <>
      {selected.type === "button" ? (
        <>
        <label className="grid gap-1 text-sm text-muted">Highlight
          <select className={fieldClass()} value={selected.highlight ?? "auto"} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) w.highlight = e.target.value as Widget["highlight"];
          })}>
            <option value="auto">When variable matches</option>
            <option value="latch">Last pressed in group</option>
            <option value="off">Never</option>
          </select>
        </label>
        {(selected.highlight === "latch" || selected.latchGroup) ? (
          <label className="grid gap-1 text-sm text-muted">Group name
            <input className={fieldClass()} placeholder="sources" value={selected.latchGroup ?? ""} onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (w) { w.latchGroup = e.target.value || null; w.highlight = "latch"; }
            })} />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm text-muted">Macro
        <select className={fieldClass()} value={selected.bind.id ?? ""} onChange={(e) => update((c) => {
          const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
          if (!w) return;
          w.bind.kind = "macro";
          w.bind.id = e.target.value;
          const name = c.macros.find((m) => m.id === e.target.value)?.label;
          if (name && e.target.value !== NONE_MACRO_ID) w.label = name;
        })}>
          <option value={NONE_MACRO_ID}>None</option>
          {draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        </label>
        </>
      ) : null}
      {selected.type === "button" ? (
        <label className="grid gap-1 text-sm text-muted">Also go to page
          <select className={fieldClass()} value={selected.bind.gotoPage ?? ""} onChange={(e) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (w) w.bind.gotoPage = e.target.value || null;
          })}>
            <option value="">Stay on this page</option>
            {draft.pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : null}
      {selected.type === "slider" ? (
        <>
          <label className="grid gap-1 text-sm text-muted">Device
          <select className={fieldClass()} value={selected.bind.device ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.device = e.target.value; })}>
            {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Command
          <select className={fieldClass()} value={selected.bind.command ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.command = e.target.value; })}>
            {(snap.drivers[draft.devices.find((d) => d.id === selected.bind.device)?.driver ?? ""]?.commands ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Variable
          <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.variable = e.target.value || null; })}>
            <option value="">No variable</option>
            {draft.variables.filter((v) => v.kind === "number").map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">Min
            <input className={fieldClass()} inputMode="decimal" placeholder="min" value={selected.min == null ? "" : String(selected.min)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.min = e.target.value; })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Max
            <input className={fieldClass()} inputMode="decimal" placeholder="max" value={selected.max == null ? "" : String(selected.max)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.max = e.target.value; })} />
          </label>
          <label className="grid gap-1 text-sm text-muted">Direction
            <select className={fieldClass()} value={selected.sliderDir ?? "auto"} onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              w.sliderDir = e.target.value === "vertical" || e.target.value === "horizontal" ? e.target.value : undefined;
            })}>
              <option value="auto">Auto (taller = upright)</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Upright</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Follow highlight group
            <input className={fieldClass()} placeholder="scene" value={selected.latchGroup ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.latchGroup = e.target.value || null; })} />
          </label>
        </>
      ) : null}
    </>
  );
}
