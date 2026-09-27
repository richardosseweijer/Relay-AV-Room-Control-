import type { ComponentProps } from "react";
import type { RoomConfig, RoomSnapshot, TriggerClause, TriggerCompare, VariableTrigger } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { SYSTEM_TIME_VAR_ID } from "@/lib/control/vars";
import { templateNumericOnly } from "@/lib/control/var-token";
import { valueSuggestions } from "@/lib/control/suggest";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { SuggestField } from "./suggest-field";
import { VarTokenField } from "./var-token-field";
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

function summary(rule: VariableTrigger, draft: RoomConfig, snap: RoomSnapshot) {
  const left = draft.variables.find((v) => v.id === rule.variable)?.label || rule.variable || "variable";
  const extra = rule.whenTrue?.length ? ` +${rule.whenTrue.length}` : "";
  const bits: string[] = [];
  if (rule.setVar) {
    const name = draft.variables.find((v) => v.id === rule.setVar)?.label || rule.setVar;
    bits.push(`set ${name} = ${rule.setValue || "…"}`);
  }
  if (rule.device && rule.command) {
    const device = draft.devices.find((d) => d.id === rule.device);
    const command = snap.drivers[device?.driver ?? ""]?.commands.find((c) => c.id === rule.command);
    bits.push(`${device?.name || "device"} ${command?.label || rule.command}`);
  }
  const macro = draft.macros.find((m) => m.id === rule.macroId);
  if (macro && macro.id !== NONE_MACRO_ID) bits.push(macro.label);
  const when = rule.mode === "interval" ? `every ${rule.intervalSec || 1}s` : "on change";
  return `${left} ${compareWord(rule.compare)} ${rule.equals || "…"}${extra} · ${when} · ${bits.join(" · ") || "no action"}`;
}

