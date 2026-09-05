import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import {
  authenticate,
  clearConfig,
  clearDeviceError,
  deleteDriver,
  exportBundle,
  getEditorConfig,
  getRoomState,
  resetDemo,
  saveConfig,
  saveDriver,
  pingDevice,
  verifyConfigPin,
} from "@/lib/control/actions";
import type { DriverSpec, RoomConfig, RoomSnapshot, Widget, WidgetColor } from "@/lib/control/types";
import { deviceInUse, driverInUse, variableInUse } from "@/lib/control/vars";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLORS: WidgetColor[] = ["steel", "sage", "clay", "fog", "ink", "ocean", "pine", "rust", "sand", "slate", "rose"];
const COLOR_FILL: Record<WidgetColor, string> = {
  steel: "#8d97a8",
  sage: "#7f8f7a",
  clay: "#b07064",
  fog: "#6e7380",
  ink: "#3a3a40",
  ocean: "#3d6f8f",
  pine: "#3f6b55",
  rust: "#a65b3a",
  sand: "#b39a6d",
  slate: "#5c6570",
  rose: "#a45b63",
};

function fieldClass() {
  return "h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg";
}

function deviceCommands(snap: RoomSnapshot, config: RoomConfig, deviceId?: string) {
  const device = config.devices.find((d) => d.id === deviceId);
  if (!device) return [];
  const driver = snap.drivers[device.driver];
  return (driver?.commands ?? []).filter((c) => device.enabledFeatures.includes(c.id));
}

function stepNeedsValue(snap: RoomSnapshot, config: RoomConfig, step: RoomConfig["macros"][number]["steps"][number]) {
  if (step.setVar) return true;
  const command = deviceCommands(snap, config, step.device).find((c) => c.id === step.command);
  return command?.kind === "range";
}

