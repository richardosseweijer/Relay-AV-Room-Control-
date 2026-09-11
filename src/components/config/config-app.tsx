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
import type { DriverSpec, HostProcessStatus, InventoryItem, RoomConfig, RoomSnapshot, Widget, WidgetColor } from "@/lib/control/types";
import { NONE_MACRO_ID } from "@/lib/control/types";
import { GATEWAY_PROFILES, gatewayProfile, gatewaySlot, isGatewayKind } from "@/lib/control/gateway";
import { deviceInUse, driverInUse, variableInUse, monitorVarId, withMonitorVars } from "@/lib/control/vars";
import { orphanBindings } from "@/lib/control/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COLORS, COLOR_FILL, fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { TAG_ALL, TagBar, currentTag, fileItem, setTags, tagNames, tagOf, tagVisible, type TagBucket, type Tagged } from "./tag-bar";
import { InventoryBoard, InventoryPicker } from "./inventory-board";
import { PagesEditor } from "./pages-editor";
import { LogTab } from "./log-tab";
import { SecurityTab } from "./security-tab";
import { RoomTab } from "./room-tab";
import { InterfacesTab } from "./interfaces-tab";
import { DriversTab } from "./drivers-tab";
import { MacrosTab } from "./macros-tab";
import { LogicTab } from "./logic-tab";
import { DevicesTab } from "./devices-tab";
function downloadRoomFile(draft: RoomConfig, drivers: RoomSnapshot["drivers"]) {
  const config = structuredClone(draft);
  config.room.configPin = "";
  config.room.peerSecret = "";
  config.room.panelPin = config.room.panelAccess === "pin" ? "" : null;
  config.devices = config.devices.map((device) => {
    const auth = { ...(device.auth ?? {}) };
    for (const key of Object.keys(auth)) {
      if (/token|password|secret|key|username|pin/i.test(key)) auth[key] = "";
    }
    return { ...device, auth };
  });
  config.exportedAt = new Date().toISOString();
  config.sourceRoomId = config.room.id;
  const body = JSON.stringify({
    ok: true,
    configVersion: config.configVersion,
    exportedAt: config.exportedAt,
    sourceRoomId: config.room.id,
    config,
    drivers,
  }, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(config.room.name || config.room.id || "room").replace(/[^\w.-]+/g, "-")}-relay.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
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





export function ConfigApp(props: { token: string; onSessionLost?: () => void }) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [draft, setDraft] = useState<RoomConfig | null>(null);
  const token = props.token;
  const [tab, setTab] = useState<"room" | "security" | "drivers" | "devices" | "interfaces" | "macros" | "logic" | "pages" | "log">("room");
  const [logicTab, setLogicTab] = useState<"variables" | "monitor" | "schedule" | "triggers">("variables");
  const [toast, setToast] = useState<{ title: string; body: string; sticky?: boolean } | null>(null);
  const [lockPin, setLockPin] = useState("");
  const [needLock, setNeedLock] = useState(false);
  const [openMacros, setOpenMacros] = useState<Record<string, boolean>>({});
  const [openIfaces, setOpenIfaces] = useState<Record<string, boolean>>({});
  const [openDevices, setOpenDevices] = useState<Record<string, boolean>>({});
  const [openLogic, setOpenLogic] = useState<Record<string, boolean>>({});
  const [tagFilter, setTagFilter] = useState<Record<TagBucket, string>>({
    macros: TAG_ALL, variables: TAG_ALL, monitors: TAG_ALL, schedules: TAG_ALL, triggers: TAG_ALL,
  });
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
      if (ed.ok && "log" in ed && Array.isArray(ed.log)) next.log = ed.log;
      if (ed.ok && ed.config) setDraft((cur) => cur ?? structuredClone(ed.config));
    }
    setSnap(next);
    return next;
  }

  useEffect(() => {
    getEditorConfig({ data: { token } }).then((res) => {
      if (res.ok && res.config) {
        setDraft(structuredClone(res.config));
        setMustChange(Boolean(res.mustChange));
        if (res.paired) setPaired(res.paired);
      }
    }).catch(() => undefined);
    refresh().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    const id = window.setInterval(() => { refresh().catch(() => undefined); }, 8000);
    return () => window.clearInterval(id);
  }, [token]);

  useEffect(() => {
    let misses = 0;
    const tick = async () => {
      const res = await getEditorConfig({ data: { token } }).catch(() => ({ ok: false as const }));
      if (res.ok) {
        misses = 0;
        return;
      }
      misses += 1;
      if (misses >= 3) props.onSessionLost?.();
    };
    const id = window.setInterval(() => { tick().catch(() => undefined); }, 8000);
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "pastel" ? "#3a2a32" : "#0a0a0b");
  }, [draft?.room.theme, snap?.config.room.theme]);

  function update(mut: (c: RoomConfig) => void) {
    if (!draft) return;
    const next = structuredClone(draft);
    mut(next);
    setDraft(next);
  }

  function tagBarFor(bucket: TagBucket) {
    const prefix = bucket === "macros" ? "macro:" : bucket === "variables" ? "var:" : bucket === "monitors" ? "mon:" : bucket === "schedules" ? "sch:" : "trg:";
    return {
      names: tagNames(draft!, bucket),
      filter: tagFilter[bucket],
      onFilter: (id: string) => setTagFilter((cur) => ({ ...cur, [bucket]: id })),
      onReorder: (from: string, onto: string) => update((c) => {
        const names = tagNames(c, bucket);
        const i = names.indexOf(from);
        const j = names.indexOf(onto);
        if (i < 0 || j < 0 || i === j) return;
        const [row] = names.splice(i, 1);
        if (row) names.splice(j, 0, row);
        setTags(c, bucket, names);
      }),
      onFile: (raw: string, tag: string) => {
        if (!raw.startsWith(prefix)) return;
        update((c) => fileItem(c, bucket, raw.slice(prefix.length), tag));
      },
      onCreate: (name: string) => {
        update((c) => {
          const names = tagNames(c, bucket);
          if (!names.includes(name)) setTags(c, bucket, [...names, name]);
        });
        setTagFilter((cur) => ({ ...cur, [bucket]: name }));
      },
      onRemove: (name: string) => {
        update((c) => {
          const clear = (item: Tagged) => {
            if (tagOf(item) === name) { item.tag = null; item.folder = undefined; }
          };
          if (bucket === "macros") c.macros.forEach(clear);
          if (bucket === "variables") c.variables.forEach(clear);
          if (bucket === "monitors") c.monitors.forEach(clear);
          if (bucket === "schedules") c.schedules.forEach(clear);
          if (bucket === "triggers") (c.triggers ?? []).forEach(clear);
          setTags(c, bucket, tagNames(c, bucket).filter((n) => n !== name));
        });
        setTagFilter((cur) => ({ ...cur, [bucket]: TAG_ALL }));
      },
    };
  }

  async function persist(nextToken = token) {
    if (!draft || !nextToken) return;
    const res = await saveConfig({ data: { token: nextToken, config: draft } }) as { ok: boolean; message?: string };
    flash(res.ok ? "Saved" : "Save failed", res.message ?? "");
    await refresh();
  }

  const page = draft?.pages.find((p) => p.id === pageId) ?? draft?.pages[0];
  const selected = page?.widgets.find((w) => w.id === selectedId) ?? null;

  if (!draft?.room || !snap || !page) return <main className="flex min-h-dvh items-center justify-center bg-bg text-muted">Loading config…</main>;

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
                sessionStorage.setItem("relay-config-token", check.token);
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 [overflow-wrap:anywhere]">
            <Link to="/" onClick={() => sessionStorage.removeItem("relay-config-token")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
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
                  props.onSessionLost?.();
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
          {(["room", "security", "drivers", "devices", "interfaces", "macros", "logic", "pages", "log"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn("h-10 rounded-md px-3 text-sm capitalize", tab === id ? "bg-accent text-accent-fg" : "text-muted")}>{id}</button>
          ))}
        </nav>
      </header>

      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto px-4 py-6">
        {tab === "room" ? (
          <RoomTab draft={draft} snap={snap} token={token || ""} update={update} flash={flash} refresh={refresh} setDraft={setDraft} importRef={importRef} setGate={setGate} downloadRoomFile={downloadRoomFile} />
        ) : null}

        {tab === "security" ? (
          <SecurityTab draft={draft} token={token || ""} update={update} flash={flash} paired={paired} setPaired={setPaired} />
        ) : null}

        {tab === "devices" ? (
          <DevicesTab draft={draft} snap={snap} token={token || ""} update={update} flash={flash} refresh={refresh} openDevices={openDevices} setOpenDevices={setOpenDevices} reach={reach} />
        ) : null}

        {tab === "interfaces" ? (
          <InterfacesTab draft={draft} token={token || ""} update={update} flash={flash} openIfaces={openIfaces} setOpenIfaces={setOpenIfaces} hostPorts={hostPorts} scanPorts={scanPorts} />
        ) : null}

        {tab === "macros" ? (
          <MacrosTab draft={draft} snap={snap} token={token || ""} update={update} flash={flash} openMacros={openMacros} setOpenMacros={setOpenMacros} tagFilter={tagFilter} tagBarFor={tagBarFor} />
        ) : null}

        {tab === "pages" ? (
          <PagesEditor draft={draft} snap={snap} page={page} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} setPageId={setPageId} update={update} colors={COLORS} fills={COLOR_FILL} />
        ) : null}

        {tab === "logic" ? (
          <LogicTab draft={draft} snap={snap} update={update} flash={flash} openLogic={openLogic} setOpenLogic={setOpenLogic} tagFilter={tagFilter} tagBarFor={tagBarFor} logicTab={logicTab} setLogicTab={setLogicTab} />
        ) : null}

        {tab === "drivers" ? (
          <DriversTab draft={draft} snap={snap} token={token || ""} flash={flash} refresh={refresh} driverName={driverName} setDriverName={setDriverName} driverText={driverText} setDriverText={setDriverText} libraryPick={libraryPick} setLibraryPick={setLibraryPick} pendingDriver={pendingDriver} setPendingDriver={setPendingDriver} />
        ) : null}

        {tab === "log" ? (
          <LogTab snap={snap} token={token || ""} setSnap={setSnap} refresh={refresh} />
        ) : null}
      </div>
    </main>
  );
}
