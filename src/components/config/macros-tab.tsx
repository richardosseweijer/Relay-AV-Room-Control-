import { ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { fireMacro } from "@/lib/control/actions";
import { GATEWAY_PROFILES, gatewaySlot, isGatewayKind } from "@/lib/control/gateway";
import type { RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { templateNumericOnly } from "@/lib/control/var-token";
import { valueSuggestions } from "@/lib/control/suggest";
import { Button } from "@/components/ui/button";
import { fieldClass, duplicateLabel } from "./config-ui";
import { InputNum } from "./config-fields";
import { InventoryPicker } from "./inventory-board";
import { TagBar, currentTag, fileItem, tagNames, tagOf, tagVisible, type TagBucket } from "./tag-bar";
import { VarTokenField } from "./var-token-field";
import { SuggestField } from "./suggest-field";

function deviceCommands(snap: RoomSnapshot, config: RoomConfig, deviceId?: string) {
  const device = config.devices.find((d) => d.id === deviceId);
  if (!device) return [];
  const driver = snap.drivers[device.driver];
  return (driver?.commands ?? []).filter((c) => !device.enabledFeatures.length || device.enabledFeatures.includes(c.id));
}

function stepNeedsValue(snap: RoomSnapshot, config: RoomConfig, step: RoomConfig["macros"][number]["steps"][number]) {
  if (step.setVar) return true;
  const command = deviceCommands(snap, config, step.device).find((c) => c.id === step.command);
  return command?.kind === "range" || command?.kind === "enum";
}

export function MacrosTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  openMacros: Record<string, boolean>;
  setOpenMacros: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  tagFilter: Record<TagBucket, string>;
  tagBarFor: (bucket: TagBucket) => ComponentProps<typeof TagBar>;
}) {
  const { draft, snap, token, update, flash, openMacros, setOpenMacros, tagFilter, tagBarFor } = props;
  return (
    <section className="grid gap-3">
            <TagBar {...tagBarFor("macros")} />
            {draft.macros.map((macro, mi) => {
              if (macro.id === NONE_MACRO_ID) return null;
              if (!tagVisible(tagFilter.macros, macro)) return null;
              const open = openMacros[macro.id] === true;
              return (
                <article
                  key={macro.id}
                  className="rounded-xl border border-border bg-surface p-4"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", `macro:${macro.id}`)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData("text/plain");
                    if (!raw.startsWith("macro:")) return;
                    e.preventDefault();
                    const fromId = raw.slice(6);
                    update((c) => {
                      const from = c.macros.findIndex((m) => m.id === fromId);
                      if (from < 0 || from === mi) return;
                      const [row] = c.macros.splice(from, 1);
                      if (row) c.macros.splice(mi, 0, row);
                    });
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="cursor-grab text-subtle">::</span>
                    <button type="button" className="flex flex-1 text-left font-medium" onClick={() => setOpenMacros((cur) => ({ ...cur, [macro.id]: !open }))}>{macro.label}</button>
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const res = await fireMacro({ data: { macroId: macro.id, token: token || "" } });
                      flash(res.ok ? macro.label : "Failed", res.message);
                    }}>Test</Button>
                  </div>
                  {open ? (
                    <div className="mt-3 grid gap-3">
                      <input className={fieldClass()} value={macro.label} onChange={(e) => update((c) => { c.macros[mi]!.label = e.target.value; })} />
                      <label className="grid gap-1 text-sm text-muted">Tag
                        <select className={fieldClass()} value={tagOf(macro)} onChange={(e) => update((c) => fileItem(c, "macros", macro.id, e.target.value))}>
                          <option value="">Untagged</option>
                          {tagNames(draft, "macros").map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm text-muted">On fail
                        <select className={fieldClass()} value={`${macro.onFail.kind}:${macro.onFail.id ?? ""}`} onChange={(e) => update((c) => {
                          const [kind, id] = e.target.value.split(":");
                          c.macros[mi]!.onFail = { kind: (kind as "none" | "macro" | "gotoPage"), id: id || undefined };
                        })}>
                          <option value="none:">Do nothing</option>
                          {draft.macros.filter((m) => m.id !== macro.id).map((m) => <option key={m.id} value={`macro:${m.id}`}>Run {m.label}</option>)}
                          {draft.pages.map((p) => <option key={p.id} value={`gotoPage:${p.id}`}>Go to {p.label}</option>)}
                        </select>
                      </label>
                      {macro.steps.map((step, si) => (
                        <div
                          key={`${macro.id}-${si}`}
                          className="grid gap-2 rounded-md bg-bg p-2 sm:grid-cols-12"
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", `step:${macro.id}:${si}`); }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const raw = e.dataTransfer.getData("text/plain");
                            const match = raw.match(/^step:([^:]+):(\d+)$/);
                            if (!match || match[1] !== macro.id) return;
                            const from = Number(match[2]);
                            update((c) => {
                              const steps = c.macros[mi]!.steps;
                              if (from === si || from < 0 || from >= steps.length) return;
                              const [row] = steps.splice(from, 1);
                              if (row) steps.splice(si, 0, row);
                            });
                          }}
                        >
                          <SuggestField
                            rootClassName="sm:col-span-3"
                            className={fieldClass()}
                            value={step.macroId ? "__macro" : step.setVar ? "__var" : step.interfaceId ? `iface:${step.interfaceId}` : (step.device ?? "")}
                            options={[
                              ...draft.devices.map((d) => ({ id: d.id, label: d.name })),
                              ...(draft.interfaces ?? []).filter((item) => isGatewayKind(item.kind)).map((item) => ({
                                id: `iface:${item.id}`,
                                label: `${item.label} / ${gatewaySlot(item.vendor, item.slot)?.label || item.slot || "slot"} (raw)`,
                              })),
                              { id: "__macro", label: "Run macro" },
                              { id: "__var", label: "Set variable" },
                            ]}
                            onChange={(id) => update((c) => {
                              const s = c.macros[mi]!.steps[si]!;
                              if (id === "__var") { s.setVar = draft.variables[0]?.id ?? ""; s.device = undefined; s.macroId = null; s.interfaceId = null; }
                              else if (id === "__macro") { s.macroId = draft.macros.find((m) => m.id !== macro.id)?.id ?? ""; s.device = undefined; s.setVar = null; s.command = undefined; s.interfaceId = null; }
                              else if (id.startsWith("iface:")) { s.interfaceId = id.slice(6); s.device = undefined; s.setVar = null; s.macroId = null; s.command = "raw"; }
                              else { s.setVar = null; s.macroId = null; s.interfaceId = null; s.device = id; s.command = deviceCommands(snap, draft, id)[0]?.id; }
                            })}
                          />
                          {step.macroId ? (
                            <SuggestField
                              rootClassName="sm:col-span-3"
                              className={fieldClass()}
                              value={step.macroId}
                              options={draft.macros.filter((m) => m.id !== macro.id && m.id !== NONE_MACRO_ID).map((m) => ({ id: m.id, label: m.label }))}
                              onChange={(id) => update((c) => { c.macros[mi]!.steps[si]!.macroId = id; })}
                            />
                          ) : step.setVar ? (
                            <SuggestField
                              rootClassName="sm:col-span-3"
                              className={fieldClass()}
                              value={step.setVar}
                              options={draft.variables.map((v) => ({ id: v.id, label: v.label }))}
                              onChange={(id) => update((c) => { c.macros[mi]!.steps[si]!.setVar = id; c.macros[mi]!.steps[si]!.command = undefined; })}
                            />
                          ) : step.interfaceId ? (
                            <span className="self-center text-xs text-muted sm:col-span-3">Raw to mapped port</span>
                          ) : (
                          <SuggestField
                            rootClassName="sm:col-span-3"
                            className={fieldClass()}
                            value={step.command ?? ""}
                            options={deviceCommands(snap, draft, step.device).map((c) => ({ id: c.id, label: c.label }))}
                            onChange={(id) => update((c) => { c.macros[mi]!.steps[si]!.command = id; })}
                          />
                          )}
                          {(() => {
                            const device = draft.devices.find((d) => d.id === step.device);
                            const drv = device ? snap.drivers[device.driver] : undefined;
                            const inventoryCmds = new Set((drv?.inventory?.resources ?? []).map((r) => r.useCommand).filter(Boolean));
                            const usesInventory = !!step.command && (inventoryCmds.has(step.command) || step.command.startsWith("var."));
                            const command = deviceCommands(snap, draft, step.device).find((c) => c.id === step.command);
                            const setVarDef = step.setVar ? draft.variables.find((v) => v.id === step.setVar) : undefined;
                            const needsValue = !!step.interfaceId || stepNeedsValue(snap, draft, step) || step.command === "ui.toast" || step.command === "ui.page" || step.command === "ui.block" || step.command === "macro.run";
                            const suggestions = step.interfaceId ? [] : valueSuggestions({
                              commandId: step.setVar ? undefined : step.command,
                              commandKind: step.setVar ? undefined : command?.kind,
                              commandValues: step.setVar ? undefined : command?.values,
                              varId: setVarDef?.id,
                              varKind: setVarDef?.kind,
                              varValues: setVarDef?.values,
                              macros: draft.macros.map((m) => ({ id: m.id, label: m.label })),
                              pages: draft.pages.map((p) => ({ id: p.id, label: p.label })),
                            });
                            return (
                              <>
                                {usesInventory && device?.inventory && drv?.inventory?.resources?.length ? (
                                  <div className="sm:col-span-12">
                                    <InventoryPicker lists={drv.inventory.resources.map((resource) => ({ id: resource.id, label: resource.label, items: device.inventory?.[resource.id] ?? [], command: resource.useCommand || "var.set" }))} command={step.command} value={String(step.value ?? "").split("=")[0]} onPick={(command, value) => update((c) => { c.macros[mi]!.steps[si]!.command = command; c.macros[mi]!.steps[si]!.value = command === "var.set" ? `${value}=` : value; })} />
                                  </div>
                                ) : null}
                                {needsValue || usesInventory ? (
                                  <label className="grid gap-1 text-xs text-muted sm:col-span-12">Value / message
                                    <VarTokenField
                                      className={fieldClass()}
                                      numericOnly={templateNumericOnly({
                                        raw: Boolean(step.interfaceId),
                                        varKind: setVarDef?.kind,
                                        commandKind: step.setVar || step.interfaceId ? undefined : command?.kind,
                                      })}
                                      suggestions={suggestions}
                                      placeholder={step.interfaceId ? "1*1]   or   power \"on\"\\r   or   hex:B06300" : "Hello room  or  tvPower=on  or  {var}"}
                                      value={String(step.value ?? "")}
                                      variables={draft.variables}
                                      onChange={(value) => update((c) => { c.macros[mi]!.steps[si]!.value = value; })}
                                    />
                                  </label>
                                ) : null}
                              </>
                            );
                          })()}
                          <label className="grid gap-1 text-xs text-muted sm:col-span-2">Wait ms
                            <InputNum min={0} step={100} value={step.delayMsAfter} onNumber={(n) => update((c) => { c.macros[mi]!.steps[si]!.delayMsAfter = n; })} />
                          </label>
                          <label className="flex items-center gap-1 text-xs text-muted sm:col-span-2">
                            <input type="checkbox" checked={step.raw === true} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.raw = e.target.checked; })} />
                            Raw
                          </label>
                          <div className="flex gap-1 sm:col-span-2">
                            <button type="button" onClick={() => update((c) => { if (si === 0) return; const steps = c.macros[mi]!.steps; const cur = steps[si]!; steps.splice(si, 1); steps.splice(si - 1, 0, cur); })}><ChevronUp className="size-4" /></button>
                            <button type="button" onClick={() => update((c) => { const steps = c.macros[mi]!.steps; if (si >= steps.length - 1) return; const cur = steps[si]!; steps.splice(si, 1); steps.splice(si + 1, 0, cur); })}><ChevronDown className="size-4" /></button>
                            <Button size="sm" variant="ghost" onClick={() => update((c) => { c.macros[mi]!.steps.splice(si, 1); })}>Delete</Button>
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => update((c) => { c.macros[mi]!.steps.push({ device: draft.devices[0]?.id, command: "power.on", delayMsAfter: 0 }); })}>Add step</Button>
                        <Button size="sm" variant="secondary" onClick={() => {
                          const id = `macro-${Date.now().toString(36)}`;
                          update((c) => {
                            const at = c.macros.findIndex((m) => m.id === macro.id);
                            const source = c.macros[at];
                            if (!source || source.id === NONE_MACRO_ID) return;
                            const copy = structuredClone(source);
                            copy.id = id;
                            copy.label = duplicateLabel(c.macros.map((m) => m.label), source.label);
                            c.macros.splice(at + 1, 0, copy);
                          });
                          setOpenMacros((cur) => ({ ...cur, [id]: true }));
                        }}>Duplicate</Button>
                        <Button size="sm" variant="danger" onClick={() => update((c) => { c.macros = c.macros.filter((m) => m.id !== macro.id); })}>Delete macro</Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => { c.macros.push({ id: `macro-${Date.now().toString(36)}`, label: "New macro", retries: 0, onFail: { kind: "none" }, steps: [], tag: currentTag(tagFilter.macros) || null }); })}>Add macro</Button>
          </section>
  );
}
