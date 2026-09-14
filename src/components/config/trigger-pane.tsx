import type { ComponentProps } from "react";
import type { RoomConfig, TriggerClause, TriggerCompare, VariableTrigger } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { TagBar, currentTag, fileItem, tagNames, tagOf, tagVisible, type TagBucket } from "./tag-bar";

const COMPARE: { id: TriggerCompare; label: string }[] = [
  { id: "eq", label: "equals" },
  { id: "neq", label: "is not" },
  { id: "gt", label: "is greater than" },
  { id: "lt", label: "is less than" },
];

function clausesOf(rule: VariableTrigger): TriggerClause[] {
  return [
    { variable: rule.variable, compare: rule.compare || "eq", equals: rule.equals ?? "" },
    ...(rule.whenTrue ?? []),
  ];
}

function writeClauses(rule: VariableTrigger, rows: TriggerClause[]) {
  const first = rows[0] ?? { variable: "", compare: "eq" as TriggerCompare, equals: "" };
  rule.variable = first.variable;
  rule.compare = first.compare || "eq";
  rule.equals = first.equals ?? "";
  rule.whenTrue = rows.slice(1).slice(0, 8);
}

function compareWord(id: string) {
  return COMPARE.find((row) => row.id === id)?.label ?? id;
}

function summary(rule: VariableTrigger, draft: RoomConfig) {
  const left = draft.variables.find((v) => v.id === rule.variable)?.label || rule.variable || "variable";
  const extra = rule.whenTrue?.length ? ` +${rule.whenTrue.length}` : "";
  const macro = draft.macros.find((m) => m.id === rule.macroId)?.label || "no macro";
  const when = rule.mode === "interval" ? `every ${rule.intervalSec || 1}s` : "on change";
  return `${left} ${compareWord(rule.compare)} ${rule.equals || "…"}${extra} · ${when} · ${macro}`;
}

