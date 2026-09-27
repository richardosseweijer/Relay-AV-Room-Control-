import type { ComponentProps } from "react";
import type { RoomConfig, RoomSnapshot, TriggerClause, TriggerCompare, VariableTrigger } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { SYSTEM_TIME_VAR_ID } from "@/lib/control/vars";
import { templateNumericOnly } from "@/lib/control/var-token";
import { valueSuggestions } from "@/lib/control/suggest";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

function actionBits(rule: VariableTrigger, draft: RoomConfig, snap: RoomSnapshot, side: "true" | "false") {
  const setVar = side === "true" ? rule.setVar : rule.falseSetVar;
  const setValue = side === "true" ? rule.setValue : rule.falseSetValue;
  const deviceId = side === "true" ? rule.device : rule.falseDevice;
  const commandId = side === "true" ? rule.command : rule.falseCommand;
  const macroId = side === "true" ? rule.macroId : rule.falseMacroId;
  const bits: string[] = [];
  if (setVar) {
    const name = draft.variables.find((v) => v.id === setVar)?.label || setVar;
    bits.push(`set ${name} = ${setValue || "…"}`);
  }
  if (deviceId && commandId) {
    const device = draft.devices.find((d) => d.id === deviceId);
    const command = snap.drivers[device?.driver ?? ""]?.commands.find((c) => c.id === commandId);
    bits.push(`${device?.name || "device"} ${command?.label || commandId}`);
  }
  const macro = draft.macros.find((m) => m.id === macroId);
  if (macro && macro.id !== NONE_MACRO_ID) bits.push(macro.label);
  return bits;
}