const TIMEZONES = [
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function ConfigApp() {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [draft, setDraft] = useState<RoomConfig | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<"room" | "devices" | "pages" | "macros" | "variables" | "monitor" | "schedule" | "drivers">("room");
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [openMacros, setOpenMacros] = useState<Record<string, boolean>>({});
  const [pageId, setPageId] = useState("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState("");
  const [driverText, setDriverText] = useState("");
  const [driverOpen, setDriverOpen] = useState<Record<string, boolean>>({});
  const [gate, setGate] = useState<{ action: "save" | "wipe"; pin: string } | null>(null);
  const [reach, setReach] = useState<Record<string, "sim" | "up" | "down" | "wait">>({});

  async function refresh() {
    const next = await getRoomState();
    setSnap(next);
    setDraft((cur) => cur ?? structuredClone(next.config));
    if (!driverName && Object.keys(next.drivers)[0]) {
      const first = Object.keys(next.drivers)[0]!;
      setDriverName(first);
      setDriverText(JSON.stringify(next.drivers[first], null, 2));
    }
    return next;
  }

  useEffect(() => {
    sessionStorage.removeItem("relay-config-token");
    refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => {
      getRoomState().then(setSnap).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [token]);

  useEffect(() => {
    if (tab !== "devices" || !token || !draft) return;
    let cancel = false;
    const delay = window.setTimeout(() => {
      async function tick() {
        if (!draft) return;
        await Promise.all(draft.devices.map(async (device) => {
          if (cancel) return;
          if (device.simulate) {
            setReach((cur) => ({ ...cur, [device.id]: "sim" }));
            return;
          }
          if (!device.host.trim()) {
            setReach((cur) => ({ ...cur, [device.id]: "down" }));
            return;
          }
          const driver = snap?.drivers[device.driver];
          const res = await pingDevice({
            data: {
              token: token!,
              host: device.host,
              port: device.port ?? driver?.transports.lan?.port,
              path: driver?.auth?.pairing?.discoverPath || "/",
            },
          });
          if (!cancel) setReach((cur) => ({ ...cur, [device.id]: res.ok ? "up" : "down" }));
        }));
      }
      tick().catch(() => undefined);
    }, 600);
    const id = window.setInterval(() => {
      if (!draft) return;
      Promise.all(draft.devices.map(async (device) => {
        if (cancel) return;
        if (device.simulate) {
          setReach((cur) => ({ ...cur, [device.id]: "sim" }));
          return;
        }
        if (!device.host.trim()) return;
        const driver = snap?.drivers[device.driver];
        const res = await pingDevice({
          data: {
            token: token!,
            host: device.host,
            port: device.port ?? driver?.transports.lan?.port,
            path: driver?.auth?.pairing?.discoverPath || "/",
          },
        });
        if (!cancel) setReach((cur) => ({ ...cur, [device.id]: res.ok ? "up" : "down" }));
      })).catch(() => undefined);
    }, 4000);
    return () => {
      cancel = true;
      window.clearTimeout(delay);
      window.clearInterval(id);
    };
  }, [tab, token, draft?.devices.map((d) => `${d.id}:${d.host}:${d.port}:${d.simulate}:${d.driver}`).join("|")]);

  function flash(title: string, body: string) {
    setToast({ title, body });
  }

  const page = draft?.pages.find((p) => p.id === pageId) ?? draft?.pages[0];
  const selected = page?.widgets.find((w) => w.id === selectedId) ?? null;

  function update(mut: (cfg: RoomConfig) => void) {
    if (!draft) return;
    const next = structuredClone(draft);
    mut(next);
    setDraft(next);
  }

  async function persist() {
    setGate({ action: "save", pin: "" });
  }

  async function runGated() {
    if (!draft || !token || !gate) return;
    if (gate.action === "wipe") {
      const check = await verifyConfigPin({ data: { pin: gate.pin } });
      if (!check.ok || !check.token) {
        flash("Wrong PIN", "That PIN does not match this host.");
        return;
      }
      setToken(check.token);
      const res = await clearConfig({ data: { token: check.token, pin: gate.pin } });
      setGate(null);
      if (!res.ok) {
        flash("Wipe failed", res.message);
        return;
      }
      flash("Cleared", "This host is an empty room. Save is already applied.");
      setDraft(structuredClone((await getEditorConfig({ data: { token: check.token } })).config ?? draft));
      return;
    }
    const res = await saveConfig({ data: { token, pin: gate.pin, config: draft } }) as { ok: boolean; message?: string };
    setGate(null);
    if (res.ok) flash("Saved", "All config tabs were written to this host.");
    else if (res.message === "PIN did not match") flash("Wrong PIN", "That PIN does not match this host.");
    else flash("Save failed", res.message ?? "Unknown error");
  }

  if (!snap) {
    return <main className="flex min-h-dvh items-center justify-center bg-bg text-muted">Loading config…</main>;
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Relay setup</p>
        <h1 className="text-3xl font-medium tracking-tight">Configurator</h1>
        <p className="text-sm text-muted">Enter the configurator PIN.</p>
        <input className={fieldClass()} inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
        <Button
          onClick={async () => {
            const res = await verifyConfigPin({ data: { pin } });
            if (res.ok && res.token) {
              setToken(res.token);
              const editor = await getEditorConfig({ data: { token: res.token } });
              if (editor.ok && editor.config) setDraft(structuredClone(editor.config));
            } else flash("Wrong PIN", "The configurator PIN did not match.");
          }}
        >
          Unlock
        </Button>
        {toast ? <p className="text-sm text-clay">{toast.body}</p> : null}
      </main>
    );
  }

  if (!draft || !page) return null;

  return (
    <main className="min-h-dvh bg-bg pb-16">
      {toast ? (
        <div className="fixed right-4 top-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-raised p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-fg">{toast.title}</p>
            <button type="button" className="text-xs text-muted" onClick={() => setToast(null)}>Dismiss</button>
          </div>
          <p className="mt-1 text-sm text-muted">{toast.body}</p>
        </div>
      ) : null}
      {gate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5">
            <p className="text-lg font-medium">{gate.action === "wipe" ? "Clear this host?" : "Confirm Save all"}</p>
            <p className="mt-2 text-sm text-muted">
              {gate.action === "wipe"
                ? "This removes devices, pages, macros, variables, and schedules. Enter the configurator PIN."
                : "Enter the configurator PIN to write every tab to this host."}
            </p>
            <input className={`${fieldClass()} mt-4`} inputMode="numeric" value={gate.pin} onChange={(e) => setGate({ ...gate, pin: e.target.value })} placeholder="PIN" />
            <div className="mt-4 flex gap-2">
              <Button onClick={runGated}>{gate.action === "wipe" ? "Wipe room" : "Save"}</Button>
              <Button variant="secondary" onClick={() => setGate(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Configurator</p>
              <h1 className="text-lg font-medium">{draft.room.name}</h1>
            </div>
          </div>
          <Button variant="secondary" onClick={persist}>Save all</Button>
        </div>
        <nav className="mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto">
          {(["room", "devices", "pages", "macros", "variables", "monitor", "schedule", "drivers"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("h-10 rounded-md px-3 text-sm capitalize", tab === id ? "bg-accent text-accent-fg" : "text-muted")}
            >
              {id}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {tab === "room" ? (
          <section className="grid gap-4 sm:grid-cols-2">
            <p className="sm:col-span-2 text-sm text-muted">Save all writes every tab — room, devices, pages, macros, variables, schedule, and drivers.</p>
            <label className="grid gap-1 text-sm text-muted">
              Room name
              <input className={fieldClass()} value={draft.room.name} onChange={(e) => update((c) => { c.room.name = e.target.value; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Room id
              <input className={fieldClass()} value={draft.room.id} onChange={(e) => update((c) => { c.room.id = e.target.value; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Config PIN
              <input className={fieldClass()} type="password" autoComplete="off" value={draft.room.configPin} onChange={(e) => update((c) => { c.room.configPin = e.target.value; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Panel access
              <select className={fieldClass()} value={draft.room.panelAccess} onChange={(e) => update((c) => { c.room.panelAccess = e.target.value as "open" | "pin"; })}>
                <option value="open">Open on LAN</option>
                <option value="pin">Panel PIN</option>
              </select>
            </label>
            {draft.room.panelAccess === "pin" ? (
              <label className="grid gap-1 text-sm text-muted">
                Panel PIN
                <input className={fieldClass()} type="password" autoComplete="off" value={draft.room.panelPin ?? ""} onChange={(e) => update((c) => { c.room.panelPin = e.target.value; })} />
              </label>
            ) : null}
            <label className="grid gap-1 text-sm text-muted">
              Idle dim (seconds)
              <input type="number" className={fieldClass()} value={draft.room.idleDimSeconds} onChange={(e) => update((c) => { c.room.idleDimSeconds = Number(e.target.value); })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Default grid columns
              <input type="number" min={2} max={12} className={fieldClass()} value={draft.room.grid?.cols ?? 6} onChange={(e) => update((c) => { c.room.grid = { ...(c.room.grid ?? { cols: 6, rows: 8 }), cols: Number(e.target.value) }; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Default grid rows
              <input type="number" min={2} max={16} className={fieldClass()} value={draft.room.grid?.rows ?? 8} onChange={(e) => update((c) => { c.room.grid = { ...(c.room.grid ?? { cols: 6, rows: 8 }), rows: Number(e.target.value) }; })} />
            </label>
            <p className="sm:col-span-2 pt-2 text-xs uppercase tracking-[0.16em] text-subtle">Host network (applied when this host boots)</p>
            <label className="grid gap-1 text-sm text-muted">
              Addressing
              <select className={fieldClass()} value={draft.room.network?.mode ?? "dhcp"} onChange={(e) => update((c) => { c.room.network.mode = e.target.value as "dhcp" | "static"; })}>
                <option value="dhcp">DHCP</option>
                <option value="static">Fixed IP</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Hostname
              <input className={fieldClass()} value={draft.room.network?.hostname ?? ""} onChange={(e) => update((c) => { c.room.network.hostname = e.target.value; })} />
            </label>
            {draft.room.network?.mode === "static" ? (
              <>
                <label className="grid gap-1 text-sm text-muted">
                  Address
                  <input className={fieldClass()} value={draft.room.network.address} onChange={(e) => update((c) => { c.room.network.address = e.target.value; })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Prefix / subnet
                  <input className={fieldClass()} type="number" value={draft.room.network.prefix} onChange={(e) => update((c) => { c.room.network.prefix = Number(e.target.value); })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Gateway
                  <input className={fieldClass()} value={draft.room.network.gateway} onChange={(e) => update((c) => { c.room.network.gateway = e.target.value; })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  DNS
                  <input className={fieldClass()} value={draft.room.network.dns} onChange={(e) => update((c) => { c.room.network.dns = e.target.value; })} />
                </label>
              </>
            ) : null}
            <label className="grid gap-1 text-sm text-muted">
              Time server (NTP)
              <input className={fieldClass()} value={draft.room.network?.ntp ?? ""} onChange={(e) => update((c) => { c.room.network.ntp = e.target.value; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Time zone
              <select className={fieldClass()} value={draft.room.network?.timezone ?? "Europe/Brussels"} onChange={(e) => update((c) => { c.room.network.timezone = e.target.value; })}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  const bundle = await exportBundle();
                  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${draft.room.id}-relay.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export
              </Button>
              <label className="inline-flex h-11 items-center rounded-md border border-border bg-surface px-4 text-sm">
                Import
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const parsed = JSON.parse(await file.text()) as { config?: RoomConfig; drivers?: Record<string, DriverSpec> };
                    if (parsed.config) setDraft(parsed.config);
                    if (parsed.drivers && token) {
                      for (const [name, spec] of Object.entries(parsed.drivers)) {
                        await saveDriver({ data: { token, filename: name, spec } });
                      }
                    }
                    flash("Imported", "Review the tabs, then press Save all.");
                  }}
                />
              </label>
              <Button
                variant="secondary"
                onClick={async () => {
                  const res = await resetDemo({ data: { token } });
                  flash(res.ok ? "Demo restored" : "Restore failed", res.message);
                  const next = await refresh();
                  setDraft(structuredClone(next.config));
                }}
              >
                Restore demo
              </Button>
              <Button variant="danger" onClick={() => setGate({ action: "wipe", pin: "" })}>
                Clear config
              </Button>
            </div>
          </section>
        ) : null}

        {tab === "devices" ? (
          <section className="grid gap-4">
            {draft.devices.map((device, index) => {
              const driver = snap?.drivers[device.driver];
              const features = [...(driver?.commands.map((c) => c.id) ?? []), ...(driver?.feedback.map((f) => f.id) ?? [])];
              return (
                <article key={device.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2.5 rounded-full",
                        device.simulate || reach[device.id] === "sim" ? "bg-sand" : reach[device.id] === "up" ? "bg-pine" : reach[device.id] === "down" ? "bg-clay" : "bg-fog",
                      )}
                      title={device.simulate ? "Simulation" : reach[device.id] === "up" ? "Reachable" : reach[device.id] === "down" ? "Unreachable" : "Checking"}
                    />
                    <p className="text-sm text-muted">
                      {device.simulate ? "Simulation — not a live check" : reach[device.id] === "up" ? "Reachable" : reach[device.id] === "down" ? "Unreachable" : "Checking…"}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-muted">
                      Name
                      <input className={fieldClass()} value={device.name} onChange={(e) => update((c) => { c.devices[index]!.name = e.target.value; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">
                      Host
                      <input className={fieldClass()} value={device.host} onChange={(e) => update((c) => { c.devices[index]!.host = e.target.value; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">
                      Port
                      <input className={fieldClass()} type="number" value={device.port ?? snap.drivers[device.driver]?.transports.lan?.port ?? 8001} onChange={(e) => update((c) => { c.devices[index]!.port = Number(e.target.value); })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">
                      Driver
                      <select className={fieldClass()} value={device.driver} onChange={(e) => update((c) => { c.devices[index]!.driver = e.target.value; })}>
                        {Object.keys(snap.drivers).map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted pt-6">
                      <input type="checkbox" checked={device.simulate} onChange={(e) => update((c) => { c.devices[index]!.simulate = e.target.checked; })} />
                      Simulate (demo / no hardware)
                    </label>
                    {(driver?.auth?.instanceFields ?? []).map((field) => (
                      <label key={field} className="grid gap-1 text-sm text-muted">
                        {field === "token" ? "Pairing token" : field}
                        <input
                          className={fieldClass()}
                          value={device.auth?.[field] ?? ""}
                          onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, [field]: e.target.value }; })}
                          placeholder={field === "name" ? "Relay" : "from handshake"}
                        />
                      </label>
                    ))}
                    {device.auth?.paired === "yes" ? (
                      <p className="sm:col-span-2 text-xs text-sage">Authenticated{device.auth.token ? " — token stored" : " — no token from this set"}</p>
                    ) : null}
                    {snap.health?.[device.id] && !snap.health[device.id]!.ok ? (
                      <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-md border border-clay/40 bg-clay/10 px-3 py-2 text-sm">
                        <span className="text-clay">Device error: {snap.health[device.id]!.message}</span>
                        <Button size="sm" variant="secondary" onClick={async () => {
                          await clearDeviceError({ data: { deviceId: device.id } });
                          await refresh();
                          flash("Error cleared", `${device.name} can be called again.`);
                        }}>Clear error</Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {features.map((id) => {
                      const on = device.enabledFeatures.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() =>
                            update((c) => {
                              const d = c.devices[index]!;
                              d.enabledFeatures = on ? d.enabledFeatures.filter((x) => x !== id) : [...d.enabledFeatures, id];
                            })
                          }
                          className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-raised text-fg" : "border-border text-subtle")}
                        >
                          {id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const res = await pingDevice({
                          data: {
                            token,
                            host: device.host,
                            port: device.port ?? driver?.transports.lan?.port,
                            path: driver?.auth?.pairing?.discoverPath || "/",
                          },
                        });
                        flash(res.ok ? `${device.name} is on the network` : `${device.name} did not answer`, res.message);
                      }}
                    >
                      Probe
                    </Button>
                    {driver?.auth?.pairing ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          flash("Authenticate", driver.auth?.pairing?.userPrompt || "Accept Allow on the device now.");
                          const res = await authenticate({ data: { token, deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth } });
                          if (res.pairedToken || res.pairedPort || res.ok) {
                            update((c) => {
                              const row = c.devices[index];
                              if (!row) return;
                              if (res.pairedToken) row.auth = { ...row.auth, token: res.pairedToken };
                              if (res.pairedPort) row.port = res.pairedPort;
                              row.auth = { ...row.auth, paired: "yes" };
                            });
                          }
                          flash(res.pairedToken ? `${device.name} token stored` : res.ok ? `${device.name} authenticated` : `${device.name} authenticate failed`, res.message);
                        }}
                      >
                        Authenticate
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        const used = deviceInUse(draft, device.id);
                        if (used.length) {
                          flash("Device still in use", `${device.name} is linked from: ${used.join(", ")}. Remove those links first.`);
                          return;
                        }
                        update((c) => { c.devices = c.devices.filter((d) => d.id !== device.id); });
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              );
            })}
            <Button
              variant="secondary"
              onClick={() =>
                update((c) => {
                  const first = Object.keys(snap.drivers)[0] ?? "lg-oled55c3.json";
                  c.devices.push({
                    id: `dev-${Date.now().toString(36)}`,
                    name: "New device",
                    driver: first,
                    transport: "lan",
                    host: "10.0.10.50",
                    auth: {},
                    enabledFeatures: [],
                    simulate: true,
                  });
                })
              }
            >
              Add device
            </Button>
          </section>
        ) : null}

        {tab === "pages" ? (
          <PagesEditor
            draft={draft}
            snap={snap}
            page={page}
            selected={selected}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            setPageId={setPageId}
            update={update}
            colors={COLORS}
          />
        ) : null}

        {tab === "macros" ? (
          <section className="grid gap-3">
            {draft.macros.map((macro, mi) => {
              const open = openMacros[macro.id] === true;
              return (
                <article key={macro.id} className="rounded-xl border border-border bg-surface p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 text-left"
                    onClick={() => setOpenMacros((cur) => ({ ...cur, [macro.id]: !open }))}
                  >
                    <span className="font-medium">{macro.label}</span>
                    <span className="text-xs text-muted">{macro.steps.length} steps</span>
                  </button>
                  {open ? (
                    <div className="mt-3 grid gap-3">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => update((c) => { c.macros = c.macros.filter((m) => m.id !== macro.id); })}
                        >
                          Delete macro
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="grid gap-1 text-sm text-muted">
                          Label
                          <input className={fieldClass()} value={macro.label} onChange={(e) => update((c) => { c.macros[mi]!.label = e.target.value; })} />
                        </label>
                        <label className="grid gap-1 text-sm text-muted">
                          Retries
                          <input type="number" className={fieldClass()} value={macro.retries} onChange={(e) => update((c) => { c.macros[mi]!.retries = Number(e.target.value); })} />
                        </label>
                        <label className="grid gap-1 text-sm text-muted">
                          On fail
                          <select className={fieldClass()} value={macro.onFail.kind} onChange={(e) => update((c) => { c.macros[mi]!.onFail = { kind: e.target.value as "none" | "macro" | "gotoPage", id: c.macros[mi]!.onFail.id }; })}>
                            <option value="none">Do nothing</option>
                            <option value="gotoPage">Go to page</option>
                            <option value="macro">Run another macro</option>
                          </select>
                        </label>
                      </div>
                      {macro.onFail.kind === "macro" ? (
                        <label className="grid gap-1 text-sm text-muted">
                          Fallback macro
                          <select className={fieldClass()} value={macro.onFail.id ?? ""} onChange={(e) => update((c) => { c.macros[mi]!.onFail.id = e.target.value; })}>
                            {draft.macros.filter((m) => m.id !== macro.id).map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {macro.onFail.kind === "gotoPage" ? (
                        <label className="grid gap-1 text-sm text-muted">
                          Fallback page
                          <select className={fieldClass()} value={macro.onFail.id ?? ""} onChange={(e) => update((c) => { c.macros[mi]!.onFail.id = e.target.value; })}>
                            {draft.pages.map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <ol className="space-y-2">
                        {macro.steps.map((step, si) => {
                          const needsValue = stepNeedsValue(snap, draft, step);
                          return (
                            <li key={`${macro.id}-${si}`} className="grid gap-2 rounded-md bg-bg p-2 sm:grid-cols-12">
                              <label className="grid gap-1 text-xs text-muted sm:col-span-3">
                                Device / variable
                                <select
                                  className={fieldClass()}
                                  value={step.setVar ? "__var" : (step.device ?? "")}
                                  onChange={(e) =>
                                    update((c) => {
                                      const s = c.macros[mi]!.steps[si]!;
                                      if (e.target.value === "__var") {
                                        s.setVar = draft.variables[0]?.id ?? "watchVol";
                                        s.device = undefined;
                                        s.command = undefined;
                                      } else {
                                        s.setVar = null;
                                        s.device = e.target.value;
                                        const cmds = deviceCommands(snap, draft, e.target.value);
                                        s.command = cmds[0]?.id ?? "power.on";
                                        s.value = undefined;
                                      }
                                    })
                                  }
                                >
                                  {draft.devices.map((d) => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                  ))}
                                  <option value="__var">Set variable</option>
                                </select>
                              </label>
                              <label className="grid gap-1 text-xs text-muted sm:col-span-3">
                                Command
                                {step.setVar ? (
                                  <select className={fieldClass()} value={step.setVar} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.setVar = e.target.value; })}>
                                    {(draft.variables ?? []).map((v) => (
                                      <option key={v.id} value={v.id}>{v.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <select className={fieldClass()} value={step.command ?? ""} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.command = e.target.value; c.macros[mi]!.steps[si]!.value = undefined; })}>
                                    {deviceCommands(snap, draft, step.device).map((c) => (
                                      <option key={c.id} value={c.id}>{c.label} ({c.id})</option>
                                    ))}
                                  </select>
                                )}
                              </label>
                              {needsValue ? (
                                <label className="grid gap-1 text-xs text-muted sm:col-span-2">
                                  Value
                                  <input className={fieldClass()} placeholder="{watchVol}" value={step.value ?? ""} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.value = e.target.value; })} />
                                </label>
                              ) : null}
                              <label className={cn("grid gap-1 text-xs text-muted", needsValue ? "sm:col-span-2" : "sm:col-span-4")}>
                                Wait after (ms)
                                <input className={fieldClass()} type="number" value={step.delayMsAfter ?? 0} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.delayMsAfter = Number(e.target.value); })} />
                              </label>
                              <div className="flex items-end gap-1 sm:col-span-2">
                                <button type="button" className="inline-flex size-11 items-center justify-center rounded-md border border-border" onClick={() => update((c) => { if (si === 0) return; const steps = c.macros[mi]!.steps; const cur = steps[si]!; steps.splice(si, 1); steps.splice(si - 1, 0, cur); })}>
                                  <ChevronUp className="size-4" />
                                </button>
                                <button type="button" className="inline-flex size-11 items-center justify-center rounded-md border border-border" onClick={() => update((c) => { const steps = c.macros[mi]!.steps; if (si >= steps.length - 1) return; const cur = steps[si]!; steps.splice(si, 1); steps.splice(si + 1, 0, cur); })}>
                                  <ChevronDown className="size-4" />
                                </button>
                                <Button size="sm" variant="ghost" onClick={() => update((c) => { c.macros[mi]!.steps.splice(si, 1); })}>Delete</Button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update((c) => {
                            c.macros[mi]!.steps.push({ device: draft.devices[0]?.id ?? "tv", command: deviceCommands(snap, draft, draft.devices[0]?.id)[0]?.id ?? "power.on", delayMsAfter: 0 });
                          })
                        }
                      >
                        Add step
                      </Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <Button
              variant="secondary"
              onClick={() =>
                update((c) => {
                  const id = `macro-${Date.now().toString(36)}`;
                  c.macros.push({ id, label: "New macro", retries: 1, onFail: { kind: "none" }, steps: [] });
                  setOpenMacros((cur) => ({ ...cur, [id]: true }));
                })
              }
            >
              Add macro
            </Button>
          </section>
        ) : null}

        {tab === "variables" ? (
          <section className="grid gap-4">
            <p className="text-sm text-muted">In a value field type the label in braces, e.g. {"{Watch volume}"}. The hidden id never changes, so renaming the label keeps every link.</p>
            {(draft.variables ?? []).map((variable, vi) => (
              <article key={`var-${vi}`} className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-muted sm:col-span-2">
                  Label
                  <input className={fieldClass()} value={variable.label} onChange={(e) => update((c) => { c.variables[vi]!.label = e.target.value; })} />
                </label>
                <label className="grid gap-1 text-sm text-muted sm:col-span-2">
                  Type
                  <select
                    className={fieldClass()}
                    value={variable.kind}
                    onChange={(e) =>
                      update((c) => {
                        const next = e.target.value as "number" | "enum";
                        c.variables[vi]!.kind = next;
                        if (next === "enum") {
                          c.variables[vi]!.values = c.variables[vi]!.values?.length ? c.variables[vi]!.values : ["off", "on"];
                          c.variables[vi]!.default = String(c.variables[vi]!.default);
                        } else {
                          c.variables[vi]!.default = Number(c.variables[vi]!.default) || 0;
                        }
                      })
                    }
                  >
                    <option value="number">Number (min / max clamp monitors and sliders)</option>
                    <option value="enum">List (only these words are stored)</option>
                  </select>
                </label>
                {variable.kind === "number" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">Default<input className={fieldClass()} type="number" value={Number(variable.default) || 0} onChange={(e) => update((c) => { c.variables[vi]!.default = Number(e.target.value); })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Step<input className={fieldClass()} type="number" value={variable.step ?? 1} onChange={(e) => update((c) => { c.variables[vi]!.step = Number(e.target.value); })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Min (clamp)<input className={fieldClass()} type="number" value={variable.min ?? 0} onChange={(e) => update((c) => { c.variables[vi]!.min = Number(e.target.value); })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Max (clamp)<input className={fieldClass()} type="number" value={variable.max ?? 100} onChange={(e) => update((c) => { c.variables[vi]!.max = Number(e.target.value); })} /></label>
                    <p className="sm:col-span-2 text-xs text-muted">Monitors writing this ID are clamped to min–max.</p>
                  </>
                ) : (
                  <>
                    <label className="grid gap-1 text-sm text-muted">Default<input className={fieldClass()} value={String(variable.default)} onChange={(e) => update((c) => { c.variables[vi]!.default = e.target.value; })} /></label>
                    <label className="grid gap-1 text-sm text-muted">
                      Allowed values
                      <input
                        className={fieldClass()}
                        value={(variable.values ?? []).join(", ")}
                        onChange={(e) => update((c) => { c.variables[vi]!.values = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); })}
                        placeholder="off, on"
                      />
                    </label>
                    <p className="sm:col-span-2 text-xs text-muted">A monitor value that is not in this list is discarded and the default is kept.</p>
                  </>
                )}
                <div className="sm:col-span-6">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      const used = variableInUse(draft, variable.id);
                      if (used.length) {
                        flash("Variable still in use", `${variable.label} is linked from: ${used.join(", ")}.`);
                        return;
                      }
                      update((c) => { c.variables = c.variables.filter((v) => v.id !== variable.id); });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
            <Button variant="secondary" onClick={() => update((c) => { c.variables = c.variables ?? []; c.variables.push({ id: `var-${Date.now().toString(36)}`, label: "New variable", kind: "number", default: 0, min: 0, max: 100, step: 1 }); })}>Add variable</Button>
          </section>
        ) : null}

        {tab === "monitor" ? (
          <section className="grid gap-4">
            <p className="text-sm text-muted">Poll only what you list here. Write the raw reply or a mapped value into a variable, then bind status controls to that variable.</p>
            {(draft.monitors ?? []).map((rule, ri) => {
              const driver = snap.drivers[draft.devices.find((d) => d.id === rule.device)?.driver ?? ""];
              const feedbacks = driver?.feedback ?? [];
              return (
                <article key={rule.id} className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={rule.label} onChange={(e) => update((c) => { c.monitors[ri]!.label = e.target.value; })} /></label>
                  <label className="flex items-center gap-2 text-sm text-muted pt-6">
                    <input type="checkbox" checked={rule.enabled} onChange={(e) => update((c) => { c.monitors[ri]!.enabled = e.target.checked; })} />
                    Enabled
                  </label>
                  <label className="grid gap-1 text-sm text-muted">
                    Device
                    <select className={fieldClass()} value={rule.device} onChange={(e) => update((c) => { c.monitors[ri]!.device = e.target.value; })}>
                      {draft.devices.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-muted">
                    Feedback
                    <select className={fieldClass()} value={rule.feedback} onChange={(e) => update((c) => { c.monitors[ri]!.feedback = e.target.value; })}>
                      {feedbacks.map((f) => (<option key={f.id} value={f.id}>{f.label} ({f.id})</option>))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-muted">Poll (ms)<input className={fieldClass()} type="number" value={rule.pollMs} onChange={(e) => update((c) => { c.monitors[ri]!.pollMs = Number(e.target.value); })} /></label>
                  <label className="grid gap-1 text-sm text-muted">
                    Write variable
                    <select className={fieldClass()} value={rule.writeVar ?? ""} onChange={(e) => update((c) => { c.monitors[ri]!.writeVar = e.target.value || null; })}>
                      <option value="">None</option>
                      {(draft.variables ?? []).map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-muted">
                    Value stored
                    <select className={fieldClass()} value={rule.mapMode} onChange={(e) => update((c) => { c.monitors[ri]!.mapMode = e.target.value as "raw" | "map"; })}>
                      <option value="raw">Raw feedback</option>
                      <option value="map">Mapped value</option>
                    </select>
                  </label>
                  <p className="self-end text-sm text-muted">Now: {rule.writeVar ? String(snap.vars[rule.writeVar] ?? "—") : String(snap.state[rule.device]?.[rule.feedback] ?? "—")}</p>
                  {rule.mapMode === "map" ? (
                    <div className="sm:col-span-2 grid gap-2">
                      {(rule.map ?? []).map((row, mi) => (
                        <div key={`${rule.id}-map-${mi}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                          <input className={fieldClass()} placeholder="from" value={row.from} onChange={(e) => update((c) => { c.monitors[ri]!.map[mi]!.from = e.target.value; })} />
                          <input className={fieldClass()} placeholder="to" value={row.to} onChange={(e) => update((c) => { c.monitors[ri]!.map[mi]!.to = e.target.value; })} />
                          <Button size="sm" variant="ghost" onClick={() => update((c) => { c.monitors[ri]!.map.splice(mi, 1); })}>Delete</Button>
                        </div>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => update((c) => { c.monitors[ri]!.map = c.monitors[ri]!.map ?? []; c.monitors[ri]!.map.push({ from: "on", to: "On" }); })}>Add map</Button>
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <Button size="sm" variant="danger" onClick={() => update((c) => { c.monitors = c.monitors.filter((m) => m.id !== rule.id); })}>Delete monitor</Button>
                  </div>
                </article>
              );
            })}
            <Button
              variant="secondary"
              onClick={() =>
                update((c) => {
                  c.monitors = c.monitors ?? [];
                  const device = c.devices[0];
                  const driver = device ? snap.drivers[device.driver] : undefined;
                  c.monitors.push({
                    id: `mon-${Date.now().toString(36)}`,
                    label: "New monitor",
                    enabled: true,
                    device: device?.id ?? "",
                    feedback: driver?.feedback[0]?.id ?? "power.state",
                    pollMs: 2000,
                    writeVar: c.variables[0]?.id ?? null,
                    mapMode: "raw",
                    map: [],
                  });
                })
              }
            >
              Add monitor
            </Button>
          </section>
        ) : null}

        {tab === "schedule" ? (
          <section className="grid gap-4">
            {(draft.schedules ?? []).map((job, ji) => (
              <article key={job.id} className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={job.label} onChange={(e) => update((c) => { c.schedules[ji]!.label = e.target.value; })} /></label>
                <label className="grid gap-1 text-sm text-muted">Time<input className={fieldClass()} type="time" value={job.time} onChange={(e) => update((c) => { c.schedules[ji]!.time = e.target.value; })} /></label>
                <label className="grid gap-1 text-sm text-muted">
                  Macro
                  <select className={fieldClass()} value={job.macroId} onChange={(e) => update((c) => { c.schedules[ji]!.macroId = e.target.value; })}>
                    {draft.macros.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted pt-6">
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
                        onClick={() => update((c) => { const days = c.schedules[ji]!.days; c.schedules[ji]!.days = on ? days.filter((d) => d !== day) : [...days, day].sort(); })}
                        className={cn("h-9 rounded-md px-2 text-xs border", on ? "border-accent bg-raised text-fg" : "border-border text-subtle")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Button size="sm" variant="danger" onClick={() => update((c) => { c.schedules = c.schedules.filter((s) => s.id !== job.id); })}>Delete</Button>
              </article>
            ))}
            <Button variant="secondary" onClick={() => update((c) => { c.schedules = c.schedules ?? []; c.schedules.push({ id: `sch-${Date.now().toString(36)}`, label: "New schedule", enabled: false, time: "08:00", days: [1, 2, 3, 4, 5], macroId: c.macros[0]?.id ?? "all-off" }); })}>Add schedule</Button>
          </section>
        ) : null}

        {tab === "drivers" ? (
          <section className="grid gap-4">
            <label className="inline-flex h-11 w-fit items-center rounded-md border border-border bg-surface px-4 text-sm">
              Upload driver JSON
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const spec = JSON.parse(await file.text()) as DriverSpec;
                    const name = file.name.endsWith(".json") ? file.name : `${file.name}.json`;
                    const res = await saveDriver({ data: { token, filename: name, spec } });
                    flash(res.ok ? "Driver uploaded" : "Upload failed", res.message);
                    await refresh();
                    setDriverName(name);
                    setDriverText(JSON.stringify(spec, null, 2));
                    setDriverOpen((cur) => ({ ...cur, [name]: true }));
                  } catch {
                    flash("Invalid file", "That file is not valid driver JSON.");
                  }
                }}
              />
            </label>
            {Object.entries(snap.drivers).map(([name, spec]) => {
              const open = driverOpen[name] === true;
              const text = name === driverName ? driverText : JSON.stringify(spec, null, 2);
              return (
                <article key={name} className="rounded-xl border border-border bg-surface p-4">
                  <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => { setDriverOpen((cur) => ({ ...cur, [name]: !open })); setDriverName(name); setDriverText(JSON.stringify(spec, null, 2)); }}>
                    <div>
                      <p className="font-medium">{name}</p>
                      <p className="text-sm text-muted">{spec.device.manufacturer} {spec.device.model} · {spec.commands.length} commands · {spec.feedback.length} feedback</p>
                    </div>
                    <span className="text-xs text-muted">{open ? "Hide" : "Edit"}</span>
                  </button>
                  {open ? (
                    <div className="mt-3 grid gap-3">
                      <textarea value={text} onChange={(e) => { setDriverName(name); setDriverText(e.target.value); }} className="min-h-64 rounded-lg border border-border bg-bg p-3 font-mono text-xs" />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={async () => {
                            try {
                              const parsed = JSON.parse(driverName === name ? driverText : text) as DriverSpec;
                              const res = await saveDriver({ data: { token, filename: name, spec: parsed } });
                              flash(res.ok ? "Driver saved" : "Driver not saved", res.message);
                              await refresh();
                            } catch {
                              flash("Invalid driver JSON", "The text is not valid JSON.");
                            }
                          }}
                        >
                          Save driver
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = name;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          Download
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            const used = driverInUse(draft, name);
                            if (used.length) {
                              flash("Driver still in use", `${name} is assigned to: ${used.join(", ")}.`);
                              return;
                            }
                            const res = await deleteDriver({ data: { token, filename: name } });
                            flash(res.ok ? "Driver removed" : "Driver not removed", res.message);
                            await refresh();
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function overlaps(widgets: Widget[], x: number, y: number, w: number, h: number, skipId?: string) {
  return widgets.some((item) => {
    if (item.id === skipId) return false;
    return x < item.x + item.w && x + w > item.x && y < item.y + item.h && y + h > item.y;
  });
}

function PagesEditor({
  draft,
  snap,
  page,
  selected,
  selectedId,
  setSelectedId,
  setPageId,
  update,
  colors,
}: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  page: RoomConfig["pages"][number];
  selected: Widget | null;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setPageId: (id: string) => void;
  update: (mut: (cfg: RoomConfig) => void) => void;
  colors: WidgetColor[];
}) {
  const cells = useMemo(() => Array.from({ length: page.grid.cols * page.grid.rows }, (_, i) => i), [page.grid]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);

  function cellFromPoint(clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * page.grid.cols);
    const row = Math.floor(((clientY - rect.top) / rect.height) * page.grid.rows);
    if (col < 0 || row < 0 || col >= page.grid.cols || row >= page.grid.rows) return null;
    return { x: col, y: row };
  }

  function patchWidget(mut: (w: Widget) => void) {
    update((c) => {
      const p = c.pages.find((x) => x.id === page.id);
      const w = p?.widgets.find((x) => x.id === selectedId);
      if (w) mut(w);
    });
  }

  function moveTo(id: string, x: number, y: number) {
    update((c) => {
      const current = c.pages.find((p) => p.id === page.id);
      const w = current?.widgets.find((item) => item.id === id);
      if (!current || !w) return;
      const nx = Math.max(0, Math.min(current.grid.cols - w.w, x));
      const ny = Math.max(0, Math.min(current.grid.rows - w.h, y));
      if (overlaps(current.widgets, nx, ny, w.w, w.h, id)) return;
      w.x = nx;
      w.y = ny;
    });
  }

  function resizePage(cols: number, rows: number) {
    update((c) => {
      const current = c.pages.find((p) => p.id === page.id);
      if (!current) return;
      current.grid.cols = Math.max(2, Math.min(12, cols));
      current.grid.rows = Math.max(2, Math.min(16, rows));
      for (const w of current.widgets) {
        w.w = Math.min(w.w, current.grid.cols);
        w.h = Math.min(w.h, current.grid.rows);
        w.x = Math.min(w.x, current.grid.cols - w.w);
        w.y = Math.min(w.y, current.grid.rows - w.h);
      }
    });
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {draft.pages.map((p) => (
            <button key={p.id} type="button" onClick={() => setPageId(p.id)} className={cn("h-10 rounded-md px-3 text-sm", p.id === page.id ? "bg-accent text-accent-fg" : "border border-border text-muted")}>
              {p.label}
            </button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => update((c) => { const id = `page-${Date.now().toString(36)}`; c.pages.push({ id, label: "New page", grid: { ...(c.room.grid ?? { cols: 6, rows: 8 }) }, widgets: [] }); setPageId(id); })}>Add page</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              update((c) => {
                const source = c.pages.find((p) => p.id === page.id);
                if (!source) return;
                const id = `page-${Date.now().toString(36)}`;
                c.pages.push({
                  id,
                  label: `${source.label} copy`,
                  grid: { ...source.grid },
                  widgets: source.widgets.map((w) => ({ ...w, id: `${w.id}-copy-${id}`, bind: { ...w.bind } })),
                });
                setPageId(id);
              })
            }
          >
            Copy page
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              update((c) => {
                if (c.pages.length < 2) return;
                c.pages = c.pages.filter((p) => p.id !== page.id);
                setPageId(c.pages[0]!.id);
                setSelectedId(null);
              })
            }
          >
            Delete page
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted">Press a control and drag it onto a +. It only moves if the whole block fits.</p>
        <div className="mb-3 flex flex-wrap gap-3">
          <label className="grid gap-1 text-xs text-muted">
            Page name
            <input className={fieldClass()} value={page.label} onChange={(e) => update((c) => { const current = c.pages.find((p) => p.id === page.id); if (current) current.label = e.target.value; })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Columns
            <input type="number" min={2} max={12} className={fieldClass()} value={page.grid.cols} onChange={(e) => resizePage(Number(e.target.value), page.grid.rows)} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Rows
            <input type="number" min={2} max={16} className={fieldClass()} value={page.grid.rows} onChange={(e) => resizePage(page.grid.cols, Number(e.target.value))} />
          </label>
        </div>
        <div
          ref={boardRef}
          className="relative grid gap-1 rounded-xl border border-border bg-surface p-2 touch-none"
          style={{
            gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${page.grid.rows}, 3.2rem)`,
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return;
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (cell) {
              dragRef.current.moved = true;
              setHover(cell);
            }
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current;
            dragRef.current = null;
            const cell = cellFromPoint(e.clientX, e.clientY);
            if (drag && cell && drag.moved) moveTo(drag.id, cell.x, cell.y);
            setHover(null);
            setDragging(null);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setHover(null);
            setDragging(null);
          }}
        >
          {cells.map((i) => {
            const x = i % page.grid.cols;
            const y = Math.floor(i / page.grid.cols);
            const covered = page.widgets.some((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
            const lit = hover?.x === x && hover?.y === y && !!dragging;
            return (
              <div
                key={`cell-${x}-${y}`}
                onClick={() => {
                  if (covered || dragging) return;
                  const id = `w-${Date.now().toString(36)}`;
                  const w = Math.min(2, page.grid.cols - x);
                  const h = Math.min(2, page.grid.rows - y);
                  if (overlaps(page.widgets, x, y, w, h)) return;
                  update((c) => {
                    c.pages.find((p) => p.id === page.id)?.widgets.push({
                      id, type: "button", x, y, w, h, label: "Button", color: "steel", confirm: false,
                      bind: { kind: "macro", id: draft.macros[0]?.id, gotoPage: null },
                    });
                  });
                  setSelectedId(id);
                }}
                className={cn(
                  "flex items-center justify-center rounded-md border border-dashed text-sm",
                  covered ? "border-transparent text-transparent" : "border-border/70 text-subtle",
                  lit && "border-accent bg-raised text-fg",
                )}
                style={{ gridColumn: x + 1, gridRow: y + 1 }}
              >
                {covered ? "" : "+"}
              </div>
            );
          })}
          {page.widgets.map((widget) => (
            <button
              key={widget.id}
              type="button"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { id: widget.id, moved: false };
                setDragging(widget.id);
                setSelectedId(widget.id);
              }}
              onClick={() => setSelectedId(widget.id)}
              className={cn(
                "z-[1] cursor-grab rounded-md border border-border bg-raised px-2 py-1 text-left text-[11px] text-fg active:cursor-grabbing",
                selectedId === widget.id && "ring-2 ring-accent",
                dragging === widget.id && "opacity-40",
              )}
              style={{
                gridColumn: `${widget.x + 1} / span ${widget.w}`,
                gridRow: `${widget.y + 1} / span ${widget.h}`,
              }}
            >
              {widget.label}
            </button>
          ))}
        </div>
      </div>
      <aside className="rounded-xl border border-border bg-surface p-4">
        {!selected ? <p className="text-sm text-muted">Tap a cell to add or edit a control.</p> : (
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={selected.label} onChange={(e) => patchWidget((w) => { w.label = e.target.value; })} /></label>
            <label className="grid gap-1 text-sm text-muted">
              Type
              <select
                className={fieldClass()}
                value={selected.type}
                onChange={(e) =>
                  patchWidget((w) => {
                    w.type = e.target.value as Widget["type"];
                    if (w.type === "button") w.bind = { kind: "macro", id: draft.macros[0]?.id, gotoPage: w.bind.gotoPage ?? null };
                    if (w.type === "slider") w.bind = { kind: "range", device: draft.devices[0]?.id, command: "volume.set", feedback: "volume.level" };
                    if (w.type === "status") w.bind = { kind: "variable", variable: draft.variables[0]?.id ?? null };
                  })
                }
              >
                <option value="button">button</option>
                <option value="slider">slider</option>
                <option value="status">status</option>
                <option value="label">label</option>
              </select>
            </label>
            {selected.type === "button" ? (
              <>
                <label className="grid gap-1 text-sm text-muted">
                  Macro
                  <select className={fieldClass()} value={selected.bind.id ?? ""} onChange={(e) => patchWidget((w) => { w.bind.kind = "macro"; w.bind.id = e.target.value; })}>
                    <option value="">None</option>
                    {draft.macros.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Also go to page
                  <select className={fieldClass()} value={selected.bind.gotoPage ?? ""} onChange={(e) => patchWidget((w) => { w.bind.gotoPage = e.target.value || null; })}>
                    <option value="">Stay on this page</option>
                    {draft.pages.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {selected.type === "status" ? (
              <label className="grid gap-1 text-sm text-muted">
                Variable
                <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => patchWidget((w) => { w.bind.kind = "variable"; w.bind.variable = e.target.value || null; })}>
                  <option value="">None</option>
                  {(draft.variables ?? []).map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {selected.type === "slider" ? (
              <>
                <select className={fieldClass()} value={selected.bind.device ?? ""} onChange={(e) => patchWidget((w) => { w.bind.device = e.target.value; })}>
                  {draft.devices.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                </select>
                <input className={fieldClass()} placeholder="command id" value={selected.bind.command ?? ""} onChange={(e) => patchWidget((w) => { w.bind.command = e.target.value; w.bind.feedback = e.target.value.replace(".set", ".level"); })} />
                <label className="grid gap-1 text-sm text-muted">Min<input className={fieldClass()} placeholder="0 or {volMin}" value={selected.min ?? ""} onChange={(e) => patchWidget((w) => { w.min = e.target.value; })} /></label>
                <label className="grid gap-1 text-sm text-muted">Max<input className={fieldClass()} placeholder="100 or {volMax}" value={selected.max ?? ""} onChange={(e) => patchWidget((w) => { w.max = e.target.value; })} /></label>
                <label className="grid gap-1 text-sm text-muted">
                  Write variable
                  <select className={fieldClass()} value={selected.bind.variable ?? ""} onChange={(e) => patchWidget((w) => { w.bind.variable = e.target.value || null; })}>
                    <option value="">None</option>
                    {(draft.variables ?? []).map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
                  </select>
                </label>
              </>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button key={c} type="button" title={c} onClick={() => patchWidget((w) => { w.color = c; })} className={cn("size-8 rounded-md border", selected.color === c ? "ring-2 ring-accent border-accent" : "border-border")} style={{ background: COLOR_FILL[c] }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted">
              <label className="grid gap-1">Width<input type="number" className={fieldClass()} value={selected.w} onChange={(e) => patchWidget((w) => { w.w = Number(e.target.value); })} /></label>
              <label className="grid gap-1">Height<input type="number" className={fieldClass()} value={selected.h} onChange={(e) => patchWidget((w) => { w.h = Number(e.target.value); })} /></label>
            </div>
            <p className="text-xs uppercase tracking-[0.16em] text-subtle">Move on grid</p>
            <div className="grid grid-cols-2 gap-1">
              {([
                ["Move left", selected.x - 1, selected.y],
                ["Move right", selected.x + 1, selected.y],
                ["Move up", selected.x, selected.y - 1],
                ["Move down", selected.x, selected.y + 1],
              ] as const).map(([label, x, y]) => (
                <Button key={label} size="sm" variant="secondary" onClick={() => moveTo(selected.id, x, y)}>{label}</Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={!!selected.confirm} onChange={(e) => patchWidget((w) => { w.confirm = e.target.checked; })} />
              Confirm press
            </label>
            <p className="text-xs uppercase tracking-[0.16em] text-subtle">Enable only when</p>
            <label className="grid gap-1 text-sm text-muted">
              Source
              <select
                className={fieldClass()}
                value={selected.enableWhen?.variable ? "variable" : selected.enableWhen?.device ? "device" : ""}
                onChange={(e) =>
                  patchWidget((w) => {
                    if (!e.target.value) w.enableWhen = null;
                    else if (e.target.value === "variable") {
                      const first = draft.variables[0];
                      w.enableWhen = { variable: first?.id ?? "", equals: String(first?.default ?? ""), device: undefined, feedback: undefined };
                    } else {
                      const device = draft.devices[0];
                      const feedbacks = snap.drivers[device?.driver ?? ""]?.feedback ?? [];
                      const first = feedbacks[0];
                      w.enableWhen = { device: device?.id ?? "", feedback: first?.id ?? "power.state", equals: first?.values?.[0] ?? "on", variable: null };
                    }
                  })
                }
              >
                <option value="">Always enabled</option>
                <option value="device">Device feedback</option>
                <option value="variable">Variable</option>
              </select>
            </label>
            {selected.enableWhen?.variable ? (
              <>
                <label className="grid gap-1 text-sm text-muted">
                  Variable
                  <select
                    className={fieldClass()}
                    value={selected.enableWhen.variable}
                    onChange={(e) =>
                      patchWidget((w) => {
                        if (!w.enableWhen) return;
                        w.enableWhen.variable = e.target.value;
                        const def = draft.variables.find((v) => v.id === e.target.value);
                        w.enableWhen.equals = def?.values?.[0] ?? String(def?.default ?? w.enableWhen.equals);
                      })
                    }
                  >
                    {(draft.variables ?? []).map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Equals
                  <select
                    className={fieldClass()}
                    value={selected.enableWhen.equals}
                    onChange={(e) => patchWidget((w) => { if (w.enableWhen) w.enableWhen.equals = e.target.value; })}
                  >
                    {(() => {
                      const def = draft.variables.find((v) => v.id === selected.enableWhen?.variable);
                      const options = def?.values?.length ? def.values : [String(def?.default ?? selected.enableWhen.equals), "on", "off"];
                      return Array.from(new Set(options)).map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ));
                    })()}
                  </select>
                </label>
              </>
            ) : selected.enableWhen?.device ? (
              <>
                <label className="grid gap-1 text-sm text-muted">
                  Device
                  <select
                    className={fieldClass()}
                    value={selected.enableWhen.device}
                    onChange={(e) =>
                      patchWidget((w) => {
                        const device = draft.devices.find((d) => d.id === e.target.value);
                        const feedbacks = snap.drivers[device?.driver ?? ""]?.feedback ?? [];
                        const first = feedbacks[0];
                        w.enableWhen = { device: e.target.value, feedback: first?.id ?? "power.state", equals: first?.values?.[0] ?? "on", variable: null };
                      })
                    }
                  >
                    {draft.devices.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Feedback
                  <select
                    className={fieldClass()}
                    value={selected.enableWhen.feedback ?? ""}
                    onChange={(e) =>
                      patchWidget((w) => {
                        if (!w.enableWhen) return;
                        w.enableWhen.feedback = e.target.value;
                        const fb = snap.drivers[draft.devices.find((d) => d.id === w.enableWhen?.device)?.driver ?? ""]?.feedback.find((item) => item.id === e.target.value);
                        w.enableWhen.equals = fb?.values?.[0] ?? w.enableWhen.equals;
                      })
                    }
                  >
                    {(snap.drivers[draft.devices.find((d) => d.id === selected.enableWhen?.device)?.driver ?? ""]?.feedback ?? []).map((fb) => (
                      <option key={fb.id} value={fb.id}>{fb.label} ({fb.id})</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">
                  Equals
                  <select
                    className={fieldClass()}
                    value={selected.enableWhen.equals}
                    onChange={(e) => patchWidget((w) => { if (w.enableWhen) w.enableWhen.equals = e.target.value; })}
                  >
                    {(() => {
                      const fb = snap.drivers[draft.devices.find((d) => d.id === selected.enableWhen?.device)?.driver ?? ""]?.feedback.find((item) => item.id === selected.enableWhen?.feedback);
                      const options = fb?.values?.length ? fb.values : ["on", "off"];
                      return options.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ));
                    })()}
                  </select>
                </label>
              </>
            ) : null}
            <Button variant="danger" size="sm" onClick={() => update((c) => { const p = c.pages.find((x) => x.id === page.id); if (p) p.widgets = p.widgets.filter((w) => w.id !== selected.id); setSelectedId(null); })}>Remove</Button>
          </div>
        )}
      </aside>
    </section>
  );
}
