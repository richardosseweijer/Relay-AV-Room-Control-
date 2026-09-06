import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { ICON_NAMES, NamedIcon } from "@/components/icons";
import {
  authenticate,
  clearConfig,
  clearDeviceError,
  addDriverFromLibrary,
  deleteDriver,
  exportBundle,
  importBundle,
  fireCommand,
  fireMacro,
  getEditorConfig,
  wipeLog,
  saveConfig,
  saveDriver,
  pullInventory,
  debugScan,
  debugSend,
  listHostPorts,
  rebootHost,
  restartHost,
  revokeSession,
  revokeAllSessions,
  updateHost,
  verifyConfigPin,
} from "@/lib/control/actions";
import type { DriverSpec, InventoryItem, RoomConfig, RoomSnapshot, Widget, WidgetColor } from "@/lib/control/types";
import { deviceInUse, driverInUse, variableInUse } from "@/lib/control/vars";
import { orphanBindings } from "@/lib/control/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLORS: WidgetColor[] = ["steel", "sage", "clay", "fog", "ink", "ocean", "pine", "rust", "sand", "slate", "rose"];
const COLOR_FILL: Record<WidgetColor, string> = {
  steel: "bg-steel", sage: "bg-sage", clay: "bg-clay", fog: "bg-fog", ink: "bg-raised",
  ocean: "bg-ocean", pine: "bg-pine", rust: "bg-rust", sand: "bg-sand", slate: "bg-slate", rose: "bg-rose",
};

function fieldClass() {
  return "h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg";
}

async function pingHost(host: string, port?: number, path?: string) {
  const { pingDevice } = await import("@/lib/control/actions");
  return pingDevice({
    data: {
      token: sessionStorage.getItem("relay-config-token") || "",
      host,
      port,
      path,
    },
  });
}

async function loadRoom(): Promise<RoomSnapshot | null> {
  const res = await fetch("/api/room", { cache: "no-store", headers: { Authorization: `Bearer ${sessionStorage.getItem("relay-config-token") || ""}` } });
  if (!res.ok) return null;
  const next = await res.json().catch(() => null) as RoomSnapshot | null;
  return next?.config?.room ? next : null;
}

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