export function TriggersSection(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  update: (mut: (c: RoomConfig) => void) => void;
  openLogic: Record<string, boolean>;
  setOpenLogic: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  tagFilter: Record<TagBucket, string>;
  tagBarFor: (bucket: TagBucket) => ComponentProps<typeof TagBar>;
}) {
  const { draft, snap, update, openLogic, setOpenLogic, tagFilter, tagBarFor } = props;
  const vars = draft.variables ?? [];
  const writeVars = vars.filter((v) => v.id !== SYSTEM_TIME_VAR_ID);
  const commandsFor = (deviceId: string) => {
    const device = draft.devices.find((d) => d.id === deviceId);
    if (!device) return [];
    const all = snap.drivers[device.driver]?.commands ?? [];
    if (!device.enabledFeatures.length) return all;
    return all.filter((c) => device.enabledFeatures.includes(c.id));
  };
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
              <span className="min-w-0 truncate text-xs text-muted">{rule.enabled ? summary(rule, draft, snap) : "Off"}</span>
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
                        <SuggestField
                          className={fieldClass()}
                          value={row.variable}
                          options={vars.map((v) => ({ id: v.id, label: v.label }))}
                          onChange={(id) => update((c) => {
                            const next = clausesOf(c.triggers![ti]!);
                            next[ri] = { ...next[ri]!, variable: id };
                            writeClauses(c.triggers![ti]!, next);
                          })}
                        />
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
                        <VarTokenField
                          className={fieldClass()}
                          numericOnly={templateNumericOnly({ compare: row.compare })}
                          suggestions={valueSuggestions({
                            varId: row.variable,
                            varKind: vars.find((v) => v.id === row.variable)?.kind,
                            varValues: vars.find((v) => v.id === row.variable)?.values,
                          })}
                          placeholder="on  or  {occupancy}"
                          value={row.equals}
                          variables={vars}
                          onChange={(value) => update((c) => {
                            const next = clausesOf(c.triggers![ti]!);
                            next[ri] = { ...next[ri]!, equals: value };
                            writeClauses(c.triggers![ti]!, next);
                          })}
                        />
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
                    <SuggestField
                      className={fieldClass()}
                      value={rule.macroId}
                      options={[{ id: NONE_MACRO_ID, label: "None" }, ...macros.map((m) => ({ id: m.id, label: m.label }))]}
                      onChange={(id) => update((c) => { c.triggers![ti]!.macroId = id; })}
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-muted">Set variable
                    <SuggestField
                      className={fieldClass()}
                      value={rule.setVar || ""}
                      options={[{ id: "", label: "None" }, ...writeVars.map((v) => ({ id: v.id, label: v.label }))]}
                      onChange={(id) => update((c) => { c.triggers![ti]!.setVar = id; })}
                    />
                  </label>
                  {rule.setVar ? (
                    <label className="grid gap-1 text-sm text-muted">To
                      <VarTokenField
                        className={fieldClass()}
                        numericOnly={templateNumericOnly({ varKind: vars.find((v) => v.id === rule.setVar)?.kind })}
                        suggestions={valueSuggestions({
                          varId: rule.setVar,
                          varKind: vars.find((v) => v.id === rule.setVar)?.kind,
                          varValues: vars.find((v) => v.id === rule.setVar)?.values,
                        })}
                        placeholder="1  or  {occupancy}"
                        value={rule.setValue ?? ""}
                        variables={vars}
                        onChange={(value) => update((c) => { c.triggers![ti]!.setValue = value; })}
                      />
                    </label>
                  ) : <span />}
                  <label className="grid gap-1 text-sm text-muted">Device
                    <SuggestField
                      className={fieldClass()}
                      value={rule.device || ""}
                      options={[{ id: "", label: "None" }, ...draft.devices.map((d) => ({ id: d.id, label: d.name }))]}
                      onChange={(id) => update((c) => {
                        const device = c.devices.find((d) => d.id === id);
                        const all = snap.drivers[device?.driver ?? ""]?.commands ?? [];
                        const allowed = !device?.enabledFeatures.length ? all : all.filter((cmd) => device.enabledFeatures.includes(cmd.id));
                        c.triggers![ti]!.device = id;
                        c.triggers![ti]!.command = id ? (allowed[0]?.id ?? "") : "";
                        c.triggers![ti]!.commandValue = "";
                      })}
                    />
                  </label>
                  {rule.device ? (
                    <label className="grid gap-1 text-sm text-muted">Function
                      <SuggestField
                        className={fieldClass()}
                        value={rule.command || ""}
                        options={commandsFor(rule.device).map((cmd) => ({ id: cmd.id, label: cmd.label }))}
                        onChange={(id) => update((c) => { c.triggers![ti]!.command = id; })}
                      />
                    </label>
                  ) : null}
                  {(() => {
                    const command = commandsFor(rule.device || "").find((cmd) => cmd.id === rule.command);
                    if (!rule.device || (command?.kind !== "range" && command?.kind !== "enum")) return null;
                    return (
                      <label className="grid gap-1 text-sm text-muted sm:col-span-2">Value
                        <VarTokenField
                          className={fieldClass()}
                          numericOnly={templateNumericOnly({ commandKind: command?.kind })}
                          suggestions={valueSuggestions({
                            commandId: rule.command,
                            commandKind: command?.kind,
                            commandValues: command?.values,
                            macros: macros.map((m) => ({ id: m.id, label: m.label })),
                            pages: draft.pages.map((p) => ({ id: p.id, label: p.label })),
                          })}
                          placeholder="literal or {var}"
                          value={rule.commandValue ?? ""}
                          variables={vars}
                          onChange={(value) => update((c) => { c.triggers![ti]!.commandValue = value; })}
                        />
                      </label>
                    );
                  })()}
                </div>

                {stale ? (
                  <p className="text-xs text-muted">This saved trigger still has an old false-path or hold/delay. Those still run. This pane edits the If rows and the true actions only.</p>
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
          enabled: true,
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
          setVar: "",
          setValue: "",
          device: "",
          command: "",
          commandValue: "",
          falseMacroId: "",
          tag: currentTag(tagFilter.triggers) || null,
        });
      })}>Add trigger</Button>
    </section>
  );
}