function summary(rule: VariableTrigger, draft: RoomConfig, snap: RoomSnapshot) {
  const left = draft.variables.find((v) => v.id === rule.variable)?.label || rule.variable || "variable";
  const extra = rule.whenTrue?.length ? ` +${rule.whenTrue.length}` : "";
  const when = rule.mode === "interval" ? `every ${rule.intervalSec || 1}s` : "on change";
  const yes = actionBits(rule, draft, snap, "true");
  const no = actionBits(rule, draft, snap, "false");
  const action = [yes.join(" · "), no.length ? `else ${no.join(" · ")}` : ""].filter(Boolean).join(" · ") || "no action";
  return `${left} ${compareWord(rule.compare)} ${rule.equals || "…"}${extra} · ${when} · ${action}`;
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
                  <p className="text-xs text-muted">All If rows true runs When true. Any row failing runs When false. Value can be a literal or another variable as {"{id}"}.</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-muted">When
                    <select className={fieldClass()} value={rule.mode} onChange={(e) => update((c) => { c.triggers![ti]!.mode = e.target.value as VariableTrigger["mode"]; })}>
                      <option value="change">On change (once when the check changes)</option>
                      <option value="interval">Every interval while true, or while false</option>
                    </select>
                  </label>
                  {rule.mode === "interval" ? (
                    <label className="grid gap-1 text-sm text-muted">Interval (s)
                      <InputNum min={1} value={rule.intervalSec} onNumber={(n) => update((c) => { if (n == null) return; c.triggers![ti]!.intervalSec = Math.max(1, n); })} />
                    </label>
                  ) : <span />}
                </div>

                {(["true", "false"] as const).map((side) => {
                  const keys = side === "true"
                    ? { setVar: "setVar", setValue: "setValue", device: "device", command: "command", commandValue: "commandValue", macroId: "macroId" } as const
                    : { setVar: "falseSetVar", setValue: "falseSetValue", device: "falseDevice", command: "falseCommand", commandValue: "falseCommandValue", macroId: "falseMacroId" } as const;
                  const setVar = rule[keys.setVar] || "";
                  const deviceId = rule[keys.device] || "";
                  const commandId = rule[keys.command] || "";
                  const command = commandsFor(deviceId).find((cmd) => cmd.id === commandId);
                  return (
                    <div key={side} className={cn("grid gap-2 rounded-lg border p-3", side === "true" ? "border-emerald-900 bg-emerald-950" : "border-red-950 bg-red-950")}>
                      <p className={cn("text-sm font-medium", side === "true" ? "text-emerald-100" : "text-red-100")}>{side === "true" ? "When true" : "When false"}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-sm text-muted">Set variable
                          <SuggestField
                            className={fieldClass()}
                            value={setVar}
                            options={[{ id: "", label: "None" }, ...writeVars.map((v) => ({ id: v.id, label: v.label }))]}
                            onChange={(id) => update((c) => { c.triggers![ti]![keys.setVar] = id; })}
                          />
                        </label>
                        {setVar ? (
                          <label className="grid gap-1 text-sm text-muted">To
                            <VarTokenField
                              className={fieldClass()}
                              numericOnly={templateNumericOnly({ varKind: vars.find((v) => v.id === setVar)?.kind })}
                              suggestions={valueSuggestions({
                                varId: setVar,
                                varKind: vars.find((v) => v.id === setVar)?.kind,
                                varValues: vars.find((v) => v.id === setVar)?.values,
                              })}
                              placeholder="1  or  {occupancy}"
                              value={rule[keys.setValue] ?? ""}
                              variables={vars}
                              onChange={(value) => update((c) => { c.triggers![ti]![keys.setValue] = value; })}
                            />
                          </label>
                        ) : <span />}
                        <label className="grid gap-1 text-sm text-muted">Device
                          <SuggestField
                            className={fieldClass()}
                            value={deviceId}
                            options={[{ id: "", label: "None" }, ...draft.devices.map((d) => ({ id: d.id, label: d.name }))]}
                            onChange={(id) => update((c) => {
                              const device = c.devices.find((d) => d.id === id);
                              const all = snap.drivers[device?.driver ?? ""]?.commands ?? [];
                              const allowed = !device?.enabledFeatures.length ? all : all.filter((cmd) => device.enabledFeatures.includes(cmd.id));
                              const row = c.triggers![ti]!;
                              row[keys.device] = id;
                              row[keys.command] = id ? (allowed[0]?.id ?? "") : "";
                              row[keys.commandValue] = "";
                            })}
                          />
                        </label>
                        {deviceId ? (
                          <label className="grid gap-1 text-sm text-muted">Function
                            <SuggestField
                              className={fieldClass()}
                              value={commandId}
                              options={commandsFor(deviceId).map((cmd) => ({ id: cmd.id, label: cmd.label }))}
                              onChange={(id) => update((c) => { c.triggers![ti]![keys.command] = id; })}
                            />
                          </label>
                        ) : null}
                        {deviceId && (command?.kind === "range" || command?.kind === "enum") ? (
                          <label className="grid gap-1 text-sm text-muted sm:col-span-2">Value
                            <VarTokenField
                              className={fieldClass()}
                              numericOnly={templateNumericOnly({ commandKind: command?.kind })}
                              suggestions={valueSuggestions({
                                commandId,
                                commandKind: command?.kind,
                                commandValues: command?.values,
                                macros: macros.map((m) => ({ id: m.id, label: m.label })),
                                pages: draft.pages.map((p) => ({ id: p.id, label: p.label })),
                              })}
                              placeholder="literal or {var}"
                              value={rule[keys.commandValue] ?? ""}
                              variables={vars}
                              onChange={(value) => update((c) => { c.triggers![ti]![keys.commandValue] = value; })}
                            />
                          </label>
                        ) : null}
                        <label className="grid gap-1 text-sm text-muted sm:col-span-2">Run macro
                          <SuggestField
                            className={fieldClass()}
                            value={rule[keys.macroId] || NONE_MACRO_ID}
                            options={[{ id: NONE_MACRO_ID, label: "None" }, ...macros.map((m) => ({ id: m.id, label: m.label }))]}
                            onChange={(id) => update((c) => { c.triggers![ti]![keys.macroId] = id; })}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}

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
          mode: "change",
          intervalSec: 5,
          macroId: NONE_MACRO_ID,
          setVar: "",
          setValue: "",
          device: "",
          command: "",
          commandValue: "",
          falseMacroId: NONE_MACRO_ID,
          falseSetVar: "",
          falseSetValue: "",
          falseDevice: "",
          falseCommand: "",
          falseCommandValue: "",
          tag: currentTag(tagFilter.triggers) || null,
        });
      })}>Add trigger</Button>
    </section>
  );
}
