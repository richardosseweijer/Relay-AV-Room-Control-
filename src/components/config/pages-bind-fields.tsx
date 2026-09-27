import type { RoomConfig, RoomSnapshot, Widget } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { templateNumericOnly } from "@/lib/control/var-token";
import { latchGroupOptions } from "@/lib/control/suggest";
import { fieldClass } from "./config-ui";
import { SuggestField } from "./suggest-field";
import { VarTokenField } from "./var-token-field";

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
  const groups = latchGroupOptions(draft.pages.flatMap((page) => page.widgets.map((widget) => widget.latchGroup)));
  const commands = snap.drivers[draft.devices.find((d) => d.id === selected.bind.device)?.driver ?? ""]?.commands ?? [];
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
            <SuggestField
              mode="type"
              className={fieldClass()}
              placeholder="sources"
              value={selected.latchGroup ?? ""}
              options={groups}
              onChange={(value) => update((c) => {
                const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
                if (w) { w.latchGroup = value || null; w.highlight = "latch"; }
              })}
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-sm text-muted">Macro
        <SuggestField
          className={fieldClass()}
          value={selected.bind.id ?? ""}
          options={[{ id: NONE_MACRO_ID, label: "None" }, ...draft.macros.filter((m) => m.id !== NONE_MACRO_ID).map((m) => ({ id: m.id, label: m.label }))]}
          onChange={(id) => update((c) => {
            const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
            if (!w) return;
            w.bind.kind = "macro";
            w.bind.id = id;
            const name = c.macros.find((m) => m.id === id)?.label;
            if (name && id !== NONE_MACRO_ID) w.label = name;
          })}
        />
        </label>
        </>
      ) : null}
      {selected.type === "button" ? (
        <label className="grid gap-1 text-sm text-muted">Also go to page
          <SuggestField
            className={fieldClass()}
            value={selected.bind.gotoPage ?? ""}
            options={[{ id: "", label: "Stay on this page" }, ...draft.pages.map((p) => ({ id: p.id, label: p.label }))]}
            onChange={(id) => update((c) => {
              const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id);
              if (w) w.bind.gotoPage = id || null;
            })}
          />
        </label>
      ) : null}
      {selected.type === "slider" ? (
        <>
          <label className="grid gap-1 text-sm text-muted">Device
          <SuggestField
            className={fieldClass()}
            value={selected.bind.device ?? ""}
            options={draft.devices.map((d) => ({ id: d.id, label: d.name }))}
            onChange={(id) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.device = id; })}
          />
          </label>
          <label className="grid gap-1 text-sm text-muted">Command
          <SuggestField
            className={fieldClass()}
            value={selected.bind.command ?? ""}
            options={commands.map((c) => ({ id: c.id, label: c.label }))}
            onChange={(id) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.command = id; })}
          />
          </label>
          <label className="grid gap-1 text-sm text-muted">Variable
          <SuggestField
            className={fieldClass()}
            value={selected.bind.variable ?? ""}
            options={[{ id: "", label: "No variable" }, ...draft.variables.filter((v) => v.kind === "number").map((v) => ({ id: v.id, label: v.label }))]}
            onChange={(id) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.variable = id || null; })}
          />
          </label>
          <label className="grid gap-1 text-xs text-muted">Min
            <VarTokenField className={fieldClass()} numericOnly={templateNumericOnly({ bound: true })} placeholder="min" value={selected.min == null ? "" : String(selected.min)} variables={draft.variables} onChange={(value) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.min = value; })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Max
            <VarTokenField className={fieldClass()} numericOnly={templateNumericOnly({ bound: true })} placeholder="max" value={selected.max == null ? "" : String(selected.max)} variables={draft.variables} onChange={(value) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.max = value; })} />
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
            <SuggestField
              mode="type"
              className={fieldClass()}
              placeholder="scene"
              value={selected.latchGroup ?? ""}
              options={groups}
              onChange={(value) => update((c) => { const w = c.pages.find((p) => p.id === pageId)?.widgets.find((item) => item.id === selected.id); if (w) w.latchGroup = value || null; })}
            />
          </label>
        </>
      ) : null}
    </>
  );
}
