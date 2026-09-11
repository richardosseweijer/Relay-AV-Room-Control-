import { ICON_NAMES, NamedIcon } from "@/components/icons";
import type { RoomConfig, RoomSnapshot, Widget, WidgetColor } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";

export function overlaps(widgets: Widget[], x: number, y: number, w: number, h: number, skipId?: string) {
  return widgets.some((item) => item.id !== skipId && x < item.x + item.w && x + w > item.x && y < item.y + item.h && y + h > item.y);
}

export function PagesEditor({
  draft, snap, page, selected, selectedId, setSelectedId, setPageId, update, colors, fills,
}: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  page: RoomConfig["pages"][number];
  selected: Widget | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setPageId: (id: string) => void;
  update: (mut: (c: RoomConfig) => void) => void;
  colors: WidgetColor[];
  fills: Record<WidgetColor, string>;
}) {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < page.grid.rows; y += 1) for (let x = 0; x < page.grid.cols; x += 1) cells.push({ x, y });
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {draft.pages.map((p) => (
            <button key={p.id} type="button" className={cn("h-10 rounded-md px-3 text-sm", p.id === page.id ? "bg-accent text-accent-fg" : "text-muted")} onClick={() => setPageId(p.id)}>{p.label}</button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => update((c) => {
            const id = `page-${Date.now().toString(36)}`;
            c.pages.push({ id, label: "New page", grid: { ...page.grid }, widgets: [] });
            setPageId(id);
          })}>Add page</Button>
          {draft.pages.length > 1 ? (
            <Button size="sm" variant="danger" onClick={() => update((c) => {
              c.pages = c.pages.filter((p) => p.id !== page.id);
              setPageId(c.pages[0]?.id ?? "");
            })}>Delete page</Button>
          ) : null}
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="grid gap-1 text-xs text-muted">Page name
            <input className={fieldClass()} value={page.label} onChange={(e) => update((c) => { const p = c.pages.find((item) => item.id === page.id); if (p) p.label = e.target.value; })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Columns
            <InputNum min={2} max={12} value={page.grid.cols} onNumber={(n) => update((c) => {
              if (n == null) return;
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              p.grid.cols = Math.max(2, Math.min(12, n));
              c.room.grid.cols = p.grid.cols;
            })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Rows
            <InputNum min={2} max={16} value={page.grid.rows} onNumber={(n) => update((c) => {
              if (n == null) return;
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              p.grid.rows = Math.max(2, Math.min(16, n));
              c.room.grid.rows = p.grid.rows;
            })} />
          </label>
        </div>
        <div className="relative isolate z-0 grid gap-1" style={{ gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${page.grid.rows}, 3.2rem)` }}>
          {cells.map(({ x, y }) => {
            const covered = page.widgets.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                className={cn("rounded-md border border-dashed text-subtle", covered ? "border-transparent" : "border-border/70")}
                style={{ gridColumn: x + 1, gridRow: y + 1 }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  const moving = page.widgets.find((w) => w.id === id);
                  if (!moving) return;
                  if (overlaps(page.widgets, x, y, moving.w, moving.h, id)) return;
                  if (x + moving.w > page.grid.cols || y + moving.h > page.grid.rows) return;
                  update((c) => {
                    const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === id);
                    if (!w) return;
                    w.x = x;
                    w.y = y;
                  });
                  setSelectedId(id);
                }}
                onClick={() => {
                  if (covered) return;
                  const id = `w-${Date.now().toString(36)}`;
                  const w = 1;
                  const h = 1;
                  if (overlaps(page.widgets, x, y, w, h)) return;
                  update((c) => {
                    c.pages.find((p) => p.id === page.id)?.widgets.push({ id, type: "button", x, y, w, h, label: "Button", color: "steel", confirm: false, bind: { kind: "macro", id: NONE_MACRO_ID, gotoPage: null } });
                  });
                  setSelectedId(id);
                }}
              >{covered ? "" : "+"}</button>
            );
          })}
          {page.widgets.map((widget) => (
            <button
              key={widget.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", widget.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => setSelectedId(widget.id)}
              className={cn("z-0 cursor-grab rounded-md border px-2 text-left text-xs active:cursor-grabbing", selectedId === widget.id ? "border-accent" : "border-border", fills[widget.color])}
              style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
            >{widget.label}</button>
          ))}
        </div>
      </div>
      {selected ? (
        <aside className="grid gap-2 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle">Button setup</p>
          <label className="grid gap-1 text-sm text-muted">Label
            <input className={fieldClass()} value={selected.label} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.label = e.target.value; })} />
          </label>
          <div className="grid grid-cols-4 gap-1">
            {(["w", "h", "x", "y"] as const).map((key) => (
              <label key={key} className="grid gap-1 text-[11px] text-muted">
                {key === "w" ? "Width" : key === "h" ? "Height" : key === "x" ? "Column" : "Row"}
                <InputNum
                  min={0}
                  value={selected[key]}
                  onNumber={(n) => update((c) => {
                    if (n == null) return;
                    const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                    if (!w) return;
                    w[key] = Math.max(key === "w" || key === "h" ? 1 : 0, n);
                  })}
                />
              </label>
            ))}
          </div>
          <label className="grid gap-1 text-sm text-muted">Type
          <select
            className={fieldClass()}
            value={selected.type}
            onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              const type = e.target.value as Widget["type"];
              w.type = type;
              if (type === "slider") {
                w.bind = { kind: "range", device: draft.devices[0]?.id, command: "volume.set", variable: draft.variables.find((v) => v.kind === "number")?.id ?? null };
                w.min = 0;
                w.max = 100;
              } else if (type === "status") {
                w.bind = { kind: "variable", variable: draft.variables[0]?.id ?? null };
              } else if (type === "button") {
                w.bind = { kind: "macro", id: draft.macros[0]?.id ?? w.bind.id, gotoPage: null };
              } else if (type === "schedule") {
                w.label = w.label === "Button" || w.label === "Next" || !w.label ? "Next scheduled task" : w.label;
                w.bind = { kind: "macro" };
              }
            })}
          >
            <option value="button">Button</option>
            <option value="slider">Slider</option>
            <option value="status">Status</option>
            <option value="label">Label</option>
            <option value="schedule">Next schedule</option>
          </select>
          </label>
          {selected.type === "button" ? (
            <>
            <label className="grid gap-1 text-sm text-muted">Highlight
              <select className={fieldClass()} value={selected.highlight ?? "auto"} onChange={(e) => update((c) => {
                const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
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
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (w) { w.latchGroup = e.target.value || null; w.highlight = "latch"; }
                })} />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm text-muted">Macro
            <select className={fieldClass()} value={selected.bind.id ?? ""} onChange={(e) => update((c) => {
              const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
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
                const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
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
              <select className={fieldClass()} value={selected.bind.device ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.device = e.target.value; })}>
                {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              </label>
              <label className="grid gap-1 text-sm text-muted">Command
              <select className={fieldClass()} value={selected.bind.command ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.command = e.target.value; })}>
                {(snap.drivers[draft.devices.find((d) => d.id === selected.bind.device)?.driver ?? ""]?.commands ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              </label>
              <label className="grid gap-1 text-sm text-muted">Variable
              <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.bind.variable = e.target.value || null; })}>
                <option value="">No variable</option>
                {draft.variables.filter((v) => v.kind === "number").map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              </label>
              <label className="grid gap-1 text-xs text-muted">Min
                <input className={fieldClass()} inputMode="decimal" placeholder="min" value={selected.min == null ? "" : String(selected.min)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.min = e.target.value; })} />
              </label>
              <label className="grid gap-1 text-xs text-muted">Max
                <input className={fieldClass()} inputMode="decimal" placeholder="max" value={selected.max == null ? "" : String(selected.max)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.max = e.target.value; })} />
              </label>
              <label className="grid gap-1 text-sm text-muted">Follow highlight group
                <input className={fieldClass()} placeholder="scene" value={selected.latchGroup ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.latchGroup = e.target.value || null; })} />
              </label>
            </>
          ) : null}
          {selected.type === "status" ? (
            <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.bind = { kind: "variable", variable: e.target.value }; })}>
              {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {colors.map((color) => (
              <button key={color} type="button" className={cn("size-8 rounded-full border", fills[color], selected.color === color ? "border-fg" : "border-border")} onClick={() => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.color = color; })} />
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(2rem,1fr))] gap-1">
            {ICON_NAMES.map((name) => (
              <button
                key={name || "none"}
                type="button"
                title={name || "no icon"}
                className={cn("flex size-8 items-center justify-center rounded-md border", selected.icon === name || (!name && !selected.icon) ? "border-fg bg-raised" : "border-border")}
                onClick={() => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.icon = name || undefined; })}
              >
                {name ? <NamedIcon name={name} className="size-4 text-muted" /> : <span className="text-[10px] text-subtle">—</span>}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            <p className="text-sm text-muted">Enable when</p>
            {(selected.enableWhen?.all ?? (selected.enableWhen?.variable ? [{ variable: selected.enableWhen.variable, op: "eq" as const, equals: selected.enableWhen.equals }] : [])).map((row, ri) => (
              <div key={ri} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)_auto] gap-1">
                <select className={fieldClass()} value={row.variable ?? ""} onChange={(e) => update((c) => {
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
                  all[ri] = { ...all[ri]!, variable: e.target.value, equals: all[ri]?.equals ?? "", op: all[ri]?.op ?? "eq" };
                  w.enableWhen = { equals: all[0]?.equals ?? "", all };
                })}>
                  {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                <select className={fieldClass()} value={row.op ?? "eq"} onChange={(e) => update((c) => {
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
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
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
                  all[ri] = { ...all[ri]!, equals: e.target.value };
                  w.enableWhen = { equals: all[0]?.equals ?? "", all };
                })} />
                <Button size="sm" variant="ghost" onClick={() => update((c) => {
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const all = [...(w.enableWhen?.all ?? [])].filter((_, i) => i !== ri);
                  w.enableWhen = all.length ? { equals: all[0]?.equals ?? "", all } : null;
                })}>×</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => update((c) => {
              const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
              if (!w) return;
              const all = [...(w.enableWhen?.all ?? (w.enableWhen?.variable ? [{ variable: w.enableWhen.variable, op: "eq" as const, equals: w.enableWhen.equals }] : []))];
              all.push({ variable: c.variables[0]?.id ?? "", op: "eq", equals: "" });
              w.enableWhen = { equals: all[0]?.equals ?? "", all };
            })}>Add condition</Button>
          </div>
          <Button size="sm" variant="danger" onClick={() => update((c) => { const p = c.pages.find((item) => item.id === page.id); if (p) p.widgets = p.widgets.filter((w) => w.id !== selected.id); setSelectedId(null); })}>Delete</Button>
        </aside>
      ) : <p className="text-sm text-muted">Select a button</p>}
    </section>
  );
}
