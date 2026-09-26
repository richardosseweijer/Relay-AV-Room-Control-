import { useState } from "react";
import { ICON_NAMES, NamedIcon } from "@/components/icons";
import type { RoomConfig, RoomSnapshot, Widget, WidgetColor } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import {
  copyLandscapeToPortrait,
  DEFAULT_PORTRAIT_GRID,
  ensurePortraitGrid,
  firstFree,
  gridStyle,
  overlaps,
  pageGrid,
  setBox,
  widgetBox,
} from "@/lib/control/page-layout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { PagesStatusFields } from "./pages-status-fields";
import { PagesPreviewFields } from "./pages-preview-fields";
import { PagesImageFields } from "./pages-image-fields";
import { PagesEnableWhen } from "./pages-enable-when";
import { PagesBindFields } from "./pages-bind-fields";

export { overlaps };

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
  const [face, setFace] = useState<"landscape" | "portrait">("landscape");
  const portrait = face === "portrait";
  const grid = pageGrid(page, portrait);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.rows; y += 1) for (let x = 0; x < grid.cols; x += 1) cells.push({ x, y });
  const placed = page.widgets.filter((w) => widgetBox(w, portrait));
  const unplaced = portrait ? page.widgets.filter((w) => !w.portrait) : [];
  const selectedBox = selected ? widgetBox(selected, portrait) : null;
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {draft.pages.map((p) => (
            <button key={p.id} type="button" className={cn("h-10 rounded-md px-3 text-sm", p.id === page.id ? "bg-accent text-accent-fg" : "text-muted")} onClick={() => setPageId(p.id)}>{p.label}</button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => update((c) => {
            const id = `page-${Date.now().toString(36)}`;
            c.pages.push({
              id,
              label: "New page",
              grid: { ...page.grid },
              portraitGrid: { ...(page.portraitGrid ?? DEFAULT_PORTRAIT_GRID) },
              widgets: [],
            });
            setPageId(id);
          })}>Add page</Button>
          {draft.pages.length > 1 ? (
            <Button size="sm" variant="danger" onClick={() => update((c) => {
              c.pages = c.pages.filter((p) => p.id !== page.id);
              setPageId(c.pages[0]?.id ?? "");
            })}>Delete page</Button>
          ) : null}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className={cn("h-9 rounded-md px-3 text-sm", !portrait ? "bg-accent text-accent-fg" : "text-muted")} onClick={() => setFace("landscape")}>Landscape</button>
          <button type="button" className={cn("h-9 rounded-md px-3 text-sm", portrait ? "bg-accent text-accent-fg" : "text-muted")} onClick={() => {
            update((c) => {
              const p = c.pages.find((item) => item.id === page.id);
              if (p) ensurePortraitGrid(p);
            });
            setFace("portrait");
          }}>Portrait</button>
          {portrait ? (
            <Button size="sm" variant="secondary" onClick={() => update((c) => {
              const p = c.pages.find((item) => item.id === page.id);
              if (p) copyLandscapeToPortrait(p);
            })}>Copy from landscape</Button>
          ) : null}
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="grid gap-1 text-xs text-muted">Page name
            <input className={fieldClass()} value={page.label} onChange={(e) => update((c) => { const p = c.pages.find((item) => item.id === page.id); if (p) p.label = e.target.value; })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Page id
            <input
              className={cn(fieldClass(), "font-mono")}
              value={page.id}
              readOnly
              title="Used by ui.page / gotoPage"
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">Columns
            <InputNum min={2} max={12} value={grid.cols} onNumber={(n) => update((c) => {
              if (n == null) return;
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              const cols = Math.max(2, Math.min(12, n));
              if (portrait) {
                ensurePortraitGrid(p).cols = cols;
              } else {
                p.grid.cols = cols;
                c.room.grid.cols = cols;
              }
            })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Rows
            <InputNum min={2} max={16} value={grid.rows} onNumber={(n) => update((c) => {
              if (n == null) return;
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              const rows = Math.max(2, Math.min(16, n));
              if (portrait) {
                ensurePortraitGrid(p).rows = rows;
              } else {
                p.grid.rows = rows;
                c.room.grid.rows = rows;
              }
            })} />
          </label>
        </div>
        <div className="relative isolate z-0 grid gap-1" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, 3.2rem)` }}>
          {cells.map(({ x, y }) => {
            const covered = overlaps(page.widgets, x, y, 1, 1, undefined, portrait);
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
                  const box = widgetBox(moving, portrait) ?? { x, y, w: 1, h: 1 };
                  if (overlaps(page.widgets, x, y, box.w, box.h, id, portrait)) return;
                  if (x + box.w > grid.cols || y + box.h > grid.rows) return;
                  update((c) => {
                    const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === id);
                    if (!w) return;
                    setBox(w, portrait, { x, y, w: box.w, h: box.h });
                  });
                  setSelectedId(id);
                }}
                onClick={() => {
                  if (covered) return;
                  const id = `w-${Date.now().toString(36)}`;
                  const landBoxes = page.widgets.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
                  const land = portrait
                    ? (firstFree(landBoxes, page.grid.cols, page.grid.rows) ?? { x: 0, y: 0, w: 1, h: 1 })
                    : { x, y, w: 1, h: 1 };
                  if (!portrait && overlaps(page.widgets, x, y, 1, 1)) return;
                  if (portrait && overlaps(page.widgets, x, y, 1, 1, undefined, true)) return;
                  update((c) => {
                    const next: Widget = {
                      id,
                      type: "button",
                      x: land.x,
                      y: land.y,
                      w: land.w,
                      h: land.h,
                      label: "Button",
                      color: "steel",
                      confirm: false,
                      bind: { kind: "macro", id: NONE_MACRO_ID, gotoPage: null },
                    };
                    if (portrait) next.portrait = { x, y, w: 1, h: 1 };
                    c.pages.find((p) => p.id === page.id)?.widgets.push(next);
                  });
                  setSelectedId(id);
                }}
              >{covered ? "" : "+"}</button>
            );
          })}
          {placed.map((widget) => {
            const box = widgetBox(widget, portrait)!;
            return (
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
              style={gridStyle(box)}
            >{widget.label}</button>
            );
          })}
        </div>
        {unplaced.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <p className="w-full text-[11px] uppercase tracking-[0.16em] text-subtle">Not on portrait — drag onto a cell</p>
            {unplaced.map((widget) => (
              <button
                key={widget.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", widget.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => setSelectedId(widget.id)}
                className={cn("h-8 rounded-md border px-2 text-xs", selectedId === widget.id ? "border-accent" : "border-border", fills[widget.color])}
              >{widget.label}</button>
            ))}
          </div>
        ) : null}
      </div>
      {selected ? (
        <aside className="order-first grid max-h-[70dvh] gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-4 lg:order-none lg:sticky lg:top-20 lg:max-h-[calc(100dvh-8rem)]">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle">{selected.type === "preview" ? "Preview setup" : selected.type === "image" ? "Image setup" : selected.type === "status" ? "Status setup" : "Button setup"}</p>
          <label className="grid gap-1 text-sm text-muted">Label
            <input className={fieldClass()} value={selected.label} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.label = e.target.value; })} />
          </label>
          <div className="grid grid-cols-4 gap-1">
            {(["w", "h", "x", "y"] as const).map((key) => (
              <label key={key} className="grid gap-1 text-[11px] text-muted">
                {key === "w" ? "Width" : key === "h" ? "Height" : key === "x" ? "Column" : "Row"}
                <InputNum
                  min={0}
                  value={selectedBox?.[key] ?? (key === "w" || key === "h" ? 1 : 0)}
                  onNumber={(n) => update((c) => {
                    if (n == null) return;
                    const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                    if (!w) return;
                    setBox(w, portrait, { [key]: Math.max(key === "w" || key === "h" ? 1 : 0, n) });
                  })}
                />
              </label>
            ))}
          </div>
          {portrait && selected.portrait ? (
            <Button size="sm" variant="secondary" onClick={() => update((c) => {
              const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
              if (w) w.portrait = undefined;
            })}>Hide on portrait</Button>
          ) : null}
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
                delete w.textSize;
              } else if (type === "status") {
                w.bind = { kind: "variable", variable: draft.variables[0]?.id ?? null };
              } else if (type === "button") {
                w.bind = { kind: "macro", id: draft.macros[0]?.id ?? w.bind.id, gotoPage: null };
              } else if (type === "schedule") {
                w.label = w.label === "Button" || w.label === "Next" || !w.label ? "Next scheduled task" : w.label;
                w.bind = { kind: "macro" };
              } else if (type === "preview") {
                // Optional RTSP tile. Drop this branch + PagesPreviewFields to remove.
                w.label = w.label === "Button" || !w.label ? "Preview" : w.label;
                w.streamUrl = w.streamUrl || "";
                w.bind = { kind: "macro", id: w.bind.id ?? NONE_MACRO_ID, device: w.bind.device ?? draft.devices[0]?.id, gotoPage: null };
              } else if (type === "image") {
                w.label = w.label === "Button" || !w.label ? "Image" : w.label;
                w.imageFit = w.imageFit === "cover" ? "cover" : "contain";
                w.bind = { kind: "macro", id: w.bind.id ?? NONE_MACRO_ID, gotoPage: null };
              }
            })}
          >
            <option value="button">Button</option>
            <option value="slider">Slider</option>
            <option value="status">Status</option>
            <option value="label">Label</option>
            <option value="schedule">Next schedule</option>
            <option value="preview">Preview</option>
            <option value="image">Image</option>
          </select>
          </label>
          {selected.type !== "preview" && selected.type !== "image" && selected.type !== "slider" ? (
            <label className="grid gap-1 text-sm text-muted">Text size
              <select
                className={fieldClass()}
                value={selected.textSize === "xs" || selected.textSize === "sm" || selected.textSize === "lg" ? selected.textSize : "md"}
                onChange={(e) => update((c) => {
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const next = e.target.value;
                  w.textSize = next === "xs" || next === "sm" || next === "lg" ? next : "md";
                })}
              >
                <option value="xs">Extra small</option>
                <option value="sm">Small</option>
                <option value="md">Medium</option>
                <option value="lg">Large</option>
              </select>
            </label>
          ) : null}
          {selected.type === "label" || selected.type === "button" || selected.type === "status" ? (
            <label className="grid gap-1 text-sm text-muted">Text align
              <select
                className={fieldClass()}
                value={selected.textAlign === "center" || selected.textAlign === "right" ? selected.textAlign : "left"}
                onChange={(e) => update((c) => {
                  const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                  if (!w) return;
                  const next = e.target.value;
                  w.textAlign = next === "center" || next === "right" ? next : "left";
                })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          ) : null}
          {(selected.type === "button" || selected.type === "slider") ? (
            <PagesBindFields
              selected={selected}
              pageId={page.id}
              draft={draft}
              snap={snap}
              update={update}
            />
          ) : null}
          {selected.type === "status" ? (
            <PagesStatusFields
              selected={selected}
              pageId={page.id}
              draft={draft}
              update={update}
              colors={colors}
              fills={fills}
            />
          ) : null}
          {selected.type === "preview" ? (
            <PagesPreviewFields
              selected={selected}
              pageId={page.id}
              draft={draft}
              update={update}
            />
          ) : null}
          {selected.type === "image" ? (
            <PagesImageFields
              selected={selected}
              pageId={page.id}
              draft={draft}
              update={update}
            />
          ) : null}
          {!(selected.type === "image" && selected.imageBorderless) ? (
          <div className="flex flex-wrap gap-1">
            {colors.map((color) => (
              <button key={color} type="button" className={cn("size-8 rounded-full border", fills[color], selected.color === color ? "border-fg" : "border-border")} onClick={() => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.color = color; })} />
            ))}
          </div>
          ) : null}
          {selected.type !== "image" ? (
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
          ) : null}
          <PagesEnableWhen
            selected={selected}
            pageId={page.id}
            draft={draft}
            update={update}
          />
          <Button size="sm" variant="danger" onClick={() => update((c) => { const p = c.pages.find((item) => item.id === page.id); if (p) p.widgets = p.widgets.filter((w) => w.id !== selected.id); setSelectedId(null); })}>Delete</Button>
        </aside>
      ) : <p className="text-sm text-muted">Select a button</p>}
    </section>
  );
}
