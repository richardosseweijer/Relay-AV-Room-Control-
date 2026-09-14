import { type ComponentProps } from "react";
import { monitorVarId, variableInUse, withMonitorVars } from "@/lib/control/vars";
import { gatewaySlot, isGatewayKind } from "@/lib/control/gateway";
import type { RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { TagBar, currentTag, fileItem, tagNames, tagOf, tagVisible, type TagBucket } from "./tag-bar";
import { TriggersSection } from "./trigger-pane";

export function LogicTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  openLogic: Record<string, boolean>;
  setOpenLogic: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  tagFilter: Record<TagBucket, string>;
  tagBarFor: (bucket: TagBucket) => ComponentProps<typeof TagBar>;
  logicTab: "variables" | "monitor" | "schedule" | "triggers";
  setLogicTab: (id: "variables" | "monitor" | "schedule" | "triggers") => void;
}) {
  const { draft, snap, update, flash, openLogic, setOpenLogic, tagFilter, tagBarFor, logicTab, setLogicTab } = props;
  return (
    <div>
            <div className="mb-4 flex flex-wrap gap-1">
              {(["variables", "monitor", "schedule", "triggers"] as const).map((id) => (
                <button key={id} type="button" className={cn("h-10 rounded-md px-3 text-sm capitalize", logicTab === id ? "bg-raised text-fg" : "text-muted")} onClick={() => setLogicTab(id)}>{id}</button>
              ))}
            </div>
            {logicTab === "variables" ? (
              <section className="grid gap-4">
                <TagBar {...tagBarFor("variables")} />
                {(draft.variables ?? []).map((variable, vi) => {
                  if (!tagVisible(tagFilter.variables, variable)) return null;
                  const open = openLogic[variable.id] === true;
                  return (
                  <article
                    key={variable.id}
                    className="rounded-xl border border-border bg-surface p-4"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", `var:${variable.id}`)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const raw = e.dataTransfer.getData("text/plain");
                      if (!raw.startsWith("var:")) return;
                      e.preventDefault();
                      const fromId = raw.slice(4);
                      update((c) => {
                        const from = c.variables.findIndex((v) => v.id === fromId);
                        if (from < 0 || from === vi) return;
                        const [row] = c.variables.splice(from, 1);
                        if (row) c.variables.splice(vi, 0, row);
                      });
                    }}
                  >
                    <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [variable.id]: !open }))}>
                      <span className="font-medium">{variable.label}</span>
                      <span className="font-mono text-xs text-muted">{String(snap.vars[variable.id] ?? variable.default)}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input className={fieldClass()} value={variable.label} onChange={(e) => update((c) => { c.variables[vi]!.label = e.target.value; })} />
                    <label className="grid gap-1 text-sm text-muted">Tag
                      <select className={fieldClass()} value={tagOf(variable)} onChange={(e) => update((c) => fileItem(c, "variables", variable.id, e.target.value))}>
                        <option value="">Untagged</option>
                        {tagNames(draft, "variables").map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <select className={fieldClass()} value={variable.kind} disabled={variable.id === "occupancy" || variable.id.startsWith("foyer.")} onChange={(e) => update((c) => { c.variables[vi]!.kind = e.target.value as "number" | "enum" | "text"; })}>
                      <option value="number">Number</option>
                      <option value="enum">List</option>
                      <option value="text">Text</option>
                    </select>
                    <label className="grid gap-1 text-sm text-muted">Default
                      <input className={fieldClass()} value={String(variable.default ?? "")} disabled={variable.id === "occupancy" || variable.id.startsWith("foyer.")} onChange={(e) => update((c) => {
                        const raw = e.target.value;
                        c.variables[vi]!.default = variable.kind === "number"
                          ? (raw.trim() === "" ? "" : Number(raw))
                          : raw;
                      })} />
                    </label>
                    {variable.kind === "number" ? (
                      <>
                        <label className="grid gap-1 text-sm text-muted">Min
                          <InputNum value={variable.min} onNumber={(n) => update((c) => { c.variables[vi]!.min = n; })} />
                        </label>
                        <label className="grid gap-1 text-sm text-muted">Max
                          <InputNum value={variable.max} onNumber={(n) => update((c) => { c.variables[vi]!.max = n; })} />
                        </label>
                      </>
                    ) : null}
                    <label className="grid gap-1 text-sm text-muted">Push to device
                      <select className={fieldClass()} value={variable.pushDevice ?? ""} onChange={(e) => update((c) => { c.variables[vi]!.pushDevice = e.target.value || null; })}>
                        <option value="">Don’t push</option>
                        {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    {variable.pushDevice ? (
                      <label className="grid gap-1 text-sm text-muted">Push command
                        <select className={fieldClass()} value={variable.pushCommand ?? ""} onChange={(e) => update((c) => { c.variables[vi]!.pushCommand = e.target.value || null; })}>
                          <option value="">Select</option>
                          {(snap.drivers[draft.devices.find((d) => d.id === variable.pushDevice)?.driver ?? ""]?.commands ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {variable.kind === "enum" && variable.id === "occupancy" ? (
                      <p className="sm:col-span-2 text-xs text-muted">0 closed · 1 open · 2 in session · 3 do not disturb. Foyer Auto reads this. Set with a macro or a Relay Occupancy command.</p>
                    ) : null}
                    {variable.id.startsWith("foyer.") ? (
                      <p className="sm:col-span-2 text-xs text-muted">Filled from Foyer on this PC: current calendar session, or the next one if the room is free.</p>
                    ) : null}
                    <Button size="sm" variant="danger" onClick={() => {
                      if (variable.id === "occupancy") { flash("Built-in", "Occupancy is baked in. Set it with a macro or a Relay Occupancy command."); return; }
                      if (variable.id.startsWith("foyer.")) { flash("Built-in", "Foyer session vars come from the calendar on this PC."); return; }
                      if (variable.id.startsWith("MON_")) { flash("Monitor variable", "Rename or delete the monitor instead."); return; }
                      if (variableInUse(draft, variable.id).length) { flash("In use", ""); return; }
                      update((c) => { c.variables = c.variables.filter((v) => v.id !== variable.id); });
                    }}>Delete</Button>
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                <Button variant="secondary" onClick={() => update((c) => { c.variables.push({ id: `var-${Date.now().toString(36)}`, label: "New variable", kind: "text", default: "", tag: currentTag(tagFilter.variables) || null }); })}>Add variable</Button>
              </section>
            ) : logicTab === "monitor" ? (
              <section className="grid gap-4">
                <TagBar {...tagBarFor("monitors")} />
                {(draft.monitors ?? []).map((rule, ri) => {
                  if (!tagVisible(tagFilter.monitors, rule)) return null;
                  const driver = snap.drivers[draft.devices.find((d) => d.id === rule.device)?.driver ?? ""];
                  const open = openLogic[rule.id] === true;
                  const st = snap.monitorStatus?.[rule.id];
                  const pollLine = st
                    ? `${new Date(st.at).toLocaleTimeString()} · ${st.ok ? "ok" : "error"} · ${st.value || st.message || "—"}`
                    : "No poll yet";
                  return (
                  <article
                    key={rule.id}
                    className="rounded-xl border border-border bg-surface p-4"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", `mon:${rule.id}`)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const raw = e.dataTransfer.getData("text/plain");
                      if (!raw.startsWith("mon:")) return;
                      e.preventDefault();
                      const fromId = raw.slice(4);
                      update((c) => {
                        const from = c.monitors.findIndex((m) => m.id === fromId);
                        if (from < 0 || from === ri) return;
                        const [row] = c.monitors.splice(from, 1);
                        if (row) c.monitors.splice(ri, 0, row);
                      });
                    }}
                  >
                    <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => {
                      setOpenLogic((cur) => ({ ...cur, [rule.id]: !open }));
                      if (!rule.interfaceId && driver?.feedback?.length && !driver.feedback.some((fb) => fb.id === rule.feedback)) {
                        update((c) => { c.monitors[ri]!.feedback = driver.feedback[0]!.id; });
                      }
                    }}>
                      <span className="font-medium">{rule.label}</span>
                      <span className="min-w-0 truncate text-xs text-muted">{pollLine}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={rule.label} onChange={(e) => update((c) => { c.monitors[ri]!.label = e.target.value; c.variables = withMonitorVars(c).variables; })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Tag
                      <select className={fieldClass()} value={tagOf(rule)} onChange={(e) => update((c) => fileItem(c, "monitors", rule.id, e.target.value))}>
                        <option value="">Untagged</option>
                        {tagNames(draft, "monitors").map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted pt-6">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => update((c) => { c.monitors[ri]!.enabled = e.target.checked; })} />
                      Enabled
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Device
                      <select className={fieldClass()} value={rule.interfaceId ? `iface:${rule.interfaceId}` : rule.device} onChange={(e) => update((c) => {
                        if (e.target.value.startsWith("iface:")) {
                          c.monitors[ri]!.interfaceId = e.target.value.slice(6);
                          c.monitors[ri]!.device = "";
                          c.monitors[ri]!.feedback = "raw";
                        } else {
                          c.monitors[ri]!.interfaceId = null;
                          c.monitors[ri]!.device = e.target.value;
                          const nextDriver = snap.drivers[c.devices.find((d) => d.id === e.target.value)?.driver ?? ""];
                          c.monitors[ri]!.feedback = nextDriver?.feedback?.[0]?.id ?? "";
                        }
                      })}>
                        {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        {(draft.interfaces ?? []).filter((item) => isGatewayKind(item.kind)).map((item) => (
                          <option key={item.id} value={`iface:${item.id}`}>{item.label} / {gatewaySlot(item.vendor, item.slot)?.label || item.slot || "slot"}</option>
                        ))}
                      </select>
                    </label>
                    {rule.interfaceId ? (
                      <>
                        <label className="grid gap-1 text-sm text-muted">Query
                          <input className={fieldClass()} value={rule.query ?? ""} placeholder={'power_status ?\\r   or   1]'} onChange={(e) => update((c) => { c.monitors[ri]!.query = e.target.value; })} />
                        </label>
                        <label className="grid gap-1 text-sm text-muted sm:col-span-2">Parse regex
                          <input className={fieldClass()} value={rule.parsePattern ?? ""} placeholder={'optional, e.g. "([^"]+)"'} onChange={(e) => update((c) => { c.monitors[ri]!.parsePattern = e.target.value; })} />
                        </label>
                      </>
                    ) : (
                    <label className="grid gap-1 text-sm text-muted">Feedback
                      <select className={fieldClass()} value={driver?.feedback.some((fb) => fb.id === rule.feedback) ? rule.feedback : (driver?.feedback[0]?.id ?? "")} onChange={(e) => update((c) => { c.monitors[ri]!.feedback = e.target.value; })}>
                        {(driver?.feedback ?? []).map((fb) => <option key={fb.id} value={fb.id}>{fb.label}</option>)}
                      </select>
                    </label>
                    )}
                    <label className="grid gap-1 text-sm text-muted">Poll ms<InputNum min={500} value={rule.pollMs} onNumber={(n) => update((c) => { if (n == null) return; c.monitors[ri]!.pollMs = Math.max(500, n); })} /></label>
                    <p className="text-sm text-muted sm:col-span-2">Auto variable <span className="font-mono text-fg">{`{${monitorVarId(rule)}}`}</span> · {String(snap.vars[monitorVarId(rule)] ?? "")}</p>
                    <label className="grid gap-1 text-sm text-muted">Also write to
                      <select className={fieldClass()} value={rule.writeVar ?? ""} onChange={(e) => update((c) => { c.monitors[ri]!.writeVar = e.target.value || null; })}>
                        <option value="">Only auto</option>
                        {draft.variables.filter((v) => !v.id.startsWith("MON_")).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.errorValue)}
                        onChange={(e) => update((c) => {
                          c.monitors[ri]!.errorValue = e.target.checked ? (c.monitors[ri]!.errorValue || "off") : "";
                          if (!e.target.checked) c.monitors[ri]!.errorVar = null;
                        })}
                      />
                      Write a value on error
                    </label>
                    {rule.errorValue ? (
                      <>
                        <label className="grid gap-1 text-sm text-muted">On error write
                          <select className={fieldClass()} value={rule.errorVar ?? ""} onChange={(e) => update((c) => { c.monitors[ri]!.errorVar = e.target.value || null; })}>
                            <option value="">Same variable</option>
                            {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-muted">Error value
                          <input className={fieldClass()} placeholder="off" value={rule.errorValue ?? ""} onChange={(e) => update((c) => { c.monitors[ri]!.errorValue = e.target.value; })} />
                        </label>
                      </>
                    ) : null}
                    <p className="sm:col-span-2 text-xs text-muted">{pollLine}</p>
                    <Button size="sm" variant="danger" onClick={() => update((c) => { c.monitors = c.monitors.filter((m) => m.id !== rule.id); c.variables = withMonitorVars(c).variables; })}>Delete</Button>
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                <Button variant="secondary" onClick={() => update((c) => {
                  const deviceId = c.devices[0]?.id ?? "";
                  const firstFb = snap.drivers[c.devices[0]?.driver ?? ""]?.feedback?.[0]?.id ?? "power.state";
                  c.monitors.push({ id: `mon-${Date.now().toString(36)}`, label: "New monitor", enabled: true, device: deviceId, feedback: firstFb, pollMs: 4000, writeVar: null, mapMode: "raw", map: [], tag: currentTag(tagFilter.monitors) || null });
                  c.variables = withMonitorVars(c).variables;
                })}>Add monitor</Button>
              </section>
            ) : null}
            {logicTab === "schedule" ? (
              <section className="grid gap-4">
                <TagBar {...tagBarFor("schedules")} />
                {(draft.schedules ?? []).map((job, ji) => {
                  if (!tagVisible(tagFilter.schedules, job)) return null;
                  const open = openLogic[job.id] === true;
                  return (
                  <article
                    key={job.id}
                    className="rounded-xl border border-border bg-surface p-4"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", `sch:${job.id}`)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const raw = e.dataTransfer.getData("text/plain");
                      if (!raw.startsWith("sch:")) return;
                      e.preventDefault();
                      const fromId = raw.slice(4);
                      update((c) => {
                        const from = c.schedules.findIndex((s) => s.id === fromId);
                        if (from < 0 || from === ji) return;
                        const [row] = c.schedules.splice(from, 1);
                        if (row) c.schedules.splice(ji, 0, row);
                      });
                    }}
                  >
                    <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [job.id]: !open }))}>
                      <span className="font-medium">{job.label}</span>
                      <span className="text-xs text-muted">{job.time} {job.enabled ? "On" : "Off"}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={job.label} onChange={(e) => update((c) => { c.schedules[ji]!.label = e.target.value; })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Tag
                      <select className={fieldClass()} value={tagOf(job)} onChange={(e) => update((c) => fileItem(c, "schedules", job.id, e.target.value))}>
                        <option value="">Untagged</option>
                        {tagNames(draft, "schedules").map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Time<input className={fieldClass()} type="time" value={job.time} onChange={(e) => update((c) => { c.schedules[ji]!.time = e.target.value; })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Macro
                    <select className={fieldClass()} value={job.macroId} onChange={(e) => update((c) => { c.schedules[ji]!.macroId = e.target.value; })}>
                      {draft.macros.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input type="checkbox" checked={job.enabled} onChange={(e) => update((c) => { c.schedules[ji]!.enabled = e.target.checked; })} />
                      Enabled
                    </label>
                    <div className="sm:col-span-2 flex flex-wrap gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => {
                        const on = job.days.includes(day);
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => update((c) => {
                              const days = c.schedules[ji]!.days;
                              c.schedules[ji]!.days = on ? days.filter((d) => d !== day) : [...days, day].sort();
                            })}
                            className={cn("h-9 rounded-md px-2 text-xs border", on ? "border-accent bg-raised text-fg" : "border-border text-subtle")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <Button size="sm" variant="danger" onClick={() => update((c) => { c.schedules = c.schedules.filter((s) => s.id !== job.id); })}>Delete</Button>
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                <Button variant="secondary" onClick={() => update((c) => { c.schedules.push({ id: `sch-${Date.now().toString(36)}`, label: "New schedule", enabled: false, time: "08:00", days: [1, 2, 3, 4, 5], macroId: c.macros[0]?.id ?? "", tag: currentTag(tagFilter.schedules) || null }); })}>Add schedule</Button>
              </section>
            ) : null}
            {logicTab === "triggers" ? (
              <TriggersSection draft={draft} update={update} openLogic={openLogic} setOpenLogic={setOpenLogic} tagFilter={tagFilter} tagBarFor={tagBarFor} />
            ) : null}
          </div>
  );
}