function InventoryBoard(props: {
  lists: { id: string; label: string; items: InventoryItem[]; command?: string }[];
  onRefresh?: () => void;
  onUse?: (command: string, id: string) => void;
}) {
  const [listId, setListId] = useState(props.lists[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const list = props.lists.find((item) => item.id === listId) ?? props.lists[0];
  const filtered = (list?.items ?? []).filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.id} ${item.group ?? ""}`.toLowerCase().includes(q);
  });
  const groups = [...new Set(filtered.map((item) => item.group || list?.label || "Other"))];
  if (!props.lists.length) return null;
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-border bg-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {props.lists.map((item) => (
          <button key={item.id} type="button" className={cn("rounded-full border px-3 py-1 text-xs", listId === item.id ? "border-accent bg-surface text-fg" : "border-border text-subtle")} onClick={() => { setListId(item.id); setQuery(""); }}>
            {item.label} ({item.items.length})
          </button>
        ))}
        {props.onRefresh ? <Button size="sm" variant="secondary" onClick={props.onRefresh}>Refresh</Button> : null}
      </div>
      <input className={fieldClass()} placeholder={`Filter ${list?.label ?? ""}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-56 space-y-3 overflow-auto">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-subtle">{group}</p>
            <div className="grid gap-1">
              {filtered.filter((item) => (item.group || list?.label || "Other") === group).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.name}</p>
                    <p className="font-mono text-[10px] text-subtle">{item.id}{item.value !== undefined ? ` = ${item.value}` : ""}</p>
                  </div>
                  {props.onUse && list?.command ? (
                    <Button size="sm" variant="ghost" onClick={() => props.onUse?.(list.command!, item.id)}>Use</Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length ? <p className="text-sm text-muted">Empty. Refresh inventory.</p> : null}
      </div>
    </div>
  );
}

function InventoryPicker(props: {
  lists: { id: string; label: string; items: InventoryItem[]; command: string }[];
  command?: string;
  value?: string | number;
  onPick: (command: string, value: string) => void;
}) {
  return <InventoryBoard lists={props.lists} onUse={props.onPick} />;
}

const TIMEZONES = ["system", "Europe/Brussels", "Europe/Amsterdam", "Europe/London", "Europe/Berlin", "UTC", "America/New_York"];

export function ConfigApp() {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [draft, setDraft] = useState<RoomConfig | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<"room" | "security" | "drivers" | "devices" | "interfaces" | "macros" | "pages" | "logic" | "log">("room");
  const [logicTab, setLogicTab] = useState<"variables" | "monitor" | "schedule" | "triggers">("variables");
  const [logKind, setLogKind] = useState("all");
  const [toast, setToast] = useState<{ title: string; body: string; sticky?: boolean } | null>(null);
  const [lockPin, setLockPin] = useState("");
  const [needLock, setNeedLock] = useState(false);
  const [openMacros, setOpenMacros] = useState<Record<string, boolean>>({});
  const [openDevices, setOpenDevices] = useState<Record<string, boolean>>({});
  const [openLogic, setOpenLogic] = useState<Record<string, boolean>>({});
  const [pageId, setPageId] = useState("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState("");
  const [driverText, setDriverText] = useState("");
  const [libraryPick, setLibraryPick] = useState("");
  const [gate, setGate] = useState<{ action: "wipe"; pin: string } | null>(null);
  const [reach, setReach] = useState<Record<string, "sim" | "up" | "down" | "wait">>({});
  const [hostPorts, setHostPorts] = useState<{ kind: string; path: string; label: string }[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const [pendingDriver, setPendingDriver] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [paired, setPaired] = useState<{ id: string; kind: string; label: string; created: number; lastSeen?: number }[]>([]);

  async function scanPorts(quiet = false) {
    const res = await listHostPorts({ data: { token: token || "" } });
    setHostPorts(res.ports ?? []);
    if (!quiet) flash(res.ok ? "Interfaces" : "Scan failed", res.message);
  }

  function flash(title: string, body: string) {
    const text = `${title} ${body}`;
    const sticky = /lock required|config lock|fail|failed|error|wrong|in use|wipe|not added|not removed|not saved|not deleted/i.test(text);
    setToast({ title, body, sticky });
    if (/lock required|config lock/i.test(text)) {
      setNeedLock(true);
      setLockPin("");
    }
  }

  useEffect(() => {
    if (!toast || toast.sticky || needLock) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast, needLock]);

  async function refresh() {
    const next = await loadRoom();
    if (!next?.config?.room) return next;
    if (token) {
      const ed = await getEditorConfig({ data: { token } });
      if (ed.ok && ed.traces) next.traces = ed.traces;
      if (ed.ok && ed.config) setDraft((cur) => cur ?? structuredClone(ed.config));
    }
    setSnap(next);
    return next;
  }

  useEffect(() => {
    const stored = sessionStorage.getItem("relay-config-token");
    if (stored) {
      getEditorConfig({ data: { token: stored } }).then((res) => {
        if (res.ok && res.config) {
          setToken(stored);
          setDraft(structuredClone(res.config));
          setMustChange(Boolean(res.mustChange));
          if (res.paired) setPaired(res.paired);
        } else {
          sessionStorage.removeItem("relay-config-token");
          setToken(null);
        }
      }).catch(() => {
        sessionStorage.removeItem("relay-config-token");
        setToken(null);
      });
    }
    refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => { loadRoom().then(setSnap).catch(() => undefined); }, 8000);
    return () => window.clearInterval(id);
  }, [token]);

  useEffect(() => {
    const tick = async () => {
      const key = token || sessionStorage.getItem("relay-config-token");
      if (!key) {
        if (token) setToken(null);
        return;
      }
      const res = await getEditorConfig({ data: { token: key } });
      if (res.ok) {
        if (token !== key) setToken(key);
      } else {
        setToken(null);
        sessionStorage.removeItem("relay-config-token");
      }
    };
    tick().catch(() => undefined);
    const id = window.setInterval(() => { tick().catch(() => undefined); }, 2500);
    return () => window.clearInterval(id);
  }, [token]);

  useEffect(() => {
    if (tab !== "devices" || !token || !draft) return;
    let cancel = false;
    async function tick() {
      await Promise.all((draft?.devices ?? []).map(async (device) => {
        if (cancel) return;
        if (device.simulate) { setReach((cur) => ({ ...cur, [device.id]: "sim" })); return; }
        const driver = snap?.drivers[device.driver];
        if (driver?.device.type === "host" || device.driver === "relay-host.json") {
          setReach((cur) => ({ ...cur, [device.id]: "up" }));
          return;
        }
        if (!device.host.trim()) { setReach((cur) => ({ ...cur, [device.id]: "down" })); return; }
        const res = await pingHost(device.host, device.port ?? driver?.transports.lan?.port, driver?.auth?.pairing?.discoverPath || "/");
        if (!cancel) setReach((cur) => ({ ...cur, [device.id]: res.ok ? "up" : "down" }));
      }));
    }
    tick().catch(() => undefined);
    const id = window.setInterval(() => { tick().catch(() => undefined); }, 8000);
    return () => { cancel = true; window.clearInterval(id); };
  }, [tab, token, draft, snap]);

  useEffect(() => {
    if (tab !== "interfaces" || !token) return;
    scanPorts(true).catch(() => undefined);
  }, [tab, token]);

  useEffect(() => {
    const theme = (draft?.room.theme ?? snap?.config.room.theme) === "pastel" ? "pastel" : "dark";
    document.documentElement.dataset.theme = theme;
  }, [draft?.room.theme, snap?.config.room.theme]);

  function update(mut: (c: RoomConfig) => void) {
    if (!draft) return;
    const next = structuredClone(draft);
    mut(next);
    setDraft(next);
  }

  async function persist(nextToken = token) {
    if (!draft || !nextToken) return;
    const res = await saveConfig({ data: { token: nextToken, config: draft } }) as { ok: boolean; message?: string };
    flash(res.ok ? "Saved" : "Save failed", res.message ?? "");
    await refresh();
  }

  const page = draft?.pages.find((p) => p.id === pageId) ?? draft?.pages[0];
  const selected = page?.widgets.find((w) => w.id === selectedId) ?? null;

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Relay setup</p>
        <h1 className="text-3xl font-medium tracking-tight">Configurator</h1>
        <p className="text-sm text-muted">Enter the configurator PIN. First-run default is 1234.</p>
        <input className={fieldClass()} inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
        <Button type="button" className="relative z-20 h-14 w-full text-base" onClick={async () => {
          try {
            const res = await fetch("/api/config-unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pin.trim() }) });
            const data = await res.json().catch(() => ({})) as { ok?: boolean; token?: string; mustChange?: boolean; message?: string };
            if (data.ok && data.token) {
              setToken(data.token);
              sessionStorage.setItem("relay-config-token", data.token);
              setMustChange(Boolean(data.mustChange));
              const editor = await getEditorConfig({ data: { token: data.token } }).catch(() => ({ ok: false as const, config: null, paired: [] }));
              if (editor.ok && editor.config) setDraft(structuredClone(editor.config));
              else {
                const room = await loadRoom();
                if (room?.config) setDraft(structuredClone(room.config));
              }
            } else flash(data.message || "Wrong PIN", "");
          } catch (err) {
            flash(err instanceof Error ? err.message : "Unlock failed", "");
          }
        }}>Unlock</Button>
        <Link to="/" onClick={() => sessionStorage.removeItem("relay-config-token")} className="text-center text-sm text-muted underline-offset-4 hover:underline">Back to room</Link>
        {toast ? <p className="text-sm text-clay">{toast.body || toast.title}</p> : null}
      </main>
    );
  }

  if (!draft?.room || !page) return <main className="flex min-h-dvh items-center justify-center bg-bg text-muted">Loading config…</main>;

  if (mustChange) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6">
        <h1 className="text-3xl font-medium tracking-tight">Set a new PIN</h1>
        <p className="text-sm text-muted">1234 and other simple codes are not allowed.</p>
        <input className={fieldClass()} type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="New PIN" />
        <input className={fieldClass()} type="password" inputMode="numeric" value={newPin2} onChange={(e) => setNewPin2(e.target.value)} placeholder="Repeat PIN" />
        <Button onClick={async () => {
          if (newPin !== newPin2) { flash("PIN mismatch", ""); return; }
          update((c) => { c.room.configPin = newPin; });
          const next = structuredClone(draft);
          next.room.configPin = newPin;
          next.room.panelPin = newPin;
          next.room.panelAccess = "pin";
          const res = await saveConfig({ data: { token: token || "", config: next } });
          if (!res.ok) { flash("PIN not saved", res.message ?? ""); return; }
          setDraft(next);
          setMustChange(false);
          flash("PIN set", "Remember this code.");
        }}>Save PIN</Button>
        {toast ? <p className="text-sm text-clay">{toast.body || toast.title}</p> : null}
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      {toast ? (
        <div className="fixed right-4 top-4 z-50 max-w-sm rounded-xl border border-border bg-surface p-4">
          <p className="font-medium">{toast.title}</p>
          <p className="mt-1 text-sm text-muted">{toast.body}</p>
          {needLock ? (
            <div className="mt-3 grid gap-2">
              <input className={fieldClass()} inputMode="numeric" value={lockPin} onChange={(e) => setLockPin(e.target.value)} placeholder="PIN" />
              <Button onClick={async () => {
                const res = await verifyConfigPin({ data: { pin: lockPin } });
                if (!res.ok || !res.token) { flash("Wrong PIN", ""); return; }
                setToken(res.token);
                sessionStorage.setItem("relay-config-token", res.token);
                setNeedLock(false);
                setToast(null);
                if (draft) await persist(res.token);
                else flash("Unlocked", "");
              }}>Unlock</Button>
            </div>
          ) : (
            <button type="button" className="mt-2 text-xs text-muted" onClick={() => setToast(null)}>Dismiss</button>
          )}
        </div>
      ) : null}
      {gate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5">
            <p className="text-lg font-medium">Clear this host?</p>
            <p className="mt-2 text-sm text-muted">Enter the configurator PIN.</p>
            <input className={`${fieldClass()} mt-4`} inputMode="numeric" value={gate.pin} onChange={(e) => setGate({ ...gate, pin: e.target.value })} placeholder="PIN" />
            <div className="mt-4 flex gap-2">
              <Button onClick={async () => {
                const check = await verifyConfigPin({ data: { pin: gate.pin } });
                if (!check.ok || !check.token) { flash("Wrong PIN", ""); return; }
                setToken(check.token);
                const res = await clearConfig({ data: { token: check.token, pin: gate.pin } });
                setGate(null);
                flash(res.ok ? "Cleared" : "Wipe failed", res.message);
                setDraft(structuredClone((await getEditorConfig({ data: { token: check.token } })).config ?? draft));
              }}>Wipe room</Button>
              <Button variant="secondary" onClick={() => setGate(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-bg px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" onClick={() => sessionStorage.removeItem("relay-config-token")} className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface">
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Configurator</p>
              <h1 className="text-lg font-medium">{draft.room.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {token ? (
              <Button
                variant="secondary"
                className="border-sage/40 bg-sage/20 text-sage"
                onClick={() => {
                  setToken(null);
                  sessionStorage.removeItem("relay-config-token");
                }}
              >
                Unlocked
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="border-clay/50 bg-clay/20 text-clay"
                onClick={() => {
                  setNeedLock(true);
                  setLockPin("");
                  flash("Unlock", "Enter PIN");
                }}
              >
                Unlock
              </Button>
            )}
            <Button variant="secondary" onClick={() => void persist()}>Save all</Button>
          </div>
        </div>
        <nav className="mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto">
          {(["room", "security", "drivers", "devices", "interfaces", "macros", "pages", "logic", "log"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("h-10 rounded-md px-3 text-sm capitalize", tab === id ? "bg-accent text-accent-fg" : "text-muted")}>{id}</button>
          ))}
        </nav>
      </header>

      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto px-4 py-6">
        {tab === "room" ? (
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Room name<input className={fieldClass()} value={draft.room.name} onChange={(e) => update((c) => { c.room.name = e.target.value; })} /></label>
            <label className="grid gap-1 text-sm text-muted">Theme
              <select className={fieldClass()} value={draft.room.theme === "pastel" ? "pastel" : "dark"} onChange={(e) => update((c) => { c.room.theme = e.target.value as "dark" | "pastel"; })}>
                <option value="dark">Dark</option>
                <option value="pastel">Pastel</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Idle dim (s)
              <input type="number" min={0} className={fieldClass()} value={draft.room.idleDimSeconds} onChange={(e) => update((c) => { c.room.idleDimSeconds = Math.max(0, Number(e.target.value) || 0); })} />
              <span className="text-xs">0 = never</span>
            </label>
            <label className="grid gap-1 text-sm text-muted">Clock
              <select className={fieldClass()} value={draft.room.network?.timezone ?? "system"} onChange={(e) => update((c) => { c.room.network.timezone = e.target.value; })}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone === "system" ? "This computer" : zone}</option>)}
              </select>
              <span className="text-xs">Schedules use this host’s clock. Set the OS time if it is wrong.</span>
            </label>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={async () => {
                const bundle = await exportBundle({ data: { token: token || "" } });
                if (!bundle || !("config" in bundle) || !bundle.config) {
                  flash("Export failed", "ok" in bundle ? String((bundle as { message?: string }).message ?? "Lock required") : "Lock required");
                  return;
                }
                const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${draft.room.id}-relay.json`;
                a.click();
                URL.revokeObjectURL(url);
                flash("Exported", "PINs and tokens are blank in the file.");
              }}>Export</Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (!window.confirm("Replace this room with the file? Save all first if you still need the current layout. Device tokens that are blank in the file keep the ones already on this host.")) return;
                  try {
                    const parsed = JSON.parse(await file.text()) as { config?: RoomConfig; drivers?: Record<string, never> };
                    const res = await importBundle({ data: { token: token || "", bundle: parsed } });
                    flash(res.ok ? "Imported" : "Import failed", res.message);
                    const next = await refresh();
                    if (res.ok) {
                      const ed = await getEditorConfig({ data: { token: token || "" } });
                      if (ed.config) setDraft(structuredClone(ed.config));
                      else if (next?.config) setDraft(structuredClone(next.config));
                    }
                  } catch {
                    flash("Import failed", "Not valid JSON");
                  }
                }}
              />
              <Button variant="secondary" onClick={() => importRef.current?.click()}>Import</Button>
              <Button variant="danger" onClick={() => setGate({ action: "wipe", pin: "" })}>Clear config</Button>
              <Button variant="secondary" onClick={async () => {
                if (!window.confirm("Restart Relay? The page will drop for a few seconds.")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await restartHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Restarting Relay" : "Restart failed", res.message);
              }}>Restart Relay</Button>
              <Button variant="secondary" onClick={async () => {
                if (!window.confirm("Update Relay from GitHub?\n\nSave all first. The room will go offline for a minute.")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await updateHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Updating from GitHub" : "Update failed", res.message);
              }}>Update from GitHub</Button>
              <Button variant="danger" onClick={async () => {
                if (!window.confirm("Reboot the whole machine?")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await rebootHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Rebooting machine" : "Reboot failed", res.message);
              }}>Reboot machine</Button>
            </div>
          </section>
        ) : null}

        {tab === "security" ? (
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Config PIN
              <input className={fieldClass()} type="password" autoComplete="off" placeholder="unchanged" value={String(draft.room.configPin || "").startsWith("scrypt$") ? "" : draft.room.configPin} onChange={(e) => update((c) => { c.room.configPin = e.target.value; })} />
            </label>
            <label className="grid gap-1 text-sm text-muted">
              Panel access
              <select className={fieldClass()} value={draft.room.panelAccess} onChange={(e) => update((c) => { c.room.panelAccess = e.target.value as "open" | "pin"; })}>
                <option value="open">Open on LAN</option>
                <option value="pin">Panel PIN</option>
              </select>
            </label>
            {draft.room.panelAccess === "pin" ? (
              <label className="grid gap-1 text-sm text-muted">Panel PIN
                <input className={fieldClass()} type="password" autoComplete="off" placeholder="unchanged" value={String(draft.room.panelPin ?? "").startsWith("scrypt$") ? "" : (draft.room.panelPin ?? "")} onChange={(e) => update((c) => { c.room.panelPin = e.target.value; })} />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={draft.room.externalControl === true} onChange={(e) => update((c) => { c.room.externalControl = e.target.checked; })} />
              Allow commands from the LAN with no token (debug only)
            </label>
            <label className="grid gap-1 text-sm text-muted sm:col-span-2">This room’s peer secret
              <div className="flex flex-wrap gap-2">
                <input className={cn(fieldClass(), "min-w-0 flex-1 font-mono text-xs")} autoComplete="off" value={draft.room.peerSecret ?? ""} onChange={(e) => update((c) => { c.room.peerSecret = e.target.value; })} />
                <Button type="button" variant="secondary" onClick={async () => {
                  const value = draft.room.peerSecret ?? "";
                  try {
                    await navigator.clipboard.writeText(value);
                    flash("Copied", "Paste this into the other room’s Relay device → Secret field.");
                  } catch {
                    flash("Copy failed", value || "Generate a secret first");
                  }
                }}>Copy</Button>
                <Button type="button" variant="secondary" onClick={() => {
                  const bytes = new Uint8Array(24);
                  crypto.getRandomValues(bytes);
                  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
                  update((c) => { c.room.peerSecret = secret; });
                  void navigator.clipboard.writeText(secret).then(
                    () => flash("Secret ready", "Copied. Save all. On the other Pi, paste it in that room’s Relay device → Secret."),
                    () => flash("Secret ready", "Select the field and copy it, then Save all."),
                  );
                }}>Generate secret</Button>
              </div>
              <span className="text-xs">HMAC key this room uses to check incoming room-to-room calls. Save all after changing it.</span>
            </label>
            <div className="sm:col-span-2 grid gap-2">
              <p className="text-sm text-muted">Peer may run these macros (none = deny all remote macros)</p>
              {(draft.macros ?? []).map((macro) => (
                <label key={macro.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(draft.room.peerMacroIds ?? []).includes(macro.id)}
                    onChange={(e) => update((c) => {
                      const cur = new Set(c.room.peerMacroIds ?? []);
                      if (e.target.checked) cur.add(macro.id);
                      else cur.delete(macro.id);
                      c.room.peerMacroIds = [...cur];
                    })}
                  />
                  {macro.label}
                </label>
              ))}
            </div>
            <div className="sm:col-span-2 grid gap-2">
              <p className="text-sm text-muted">Paired browsers stay trusted until you forget them.</p>
              {paired.filter((row) => row.kind === "panel").length === 0 ? <p className="text-sm text-subtle">None yet.</p> : paired.filter((row) => row.kind === "panel").map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <span>{row.label} · {row.lastSeen ? new Date(row.lastSeen).toLocaleString() : row.created ? new Date(row.created).toLocaleDateString() : "—"}</span>
                  <Button size="sm" variant="danger" onClick={async () => {
                    const res = await revokeSession({ data: { token: token || "", id: row.id } });
                    flash(res.ok ? "Forgotten" : "Failed", res.message);
                    const ed = await getEditorConfig({ data: { token: token || "" } });
                    if (ed.paired) setPaired(ed.paired);
                  }}>Forget</Button>
                </div>
              ))}
              {paired.some((row) => row.kind === "panel") ? (
                <Button size="sm" variant="danger" onClick={async () => {
                  const res = await revokeAllSessions({ data: { token: token || "" } });
                  flash(res.ok ? "All tablets forgotten" : "Failed", res.message);
                  const ed = await getEditorConfig({ data: { token: token || "" } });
                  if (ed.paired) setPaired(ed.paired);
                }}>Forget all tablets</Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "devices" ? (
          <section className="grid gap-4">
            {orphanBindings(draft, snap.drivers).length ? (
              <p className="rounded-md border border-sand/40 bg-sand/10 px-3 py-2 text-sm">
                Broken after a driver swap: {orphanBindings(draft, snap.drivers).slice(0, 8).join(" · ")}
              </p>
            ) : null}
            {draft.devices.map((device, index) => {
              const driver = snap.drivers[device.driver];
              const features = [...(driver?.commands.map((c) => c.id) ?? []), ...(driver?.feedback.map((f) => f.id) ?? [])];
              const allOn = device.enabledFeatures.length === 0;
              const open = openDevices[device.id] === true;
              return (
                <article key={device.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", reach[device.id] === "up" || device.simulate ? "bg-sage" : reach[device.id] === "wait" ? "bg-sand" : "bg-clay")} />
                    <input className={fieldClass()} value={device.name} onChange={(e) => update((c) => { c.devices[index]!.name = e.target.value; })} />
                    <button type="button" className="shrink-0 text-xs text-muted" onClick={() => setOpenDevices((cur) => ({ ...cur, [device.id]: !open }))}>{open ? "Hide" : "Show"}</button>
                  </div>
                  {open ? (
                  <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select className={fieldClass()} value={device.driver} onChange={(e) => update((c) => {
                      const next = e.target.value;
                      c.devices[index]!.driver = next;
                      const spec = snap.drivers[next];
                      const baud = spec?.transports.local?.baud ?? spec?.transports.rs232?.baud;
                      if (baud) c.devices[index]!.baud = baud;
                      if (spec?.transports.local?.bus) c.devices[index]!.bus = spec.transports.local.bus;
                      if (spec?.transports.local?.address) c.devices[index]!.address = spec.transports.local.address;
                      if (spec?.transports.local?.speed) c.devices[index]!.speed = spec.transports.local.speed;
                    })}>
                      {Object.keys(snap.drivers).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <label className="grid gap-1 text-sm text-muted">Interface
                      <select className={fieldClass()} value={device.interfaceId ?? ""} onChange={(e) => update((c) => { c.devices[index]!.interfaceId = e.target.value || null; c.devices[index]!.transport = e.target.value ? "local" : "lan"; })}>
                        <option value="">LAN</option>
                        {(draft.interfaces ?? []).map((iface) => (
                          <option key={iface.id} value={iface.id}>{iface.label} ({iface.kind} {iface.path || iface.line || ""})</option>
                        ))}
                      </select>
                    </label>
                    {(() => {
                      const kind = (draft.interfaces ?? []).find((item) => item.id === device.interfaceId)?.kind;
                      const fields = driver?.auth?.instanceFields ?? [];
                      const needsToken = fields.includes("token") || (!fields.length && (!!driver?.auth?.pairing || driver?.auth?.type === "token"));
                      const needsSecret = driver?.auth?.type === "password" || fields.includes("password") || fields.includes("mac") || driver?.transports.lan?.protocol === "wol";
                      return (
                        <>
                          {!kind ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">IP
                                <input className={fieldClass()} value={device.host} placeholder="10.0.0.10 or localhost" onChange={(e) => update((c) => { c.devices[index]!.host = e.target.value; })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">Port
                                <input className={fieldClass()} type="number" value={device.port ?? driver?.transports.lan?.port ?? 80} onChange={(e) => update((c) => { c.devices[index]!.port = Number(e.target.value); })} />
                              </label>
                            </>
                          ) : null}
                          {kind === "serial" ? (
                            <label className="grid gap-1 text-sm text-muted">Baud
                              <input className={fieldClass()} type="number" value={device.baud ?? driver?.transports.local?.baud ?? driver?.transports.rs232?.baud ?? 9600} onChange={(e) => update((c) => { c.devices[index]!.baud = Number(e.target.value); })} />
                            </label>
                          ) : null}
                          {kind === "i2c" ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">I2C bus
                                <input className={fieldClass()} type="number" value={device.bus ?? driver?.transports.local?.bus ?? 1} onChange={(e) => update((c) => { c.devices[index]!.bus = Number(e.target.value); })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">I2C address
                                <input className={fieldClass()} value={device.address ?? driver?.transports.local?.address ?? ""} placeholder="0x3c" onChange={(e) => update((c) => { c.devices[index]!.address = e.target.value; })} />
                              </label>
                            </>
                          ) : null}
                          {kind === "spi" ? (
                            <label className="grid gap-1 text-sm text-muted">SPI speed
                              <input className={fieldClass()} type="number" value={device.speed ?? driver?.transports.local?.speed ?? 500000} onChange={(e) => update((c) => { c.devices[index]!.speed = Number(e.target.value); })} />
                            </label>
                          ) : null}
                          {needsToken ? (
                            <label className="grid gap-1 text-sm text-muted">Token
                              <input className={fieldClass()} type="password" placeholder="token" value={device.auth?.token ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, token: e.target.value }; })} />
                            </label>
                          ) : null}
                          {needsSecret && (fields.includes("mac") || driver?.transports.lan?.protocol === "wol") ? (
                            <label className="grid gap-1 text-sm text-muted">MAC (wired if on Ethernet)
                              <input className={fieldClass()} placeholder="AA:BB:CC:DD:EE:FF" value={device.auth?.mac ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, mac: e.target.value }; })} />
                            </label>
                          ) : null}
                          {(driver?.auth?.type === "password" || driver?.auth?.type === "userpass" || fields.includes("user") || fields.includes("password")) ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">User
                                <input className={fieldClass()} value={device.auth?.user ?? device.auth?.username ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, user: e.target.value }; })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">Password
                                <input className={fieldClass()} type="password" value={device.auth?.password ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, password: e.target.value }; })} />
                              </label>
                            </>
                          ) : null}
                          {fields.filter((name) => !["token", "mac", "password", "user"].includes(name)).map((name) => (
                            <label key={name} className="grid gap-1 text-sm text-muted">
                              {name === "secret" ? "Secret (other room’s peer secret)" : name}
                              <input className={fieldClass()} value={device.auth?.[name] ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, [name]: e.target.value }; })} />
                              {name === "secret" ? <span className="text-xs">From the other Relay: Security → This room’s peer secret.</span> : null}
                            </label>
                          ))}
                        </>
                      );
                    })()}
                    <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={device.simulate} onChange={(e) => update((c) => { c.devices[index]!.simulate = e.target.checked; })} />Simulate</label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {features.map((id) => {
                      const isCommand = (driver?.commands ?? []).some((c) => c.id === id);
                      const on = allOn || device.enabledFeatures.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-raised text-fg" : "border-border text-subtle")}
                          onClick={async () => {
                            if (isCommand) {
                              const res = await fireCommand({ data: { deviceId: device.id, commandId: id, raw: true, token: token || "" } });
                              flash(res.ok ? id : `${id} failed`, res.message);
                              return;
                            }
                            update((c) => {
                              const d = c.devices[index]!;
                              d.enabledFeatures = on ? d.enabledFeatures.filter((x) => x !== id) : [...d.enabledFeatures, id];
                            });
                          }}
                        >{id}</button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={async () => {
                      if (device.interfaceId) { flash("Local port", "Probe is LAN only."); return; }
                      const probePort = driver?.auth?.pairing?.ports?.[0] ?? device.port ?? driver?.transports.lan?.port;
                      const probePath = driver?.auth?.pairing?.discoverPath || "/";
                      const res = await pingHost(device.host, probePort, probePath);
                      flash(res.ok ? "Reachable" : "No answer", res.message);
                    }}>Probe</Button>
                    {driver?.auth?.pairing ? (
                      <Button size="sm" variant="secondary" onClick={async () => {
                        const res = await authenticate({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth } });
                        const grabbed = res.pairedToken || res.message.match(/Token stored:\s*(\S+)/)?.[1];
                        if (grabbed) update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, token: grabbed, paired: "yes" }; });
                        flash(res.ok ? "Authenticated" : "Auth failed", res.message);
                      }}>Authenticate</Button>
                    ) : null}
                    {driver?.inventory?.resources?.length ? (
                      <Button size="sm" variant="secondary" onClick={async () => {
                        const res = await pullInventory({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth, simulate: device.simulate } });
                        if (res.inventory) update((c) => { c.devices[index]!.inventory = res.inventory; });
                        flash(res.ok ? "Inventory" : "Sync failed", res.message);
                      }}>Sync inventory</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const ports = [...new Set([device.port, driver?.transports.lan?.port, ...(driver?.auth?.pairing?.ports ?? [])].filter((n): n is number => typeof n === "number"))];
                      const res = await debugScan({ data: { token: token || "", host: device.host, ports } });
                      flash(res.ok ? "Open ports" : "No open ports", res.message);
                    }}>Scan ports</Button>
                    <Button size="sm" variant="danger" onClick={() => {
                      const used = deviceInUse(draft, device.id);
                      if (used.length) { flash("In use", used.join(", ")); return; }
                      update((c) => { c.devices = c.devices.filter((d) => d.id !== device.id); });
                    }}>Delete</Button>
                  </div>
                  {driver?.inventory?.resources?.length ? (
                    <InventoryBoard
                      lists={driver.inventory.resources.map((resource) => ({
                        id: resource.id,
                        label: resource.label,
                        items: device.inventory?.[resource.id] ?? [],
                        command: resource.useCommand,
                      }))}
                      onRefresh={async () => {
                        const res = await pullInventory({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth, simulate: device.simulate } });
                        if (res.inventory) update((c) => { c.devices[index]!.inventory = res.inventory; });
                        flash(res.ok ? "Inventory" : "Sync failed", res.message);
                      }}
                      onUse={async (command, id) => {
                        const res = await fireCommand({ data: { deviceId: device.id, commandId: command, value: command === "var.set" ? `${id}=` : id, raw: true, token: token || "" } });
                        flash(res.ok ? command : `${command} failed`, res.message);
                      }}
                    />
                  ) : null}
                  {snap.health?.[device.id] && !snap.health[device.id]!.ok ? (
                    <div className="mt-2 flex items-center gap-2 text-sm text-clay">
                      {snap.health[device.id]!.message}
                      <Button size="sm" variant="secondary" onClick={async () => { await clearDeviceError({ data: { deviceId: device.id, token: token || "" } }); }}>Retry</Button>
                    </div>
                  ) : null}
                  <textarea className={`${fieldClass()} mt-3 min-h-16 font-mono text-xs`} placeholder="Raw payload" id={`raw-${device.id}`} />
                  <Button size="sm" variant="secondary" className="mt-2" onClick={async () => {
                    const el = document.getElementById(`raw-${device.id}`) as HTMLTextAreaElement | null;
                    const res = await debugSend({ data: { token: token || "", deviceId: device.id, payload: el?.value ?? "", host: device.host, port: device.port, driver: device.driver, auth: device.auth } });
                    flash(res.ok ? "Raw reply" : "Raw failed", res.message);
                  }}>Send raw</Button>
                  <ol className="mt-2 max-h-32 overflow-auto font-mono text-[11px] text-muted">
                    {(snap.traces?.[device.id] ?? []).map((line) => (
                      <li key={`${line.at}-${line.dir}`}>{line.dir} {line.text}</li>
                    ))}
                  </ol>
                  </>
                  ) : null}
                </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => {
              const id = `dev-${Date.now().toString(36)}`;
              const driver = Object.keys(snap.drivers)[0] ?? "lg-oled55c3.json";
              c.devices.push({ id, name: "New device", driver, transport: "lan", host: "", auth: {}, enabledFeatures: [], simulate: false });
            })}>Add device</Button>
          </section>
        ) : null}

        {tab === "interfaces" ? (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted">Ports on this machine. Scan, then pick a path.</p>
              <Button size="sm" variant="secondary" onClick={() => scanPorts()}>Scan</Button>
            </div>
            {(draft.interfaces ?? []).map((iface, ii) => {
              const paths = hostPorts.filter((p) => p.kind === iface.kind && !/not detected/i.test(p.label));
              return (
              <article key={iface.id} className="grid gap-2 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-muted">Label
                  <input className={fieldClass()} value={iface.label} onChange={(e) => update((c) => { c.interfaces = c.interfaces ?? []; c.interfaces[ii]!.label = e.target.value; })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">Kind
                <select className={fieldClass()} value={iface.kind} onChange={(e) => update((c) => { c.interfaces![ii]!.kind = e.target.value as typeof iface.kind; })}>
                  <option value="serial">Serial / COM</option>
                  <option value="gpio">GPIO</option>
                  <option value="i2c">I2C</option>
                  <option value="spi">SPI</option>
                  <option value="ir">IR blaster</option>
                  <option value="cec">HDMI CEC</option>
                </select>
                </label>
                {iface.kind === "serial" || iface.kind === "spi" || iface.kind === "ir" ? (
                  <>
                  <label className="grid gap-1 text-sm text-muted">{iface.kind === "serial" ? "Port" : iface.kind === "spi" ? "SPI device" : "IR device"}
                    <select className={fieldClass()} value={paths.some((p) => p.path === iface.path) ? (iface.path ?? "") : ""} onChange={(e) => update((c) => { c.interfaces![ii]!.path = e.target.value; })}>
                      <option value="">{paths.length ? "Select…" : "None found"}</option>
                      {paths.map((p) => <option key={`${p.kind}-${p.path}`} value={p.path}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-muted">Path
                    <input className={fieldClass()} placeholder="/dev/serial0 or COM3" value={iface.path ?? ""} onChange={(e) => update((c) => { c.interfaces![ii]!.path = e.target.value; })} />
                  </label>
                  </>
                ) : null}
                {iface.kind === "gpio" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">GPIO chip
                      <input className={fieldClass()} placeholder="gpiochip0" value={iface.chip ?? "gpiochip0"} onChange={(e) => update((c) => { c.interfaces![ii]!.chip = e.target.value; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">GPIO pin
                      <input className={fieldClass()} type="number" placeholder="17" value={iface.line ?? 0} onChange={(e) => update((c) => { c.interfaces![ii]!.line = Number(e.target.value); })} />
                    </label>
                  </>
                ) : null}
                {iface.kind === "i2c" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">I2C bus
                      <input className={fieldClass()} type="number" placeholder="1" value={iface.bus ?? 1} onChange={(e) => update((c) => { c.interfaces![ii]!.bus = Number(e.target.value); })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">I2C address
                      <input className={fieldClass()} placeholder="0x3c" value={iface.address ?? ""} onChange={(e) => update((c) => { c.interfaces![ii]!.address = e.target.value; })} />
                    </label>
                  </>
                ) : null}
                <Button size="sm" variant="danger" onClick={() => update((c) => { c.interfaces = (c.interfaces ?? []).filter((item) => item.id !== iface.id); c.devices.forEach((d) => { if (d.interfaceId === iface.id) { d.interfaceId = null; d.transport = "lan"; } }); })}>Delete</Button>
              </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => {
              c.interfaces = c.interfaces ?? [];
              const first = hostPorts.find((p) => p.kind === "serial") ?? hostPorts[0];
              c.interfaces.push({ id: `if-${Date.now().toString(36)}`, label: first?.label || "Serial", kind: (first?.kind as "serial") || "serial", path: first?.path || "", baud: 9600 });
            })}>Add interface</Button>
          </section>
        ) : null}

        {tab === "macros" ? (
          <section className="grid gap-3">
            {draft.macros.map((macro, mi) => {
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
                          <select className={cn(fieldClass(), "sm:col-span-3")} value={step.macroId ? "__macro" : step.setVar ? "__var" : (step.device ?? "")} onChange={(e) => update((c) => {
                            const s = c.macros[mi]!.steps[si]!;
                            if (e.target.value === "__var") { s.setVar = draft.variables[0]?.id ?? ""; s.device = undefined; s.macroId = null; }
                            else if (e.target.value === "__macro") { s.macroId = draft.macros.find((m) => m.id !== macro.id)?.id ?? ""; s.device = undefined; s.setVar = null; s.command = undefined; }
                            else { s.setVar = null; s.macroId = null; s.device = e.target.value; s.command = deviceCommands(snap, draft, e.target.value)[0]?.id; }
                          })}>
                            {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            <option value="__macro">Run macro</option>
                            <option value="__var">Set variable</option>
                          </select>
                          {step.macroId ? (
                            <select className={cn(fieldClass(), "sm:col-span-3")} value={step.macroId} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.macroId = e.target.value; })}>
                              {draft.macros.filter((m) => m.id !== macro.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          ) : step.setVar ? (
                            <select className={cn(fieldClass(), "sm:col-span-3")} value={step.setVar} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.setVar = e.target.value; c.macros[mi]!.steps[si]!.command = undefined; })}>
                              {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                            </select>
                          ) : (
                          <select className={cn(fieldClass(), "sm:col-span-3")} value={step.command ?? ""} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.command = e.target.value; })}>
                            {deviceCommands(snap, draft, step.device).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                          )}
                          {(() => {
                            const device = draft.devices.find((d) => d.id === step.device);
                            const drv = device ? snap.drivers[device.driver] : undefined;
                            const inventoryCmds = new Set((drv?.inventory?.resources ?? []).map((r) => r.useCommand).filter(Boolean));
                            const usesInventory = !!step.command && (inventoryCmds.has(step.command) || step.command.startsWith("var."));
                            const needsValue = stepNeedsValue(snap, draft, step) || step.command === "ui.toast" || step.command === "ui.page" || step.command === "ui.block" || step.command === "macro.run";
                            return (
                              <>
                                {usesInventory && device?.inventory && drv?.inventory?.resources?.length ? (
                                  <div className="sm:col-span-12">
                                    <InventoryPicker lists={drv.inventory.resources.map((resource) => ({ id: resource.id, label: resource.label, items: device.inventory?.[resource.id] ?? [], command: resource.useCommand || "var.set" }))} command={step.command} value={String(step.value ?? "").split("=")[0]} onPick={(command, value) => update((c) => { c.macros[mi]!.steps[si]!.command = command; c.macros[mi]!.steps[si]!.value = command === "var.set" ? `${value}=` : value; })} />
                                  </div>
                                ) : null}
                                {needsValue || usesInventory ? (
                                  <label className="grid gap-1 text-xs text-muted sm:col-span-12">Value / message
                                    <input className={fieldClass()} value={String(step.value ?? "")} placeholder="Hello room  or  tvPower=on  or  {var}" onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.value = e.target.value; })} />
                                  </label>
                                ) : null}
                              </>
                            );
                          })()}
                          <label className="grid gap-1 text-xs text-muted sm:col-span-2">Wait ms
                            <input className={fieldClass()} type="number" min={0} step={100} value={step.delayMsAfter ?? 0} onChange={(e) => update((c) => { c.macros[mi]!.steps[si]!.delayMsAfter = Number(e.target.value) || 0; })} />
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
                      <Button size="sm" variant="secondary" onClick={() => update((c) => { c.macros[mi]!.steps.push({ device: draft.devices[0]?.id, command: "power.on", delayMsAfter: 0 }); })}>Add step</Button>
                      <Button size="sm" variant="danger" onClick={() => update((c) => { c.macros = c.macros.filter((m) => m.id !== macro.id); })}>Delete macro</Button>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => { c.macros.push({ id: `macro-${Date.now().toString(36)}`, label: "New macro", retries: 0, onFail: { kind: "none" }, steps: [] }); })}>Add macro</Button>
          </section>
        ) : null}

        {tab === "pages" ? (
          <PagesEditor draft={draft} snap={snap} page={page} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} setPageId={setPageId} update={update} colors={COLORS} fills={COLOR_FILL} />
        ) : null}

        {tab === "logic" ? (
          <div>
            <div className="mb-4 flex gap-1">
              {(["variables", "monitor", "schedule", "triggers"] as const).map((id) => (
                <button key={id} type="button" className={cn("h-10 rounded-md px-3 text-sm capitalize", logicTab === id ? "bg-raised text-fg" : "text-muted")} onClick={() => setLogicTab(id)}>{id}</button>
              ))}
            </div>
            {logicTab === "variables" ? (
              <section className="grid gap-4">
                {(draft.variables ?? []).map((variable, vi) => {
                  const open = openLogic[variable.id] === true;
                  return (
                  <article key={variable.id} className="rounded-xl border border-border bg-surface p-4">
                    <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [variable.id]: !open }))}>
                      <span className="font-medium">{variable.label}</span>
                      <span className="font-mono text-xs text-muted">{String(snap.vars[variable.id] ?? variable.default)}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input className={fieldClass()} value={variable.label} onChange={(e) => update((c) => { c.variables[vi]!.label = e.target.value; })} />
                    <select className={fieldClass()} value={variable.kind} onChange={(e) => update((c) => { c.variables[vi]!.kind = e.target.value as "number" | "enum" | "text"; })}>
                      <option value="number">Number</option>
                      <option value="enum">List</option>
                      <option value="text">Text</option>
                    </select>
                    <label className="grid gap-1 text-sm text-muted">Default
                      <input className={fieldClass()} value={String(variable.default ?? "")} onChange={(e) => update((c) => { c.variables[vi]!.default = variable.kind === "number" ? Number(e.target.value) : e.target.value; })} />
                    </label>
                    {variable.kind === "number" ? (
                      <>
                        <label className="grid gap-1 text-sm text-muted">Min
                          <input className={fieldClass()} type="number" value={variable.min ?? 0} onChange={(e) => update((c) => { c.variables[vi]!.min = Number(e.target.value); })} />
                        </label>
                        <label className="grid gap-1 text-sm text-muted">Max
                          <input className={fieldClass()} type="number" value={variable.max ?? 100} onChange={(e) => update((c) => { c.variables[vi]!.max = Number(e.target.value); })} />
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
                    <Button size="sm" variant="danger" onClick={() => { if (variableInUse(draft, variable.id).length) { flash("In use", ""); return; } update((c) => { c.variables = c.variables.filter((v) => v.id !== variable.id); }); }}>Delete</Button>
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                <Button variant="secondary" onClick={() => update((c) => { c.variables.push({ id: `var-${Date.now().toString(36)}`, label: "New variable", kind: "text", default: "" }); })}>Add variable</Button>
              </section>
            ) : logicTab === "monitor" ? (
              <section className="grid gap-4">
                {(draft.monitors ?? []).map((rule, ri) => {
                  const driver = snap.drivers[draft.devices.find((d) => d.id === rule.device)?.driver ?? ""];
                  const open = openLogic[rule.id] === true;
                  const st = snap.monitorStatus?.[rule.id];
                  const pollLine = st
                    ? `${new Date(st.at).toLocaleTimeString()} · ${st.ok ? "ok" : "error"} · ${st.value || st.message || "—"}`
                    : "No poll yet";
                  return (
                  <article key={rule.id} className="rounded-xl border border-border bg-surface p-4">
                    <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [rule.id]: !open }))}>
                      <span className="font-medium">{rule.label}</span>
                      <span className="min-w-0 truncate text-xs text-muted">{pollLine}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={rule.label} onChange={(e) => update((c) => { c.monitors[ri]!.label = e.target.value; })} /></label>
                    <label className="flex items-center gap-2 text-sm text-muted pt-6">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => update((c) => { c.monitors[ri]!.enabled = e.target.checked; })} />
                      Enabled
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Device
                      <select className={fieldClass()} value={rule.device} onChange={(e) => update((c) => { c.monitors[ri]!.device = e.target.value; })}>
                        {draft.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Feedback
                      <select className={fieldClass()} value={rule.feedback} onChange={(e) => update((c) => { c.monitors[ri]!.feedback = e.target.value; })}>
                        {(driver?.feedback ?? []).map((fb) => <option key={fb.id} value={fb.id}>{fb.label}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Poll ms<input className={fieldClass()} type="number" value={rule.pollMs} onChange={(e) => update((c) => { c.monitors[ri]!.pollMs = Number(e.target.value); })} /></label>
                    <label className="grid gap-1 text-sm text-muted">Write to variable
                      <select className={fieldClass()} value={rule.writeVar ?? ""} onChange={(e) => update((c) => { c.monitors[ri]!.writeVar = e.target.value || null; })}>
                        <option value="">Don’t write</option>
                        {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
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
                    <Button size="sm" variant="danger" onClick={() => update((c) => { c.monitors = c.monitors.filter((m) => m.id !== rule.id); })}>Delete</Button>
                    </div>
                    ) : null}
                  </article>
                  );
                })}
                <Button variant="secondary" onClick={() => update((c) => { c.monitors.push({ id: `mon-${Date.now().toString(36)}`, label: "New monitor", enabled: true, device: c.devices[0]?.id ?? "", feedback: "power.state", pollMs: 4000, writeVar: null, mapMode: "raw", map: [] }); })}>Add monitor</Button>
              </section>
            ) : null}
            {logicTab === "schedule" ? (
              <section className="grid gap-4">
                {(draft.schedules ?? []).map((job, ji) => {
                  const open = openLogic[job.id] === true;
                  return (
                  <article key={job.id} className="rounded-xl border border-border bg-surface p-4">
                    <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [job.id]: !open }))}>
                      <span className="font-medium">{job.label}</span>
                      <span className="text-xs text-muted">{job.time} {job.enabled ? "On" : "Off"}</span>
                    </button>
                    {open ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm text-muted">Label<input className={fieldClass()} value={job.label} onChange={(e) => update((c) => { c.schedules[ji]!.label = e.target.value; })} /></label>
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
                <Button variant="secondary" onClick={() => update((c) => { c.schedules.push({ id: `sch-${Date.now().toString(36)}`, label: "New schedule", enabled: false, time: "08:00", days: [1, 2, 3, 4, 5], macroId: c.macros[0]?.id ?? "" }); })}>Add schedule</Button>
              </section>
            ) : null}
            {logicTab === "triggers" ? (
              <section className="grid gap-3">
                {(draft.triggers ?? []).map((rule, ti) => {
                  const open = openLogic[rule.id] === true;
                  return (
                    <article key={rule.id} className="rounded-xl border border-border bg-surface p-4">
                      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenLogic((cur) => ({ ...cur, [rule.id]: !open }))}>
                        <span className="font-medium">{rule.label}</span>
                        <span className="text-xs text-muted">{rule.mode} · {rule.compare}</span>
                      </button>
                      {open ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm text-muted">Label
                            <input className={fieldClass()} value={rule.label} onChange={(e) => update((c) => { c.triggers![ti]!.label = e.target.value; })} />
                          </label>
                          <label className="grid gap-1 text-sm text-muted">Variable
                            <select className={fieldClass()} value={rule.variable} onChange={(e) => update((c) => { c.triggers![ti]!.variable = e.target.value; })}>
                              {draft.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                            </select>
                          </label>
                          <label className="grid gap-1 text-sm text-muted">When
                            <select className={fieldClass()} value={rule.compare} onChange={(e) => update((c) => { c.triggers![ti]!.compare = e.target.value as typeof rule.compare; })}>
                              <option value="eq">Equals</option>
                              <option value="neq">Not equals</option>
                              <option value="gt">Greater than</option>
                              <option value="lt">Less than</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-sm text-muted">Value
                            <input className={fieldClass()} placeholder="on or {otherVar}" value={rule.equals} onChange={(e) => update((c) => { c.triggers![ti]!.equals = e.target.value; })} />
                          </label>
                          <label className="grid gap-1 text-sm text-muted">Fire
                            <select className={fieldClass()} value={rule.mode} onChange={(e) => update((c) => { c.triggers![ti]!.mode = e.target.value as typeof rule.mode; })}>
                              <option value="change">Only on change</option>
                              <option value="interval">Every interval</option>
                            </select>
                          </label>
                          {rule.mode === "interval" ? (
                            <label className="grid gap-1 text-sm text-muted">Every (s)
                              <input className={fieldClass()} type="number" min={1} value={rule.intervalSec ?? 5} onChange={(e) => update((c) => { c.triggers![ti]!.intervalSec = Math.max(1, Number(e.target.value) || 1); })} />
                            </label>
                          ) : null}
                          <label className="grid gap-1 text-sm text-muted">Must stay true (s)
                            <input className={fieldClass()} type="number" min={0} value={rule.holdSec ?? 0} onChange={(e) => update((c) => { c.triggers![ti]!.holdSec = Math.max(0, Number(e.target.value) || 0); })} />
                            <span className="text-xs">0 = fire as soon as it matches. Vacancy: 600 = 10 min.</span>
                          </label>
                          <label className="grid gap-1 text-sm text-muted">Wait after that (s)
                            <input className={fieldClass()} type="number" min={0} value={rule.delaySec ?? 0} onChange={(e) => update((c) => { c.triggers![ti]!.delaySec = Math.max(0, Number(e.target.value) || 0); })} />
                          </label>
                          <label className="grid gap-1 text-sm text-muted">Macro
                            <select className={fieldClass()} value={rule.macroId} onChange={(e) => update((c) => { c.triggers![ti]!.macroId = e.target.value; })}>
                              {draft.macros.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                          </label>
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
                  c.triggers.push({ id: `trg-${Date.now().toString(36)}`, label: "New trigger", enabled: false, variable: c.variables[0]?.id ?? "", compare: "eq", equals: "on", mode: "change", intervalSec: 5, delaySec: 0, holdSec: 0, macroId: c.macros[0]?.id ?? "" });
                })}>Add trigger</Button>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "drivers" ? (
          <section className="grid gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm text-muted">
                Library
                <select className={fieldClass()} value={libraryPick} onChange={(e) => setLibraryPick(e.target.value)}>
                  <option value="">Select a driver</option>
                  {Object.keys(snap.library ?? {}).filter((name) => !snap.drivers[name]).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" onClick={async () => {
                if (!libraryPick) return;
                const res = await addDriverFromLibrary({ data: { token: token || "", filename: libraryPick } });
                flash(res.ok ? "Added" : "Not added", res.message);
                setLibraryPick("");
                await refresh();
              }}>Add from library</Button>
            </div>
            {Object.entries(snap.drivers).map(([name, spec]) => (
              <article key={name} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="font-medium" onClick={() => { setDriverName(name); setDriverText(JSON.stringify(spec, null, 2)); }}>{name}</button>
                  {pendingDriver === name ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPendingDriver(null)}>Cancel</Button>
                      <Button size="sm" variant="danger" onClick={async () => {
                    const used = driverInUse(draft, name);
                    if (used.length) {
                      flash("In use", used.join(", "));
                      setPendingDriver(null);
                      return;
                    }
                    const res = await deleteDriver({ data: { token: token || "", filename: name } });
                    flash(res.ok ? "Removed from room" : "Not removed", res.message);
                    if (res.ok && driverName === name) setDriverName("");
                    setPendingDriver(null);
                    await refresh();
                      }}>Confirm</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => setPendingDriver(name)}>Delete</Button>
                  )}
                </div>
                {driverName === name ? (
                  <div className="mt-2 grid gap-2">
                    <textarea className={`${fieldClass()} min-h-48 font-mono text-xs`} value={driverText} onChange={(e) => setDriverText(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={async () => {
                        const parsed = JSON.parse(driverText) as DriverSpec;
                        await saveDriver({ data: { token: token || "", filename: name, spec: parsed } });
                        flash("Driver saved", name);
                        await refresh();
                      }}>Save driver</Button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
            <label className="inline-flex h-11 w-fit items-center rounded-md border border-border bg-surface px-4 text-sm">
              Upload JSON
              <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !token) return;
                const spec = JSON.parse(await file.text()) as DriverSpec;
                await saveDriver({ data: { token: token || "", filename: file.name, spec } });
                flash("Uploaded", file.name);
                await refresh();
              }} />
            </label>
          </section>
        ) : null}

        {tab === "log" ? (
          <section className="grid gap-3">
            <div className="flex gap-2">
              <select className={fieldClass()} value={logKind} onChange={(e) => setLogKind(e.target.value)}>
                <option value="all">All</option>
                <option value="command">Commands</option>
                <option value="macro">Macros</option>
                <option value="monitor">Monitors</option>
                <option value="error">Errors</option>
              </select>
              <Button size="sm" variant="secondary" onClick={async () => { await wipeLog({ data: { token: token || "" } }); await refresh(); }}>Clear log</Button>
            </div>
            {(snap.log ?? []).filter((row) => logKind === "all" || row.kind === logKind || (logKind === "error" && !row.ok)).map((row) => (
              <div key={row.id} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <div className="flex justify-between"><span className={row.ok ? "" : "text-clay"}>{row.title}</span><span className="text-[11px] text-subtle">{new Date(row.at).toLocaleTimeString()}</span></div>
                <p className="text-xs text-muted">{row.detail}</p>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function overlaps(widgets: Widget[], x: number, y: number, w: number, h: number, skipId?: string) {
  return widgets.some((item) => item.id !== skipId && x < item.x + item.w && x + w > item.x && y < item.y + item.h && y + h > item.y);
}

function PagesEditor({
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
            <input className={fieldClass()} type="number" min={2} max={12} value={page.grid.cols} onChange={(e) => update((c) => {
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              p.grid.cols = Math.max(2, Math.min(12, Number(e.target.value) || 2));
              c.room.grid.cols = p.grid.cols;
            })} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Rows
            <input className={fieldClass()} type="number" min={2} max={16} value={page.grid.rows} onChange={(e) => update((c) => {
              const p = c.pages.find((item) => item.id === page.id);
              if (!p) return;
              p.grid.rows = Math.max(2, Math.min(16, Number(e.target.value) || 2));
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
                  const w = Math.min(2, page.grid.cols - x);
                  const h = Math.min(2, page.grid.rows - y);
                  if (overlaps(page.widgets, x, y, w, h)) return;
                  update((c) => {
                    const mid = `macro-${Date.now().toString(36)}`;
                    c.macros.push({ id: mid, label: "Button", retries: 0, onFail: { kind: "none" }, steps: [] });
                    c.pages.find((p) => p.id === page.id)?.widgets.push({ id, type: "button", x, y, w, h, label: "Button", color: "steel", confirm: false, bind: { kind: "macro", id: mid, gotoPage: null } });
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
                <input
                  className={fieldClass()}
                  type="number"
                  min={0}
                  value={selected[key]}
                  onChange={(e) => update((c) => {
                    const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id);
                    if (!w) return;
                    w[key] = Math.max(key === "w" || key === "h" ? 1 : 0, Number(e.target.value));
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
              if (name) w.label = name;
            })}>
              {draft.macros.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
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
                <input className={fieldClass()} placeholder="min" value={String(selected.min ?? 0)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.min = e.target.value; })} />
              </label>
              <label className="grid gap-1 text-xs text-muted">Max
                <input className={fieldClass()} placeholder="max" value={String(selected.max ?? 100)} onChange={(e) => update((c) => { const w = c.pages.find((p) => p.id === page.id)?.widgets.find((item) => item.id === selected.id); if (w) w.max = e.target.value; })} />
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
          <div className="grid grid-cols-8 gap-1">
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
              <div key={ri} className="grid grid-cols-[1fr_4.5rem_1fr_auto] gap-1">
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