export function TriggersSection(props: {
  draft: RoomConfig;
  update: (mut: (c: RoomConfig) => void) => void;
  openLogic: Record<string, boolean>;
  setOpenLogic: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  tagFilter: Record<TagBucket, string>;
  tagBarFor: (bucket: TagBucket) => ComponentProps<typeof TagBar>;
}) {
  const { draft, update, openLogic, setOpenLogic, tagFilter, tagBarFor } = props;
  const vars = draft.variables ?? [];
  const macros = (draft.macros ?? []).filter((m) => m.id !== NONE_MACRO_ID);
  return (
    <section className="grid gap-3">
      <TagBar {...tagBarFor("triggers")} />
      {(draft.triggers ?? []).map((rule, ti) => {
        if (!tagVisible(tagFilter.triggers, rule)) return null;
        const open = openLogic[rule.id] === true;
        const rows = clausesOf(rule);
        const stale = Boolean(rule.whenFalse?.length || rule.falseMacroId || rule.holdSec || rule.delaySec);
        return (
          <article
            key={rule.id}
            className="rounded-xl border border-border bg-surface p-4"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `trg:${rule.id}`)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData("text/plain");
              if (!raw.startsWith("trg:")) return;
              e.preventDefault();
              const fromId = raw.slice(4);
              update((c) => {
                const list = c.triggers ?? [];
                const from = list.findIndex((item) => item.id === fromId);
                if (from < 0 || from === ti) return;
                const [row] = list.splice(from, 1);
                if (row) list.splice(ti, 0, row);
                c.triggers = list;
              });
            }}
          >
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [rule.id]: !open }))}>
              <span className="font-medium">{rule.label || "Trigger"}</span>
              <span className="min-w-0 truncate text-xs text-muted">{rule.enabled ? summary(rule, draft) : "Off"}</span>
            </button>
            {open ? (
              <div className="mt-3 grid gap-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-muted">Name
                    <input className={fieldClass()} value={rule.label} onChange={(e) => update((c) => { c.triggers![ti]!.label = e.target.value; })} />
                  </label>
                  <label className="grid gap-1 text-sm text-muted">Tag
                    <select className={fieldClass()} value={tagOf(rule)} onChange={(e) => update((c) => fileItem(c, "triggers", rule.id, e.target.value))}>
                      <option value="">Untagged</option>
                      {tagNames(draft, "triggers").map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>

                <div className="grid gap-2">
                  {rows.map((row, ri) => (
                    <div key={ri} className="grid gap-2 rounded-md bg-bg p-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <span className="self-center text-sm text-muted">{ri === 0 ? "If" : "and"}</span>
                      <label className="grid gap-1 text-xs text-muted">Variable
                        <select className={fieldClass()} value={row.variable} onChange={(e) => update((c) => {
                          const next = clausesOf(c.triggers![ti]!);
                          next[ri] = { ...next[ri]!, variable: e.target.value };
                          writeClauses(c.triggers![ti]!, next);
                        })}>
                          {vars.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs text-muted">Compare
                        <select className={fieldClass()} value={row.compare} onChange={(e) => update((c) => {
                          const next = clausesOf(c.triggers![ti]!);
                          next[ri] = { ...next[ri]!, compare: e.target.value as TriggerCompare };
                          writeClauses(c.triggers![ti]!, next);
                        })}>
                          {COMPARE.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs text-muted">Value
                        <input
                          className={fieldClass()}
                          list={`trg-${rule.id}-${ri}`}
                          placeholder="on  or  {occupancy}"
                          value={row.equals}
                          onChange={(e) => update((c) => {
                            const next = clausesOf(c.triggers![ti]!);
                            next[ri] = { ...next[ri]!, equals: e.target.value };
                            writeClauses(c.triggers![ti]!, next);
                          })}
                        />
                        <datalist id={`trg-${rule.id}-${ri}`}>
                          {vars.map((v) => <option key={v.id} value={`{${v.id}}`}>{v.label}</option>)}
                        </datalist>
                      </label>
                      <Button size="sm" variant="ghost" disabled={rows.length < 2} onClick={() => update((c) => {
                        const next = clausesOf(c.triggers![ti]!).filter((_, i) => i !== ri);
                        writeClauses(c.triggers![ti]!, next.length ? next : [{ variable: vars[0]?.id ?? "", compare: "eq", equals: "" }]);
                      })}>×</Button>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => update((c) => {
                    const next = clausesOf(c.triggers![ti]!);
                    if (next.length >= 9) return;
                    next.push({ variable: vars[0]?.id ?? "", compare: "eq", equals: "" });
                    writeClauses(c.triggers![ti]!, next);
                  })}>Add condition</Button>
                  <p className="text-xs text-muted">All If rows must be true. Value can be a literal or another variable as {"{id}"}.</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-muted">When
                    <select className={fieldClass()} value={rule.mode} onChange={(e) => update((c) => { c.triggers![ti]!.mode = e.target.value as VariableTrigger["mode"]; })}>
                      <option value="change">On change (once when it becomes true)</option>
                      <option value="interval">Every interval while true</option>
                    </select>
                  </label>
                  {rule.mode === "interval" ? (
                    <label className="grid gap-1 text-sm text-muted">Interval (s)
                      <InputNum min={1} value={rule.intervalSec} onNumber={(n) => update((c) => { if (n == null) return; c.triggers![ti]!.intervalSec = Math.max(1, n); })} />
                    </label>
                  ) : <span />}
                  <label className="grid gap-1 text-sm text-muted sm:col-span-2">Run macro
                    <select className={fieldClass()} value={rule.macroId} onChange={(e) => update((c) => { c.triggers![ti]!.macroId = e.target.value; })}>
                      <option value={NONE_MACRO_ID}>None</option>
                      {macros.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                </div>

                {stale ? (
                  <p className="text-xs text-muted">This saved trigger still has an old false-path or hold/delay. Those still run. This pane only edits the If rows and the true macro.</p>
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => update((c) => { c.triggers![ti]!.enabled = e.target.checked; })} />
                  Enabled
                </label>
                <Button size="sm" variant="danger" onClick={() => update((c) => { c.triggers = (c.triggers ?? []).filter((item) => item.id !== rule.id); })}>Delete</Button>
              </div>
            ) : null}
          </article>
        );
      })}
      <Button variant="secondary" onClick={() => update((c) => {
        c.triggers = c.triggers ?? [];
        c.triggers.push({
          id: `trg-${Date.now().toString(36)}`,
          label: "New trigger",
          enabled: false,
          variable: c.variables[0]?.id ?? "",
          compare: "eq",
          equals: "",
          whenTrue: [],
          whenFalse: [],
          mode: "change",
          intervalSec: 5,
          delaySec: 0,
          holdSec: 0,
          macroId: NONE_MACRO_ID,
          falseMacroId: "",
          tag: currentTag(tagFilter.triggers) || null,
        });
      })}>Add trigger</Button>
    </section>
  );
}
