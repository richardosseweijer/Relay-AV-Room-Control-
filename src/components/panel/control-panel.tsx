import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Maximize2, Settings2, Sun } from "lucide-react";
import { checkPanelSession, clearDeviceError, fireCommand, fireMacro, issuePanelSession, setLatch, setVariable, verifyPanelPin } from "@/lib/control/actions";
import type { RoomSnapshot, Widget } from "@/lib/control/types";
import { resolveBoundNumber } from "@/lib/control/vars";
import { nextScheduled } from "@/lib/control/schedule";
import { Button } from "@/components/ui/button";
import { WidgetShell } from "./widget-face";
import { cn } from "@/lib/utils";

function readFeedback(snap: RoomSnapshot, device?: string, feedback?: string) {
  if (!device || !feedback) return "";
  return snap.state[device]?.[feedback] ?? "—";
}

function compareValue(have: string, op: string | undefined, want: string) {
  const left = have.trim().toLowerCase();
  const right = want.trim().toLowerCase();
  const ln = Number(have);
  const rn = Number(want);
  const numeric = Number.isFinite(ln) && Number.isFinite(rn) && have !== "" && want !== "";
  switch (op) {
    case "neq": return left !== right;
    case "gt": return numeric ? ln > rn : left > right;
    case "lt": return numeric ? ln < rn : left < right;
    case "gte": return numeric ? ln >= rn : left >= right;
    case "lte": return numeric ? ln <= rn : left <= right;
    default: return left === right;
  }
}

function clauseOk(snap: RoomSnapshot, clause: { variable?: string | null; device?: string; feedback?: string; op?: string; equals: string }) {
  if (clause.variable) return compareValue(String(snap.vars[clause.variable] ?? ""), clause.op, clause.equals);
  if (clause.device && clause.feedback) return compareValue(String(snap.state[clause.device]?.[clause.feedback] ?? ""), clause.op, clause.equals);
  return true;
}

function enabled(snap: RoomSnapshot, widget: Widget) {
  const rule = widget.enableWhen;
  if (!rule) return true;
  const rows = rule.all?.length ? rule.all : (rule.variable || rule.device ? [rule] : []);
  if (!rows.length) return true;
  return rows.every((row) => clauseOk(snap, row));
}

function friendlyError(raw: string, snap: RoomSnapshot) {
  const device = snap.config.devices.find((d) => raw.includes(d.id));
  const name = device?.name ?? "Device";
  if (/timeout|did not finish|abort/i.test(raw)) return `${name} didn’t answer`;
  if (/refused|ECONNREFUSED|unreachable/i.test(raw)) return `${name} isn’t on the network`;
  if (/Allow|link button|pair/i.test(raw)) return `${name} needs permission`;
  if (/Blocked/i.test(raw)) return `${name} isn’t ready`;
  if (/token/i.test(raw)) return `${name} needs pairing`;
  return `${name} didn’t finish`;
}

function commandIsActive(snap: RoomSnapshot, widget: Widget) {
  const device = widget.bind.device;
  const command = widget.bind.command;
  if (!device || !command) return false;
  const slot = snap.state[device] ?? {};
  const [head, tail] = command.split(".");
  if (!head || !tail) return false;
  if (tail === "on" || tail === "off") return String(slot[`${head}.state`] ?? "") === tail;
  const current = slot[`${head}.current`];
  if (current !== undefined) return String(current) === tail;
  return false;
}

function sliderVariable(snap: RoomSnapshot, widget: Widget): string | undefined {
  if (widget.latchGroup) {
    const latchedId = (snap.latches ?? {})[widget.latchGroup];
    const source = snap.config.pages.flatMap((p) => p.widgets).find((w) => w.id === latchedId);
    const macro = snap.config.macros.find((m) => m.id === source?.bind.id);
    for (const step of macro?.steps ?? []) {
      const token = String(step.value ?? "").match(/\{([^}]+)\}/);
      if (token?.[1] && snap.config.variables.some((v) => v.id === token[1] && v.kind === "number")) return token[1];
      if (step.setVar && snap.config.variables.some((v) => v.id === step.setVar && v.kind === "number")) return step.setVar;
    }
    if (source?.bind.variable) return source.bind.variable;
  }
  return widget.bind.variable ?? undefined;
}

function widgetActive(snap: RoomSnapshot, widget: Widget, confirming: boolean) {
  if (confirming) return true;
  if (widget.highlight === "off") return false;
  if (widget.highlight === "latch" || widget.latchGroup) {
    const group = widget.latchGroup || widget.id;
    return (snap.latches ?? {})[group] === widget.id;
  }
  if (widget.enableWhen) return enabled(snap, widget);
  if (widget.bind.kind === "macro" && widget.bind.id) return snap.activeScene === widget.bind.id;
  if (widget.bind.kind === "command") return commandIsActive(snap, widget);
  return false;
}

export function ControlPanel() {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [pageId, setPageId] = useState("home");
  const [pin, setPin] = useState("");
  const [locked, setLocked] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Widget | null>(null);
  const [dim, setDim] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [block, setBlock] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [session, setSession] = useState("");
  const [drag, setDrag] = useState<Record<string, number>>({});
  const dragRef = useRef<Record<string, number>>({});
  const slideTimer = useRef<number | null>(null);
  const misses = useRef(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const seenToastAt = useRef(0);
  const seenPageAt = useRef(0);

  useEffect(() => {
    if (!snap?.host) return;
    if (snap.host.dim) setDim(true);
    const at = snap.host.toastAt ?? 0;
    if (snap.host.toast && at > seenToastAt.current) {
      seenToastAt.current = at;
      setNote(snap.host.toast);
    }
    if (!snap.host.toast && at > seenToastAt.current) {
      seenToastAt.current = at;
      setNote(null);
    }
    setBlock(snap.host.block || null);
    const pageAt = snap.host.pageAt ?? 0;
    if (snap.host.pageId && pageAt > seenPageAt.current) {
      seenPageAt.current = pageAt;
      setPageId(snap.host.pageId);
    }
  }, [snap?.host?.dim, snap?.host?.toast, snap?.host?.toastAt, snap?.host?.block, snap?.host?.pageId, snap?.host?.pageAt]);

  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [legal, setLegal] = useState(false);
  const [full, setFull] = useState(false);
  const [awake, setAwake] = useState(false);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  useEffect(() => {
    let gone = false;
    async function grab() {
      if (gone || !awake || document.visibilityState !== "visible") return;
      const api = (navigator as Navigator & { wakeLock?: { request: (kind: "screen") => Promise<{ release: () => Promise<void>; addEventListener: (ev: string, fn: () => void) => void }> } }).wakeLock;
      if (!api) return;
      try {
        const lock = await api.request("screen");
        if (gone) {
          await lock.release().catch(() => undefined);
          return;
        }
        wakeRef.current = lock;
        lock.addEventListener("release", () => {
          wakeRef.current = null;
          if (!gone) setAwake(false);
        });
      } catch {
        if (!gone) setAwake(false);
      }
    }
    if (!awake) {
      void wakeRef.current?.release().catch(() => undefined);
      wakeRef.current = null;
    } else void grab();
    const onVis = () => {
      if (document.visibilityState !== "visible") setAwake(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [awake]);

  async function refresh() {
    try {
      const res = await fetch("/api/room", { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`Room ${res.status}`);
      const next = await res.json().catch(() => null) as RoomSnapshot | null;
      if (!next?.config?.room) throw new Error("Room file unreadable");
      misses.current = 0;
      setOffline(false);
      setLoadErr(null);
      setSnap(next);
      return next;
    } catch (err) {
      misses.current += 1;
      if (misses.current >= 2) setOffline(true);
      setLoadErr(err instanceof Error ? err.message : "Room unreachable");
      return snap;
    }
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      const issued = await issuePanelSession();
      if (issued.token) setSession(issued.token);
      const stored = sessionStorage.getItem("relay-panel-token");
      if (!issued.token && stored) {
        const check = await checkPanelSession({ data: { token: stored } });
        if (check.ok) setSession(stored);
        else sessionStorage.removeItem("relay-panel-token");
      }
      const next = await refresh();
      if (cancel) return;
      if (next?.config?.room.panelAccess === "pin") {
        const token = sessionStorage.getItem("relay-panel-token");
        const ok = token ? (await checkPanelSession({ data: { token } })).ok : false;
        if (ok && token) setSession(token);
        setLocked(!ok);
      }
    })();
    const tick = () => {
      if (Object.keys(dragRef.current).length) return;
      refresh().catch(() => undefined);
    };
    const t = setInterval(tick, 1500);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      cancel = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  useEffect(() => {
    if (!snap?.config?.room) return;
    const sec = snap.config.room.idleDimSeconds;
    if (!sec || sec <= 0) return;
    const ms = sec * 1000;
    let timer = window.setTimeout(() => setDim(true), ms);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDim(true), ms);
    };
    window.addEventListener("pointerdown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
    };
  }, [snap?.config?.room?.idleDimSeconds]);

  const page = useMemo(() => snap?.config?.pages?.find((p) => p.id === pageId) ?? snap?.config?.pages?.[0], [snap, pageId]);

  function applyHostPreview(commandId?: string, value?: string | number) {
    if (!commandId) return;
    if (commandId === "display.dim") setDim(true);
    if (commandId === "display.wake") setDim(false);
    if (commandId === "panel.lock") setLocked(true);
    if (commandId === "panel.unlock") setLocked(false);
    if (commandId === "ui.toast") { seenToastAt.current = Date.now(); setNote(String(value ?? "")); }
    if (commandId === "ui.block") setBlock(String(value ?? ""));
    if (commandId === "ui.unblock") setBlock(null);
    if (commandId === "ui.clear") { seenToastAt.current = Date.now(); setNote(null); }
    if (commandId === "ui.page" && value) setPageId(String(value));
  }

  async function run(widget: Widget) {
    if (!snap) return;
    if (dim) {
      setDim(false);
      return;
    }
    if (widget.type === "status" || widget.type === "label" || widget.type === "schedule") return;
    if (!enabled(snap, widget)) return;
    if (widget.confirm && confirm?.id !== widget.id) {
      setConfirm(widget);
      return;
    }
    setConfirm(null);
    setBusyId(widget.id);
    setNote(null);
    if (widget.bind.kind === "command") applyHostPreview(widget.bind.command, widget.bind.value);
    if (widget.bind.kind === "macro" && widget.bind.id) {
      const macro = snap.config.macros.find((m) => m.id === widget.bind.id);
      for (const step of macro?.steps ?? []) {
        const dev = snap.config.devices.find((d) => d.id === step.device);
        if (dev?.driver !== "relay-host.json") continue;
        if (step.command === "ui.unblock" || step.command === "ui.clear" || step.command === "ui.toast") continue;
        applyHostPreview(step.command, step.value);
        if (step.command === "ui.block") break;
      }
    }
    try {
      let ok = true;
      if (widget.bind.kind === "gotoPage" && widget.bind.id) {
        setPageId(widget.bind.id);
        return;
      }
      if (widget.bind.kind === "macro" && widget.bind.id) {
        const res = await fireMacro({ data: { macroId: widget.bind.id, token: session } });
        ok = res.ok;
        if (!res.ok) setNote(friendlyError(res.message, snap));
        const fail = snap.config.macros.find((m) => m.id === widget.bind.id)?.onFail;
        if (!res.ok && fail?.kind === "gotoPage" && fail.id) setPageId(fail.id);
      }
      if ((widget.bind.kind === "command" || widget.bind.kind === "range") && widget.bind.device && widget.bind.command) {
        const res = await fireCommand({
          data: { deviceId: widget.bind.device, commandId: widget.bind.command, value: widget.bind.value, token: session },
        });
        ok = res.ok;
        if (!res.ok) setNote(friendlyError(res.message, snap));
      }
      if (ok && (widget.highlight === "latch" || widget.latchGroup)) {
        await setLatch({ data: { group: widget.latchGroup || widget.id, widgetId: widget.id, token: session } });
      }
      if (ok && widget.bind.gotoPage) setPageId(widget.bind.gotoPage);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  function sendSlide(widget: Widget, value: number) {
    void (async () => {
      const varId = sliderVariable(snap!, widget);
      if (widget.bind.device && widget.bind.command) {
        await fireCommand({
          data: { deviceId: widget.bind.device, commandId: widget.bind.command, value, variable: varId, token: session },
        });
      } else if (varId) {
        await setVariable({ data: { id: varId, value, token: session } });
      }
      await refresh();
      setDrag((cur) => {
        const next = { ...cur };
        delete next[widget.id];
        dragRef.current = next;
        return next;
      });
    })();
  }

  function slide(widget: Widget, value: number, flush = false) {
    if (dim) {
      setDim(false);
      return;
    }
    setDrag((cur) => {
      const next = { ...cur, [widget.id]: value };
      dragRef.current = next;
      return next;
    });
    if (!flush) return;
    if (slideTimer.current) window.clearTimeout(slideTimer.current);
    sendSlide(widget, value);
  }

  if (!snap?.config?.room || !page) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg text-muted">
        <p>{loadErr ?? "Loading room…"}</p>
        {loadErr ? (
          <button type="button" className="rounded-md border border-border px-3 py-2 text-fg" onClick={() => refresh()}>
            Retry
          </button>
        ) : null}
      </main>
    );
  }

  if (locked || snap.host?.locked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 bg-bg px-6">
        <p className="text-[11px] tracking-[0.28em] uppercase text-subtle">Relay</p>
        <h1 className="text-4xl font-medium tracking-tight">{snap.config.room.name}</h1>
        <p className="text-sm text-muted">PIN to open the room.</p>
        <input
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="h-14 rounded-2xl border border-border bg-surface px-4 text-center text-2xl tracking-[0.5em]"
          placeholder="••••"
        />
        <Button
          onClick={async () => {
            const res = await verifyPanelPin({ data: { pin } });
            if (res.ok && res.token) {
              sessionStorage.setItem("relay-panel-token", res.token);
              setSession(res.token);
              setLocked(false);
            } else setNote("Wrong PIN");
          }}
        >
          Unlock
        </Button>
        <Link to="/config" className="text-center text-sm text-muted underline-offset-4 hover:underline">Configurator</Link>
      </main>
    );
  }

  const faults = Object.entries(snap.health ?? {}).filter(([, row]) => !row.ok);

  return (
    <main
      className={cn("relative flex min-h-dvh flex-col bg-bg px-3 pb-16 pt-4 sm:px-8", dim && "opacity-25")}
      onPointerDownCapture={(e) => {
        if (!dim) return;
        e.preventDefault();
        e.stopPropagation();
        setDim(false);
      }}
    >
      <header className="mx-auto mb-5 flex w-full max-w-3xl items-end justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.22em] uppercase text-subtle">
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
          {snap.runningMacro ? <p className="mt-1 text-sm text-muted">Just a moment…</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {!awake ? (
            <button
              type="button"
              className="inline-flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/80 text-subtle"
              aria-label="Keep awake"
              onClick={() => setAwake(true)}
            >
              <Sun className="size-4" />
            </button>
          ) : null}
          {!full ? (
            <button
              type="button"
              className="inline-flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/80 text-subtle"
              aria-label="Fullscreen"
              onClick={async () => {
                const node = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
                try {
                  if (node.requestFullscreen) await node.requestFullscreen();
                  else node.webkitRequestFullscreen?.();
                } catch { /* iOS home-screen app only */ }
              }}
            >
              <Maximize2 className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/80 text-subtle"
            onClick={() => {
              sessionStorage.removeItem("relay-config-token");
              void navigate({ to: "/config" });
            }}
            aria-label="Setup"
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>
      {faults.length ? (
        <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-clay/40 bg-clay/10 px-3 py-2">
          <p className="flex-1 text-sm text-clay">
            {faults.map(([id]) => snap.config.devices.find((d) => d.id === id)?.name ?? "Device").join(", ")} isn’t answering
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await clearDeviceError({ data: {} });
              await refresh();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <section
        className="mx-auto grid w-full max-w-3xl gap-3"
        style={{
          gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${page.grid.rows}, minmax(5rem, 5rem))`,
        }}
      >
        {page.widgets.map((widget) => {
          const on = enabled(snap, widget);
          const varId = sliderVariable(snap, widget);
          const value = varId
            ? String(snap.vars[varId] ?? widget.bind.value ?? "")
            : widget.bind.variable
            ? String(snap.vars[widget.bind.variable] ?? widget.bind.value ?? "")
            : widget.bind.kind === "variable"
              ? String(snap.vars[widget.bind.variable ?? ""] ?? "—")
            : readFeedback(snap, widget.bind.device, widget.bind.feedback);
          const lit = widgetActive(snap, widget, confirm?.id === widget.id);
          const waiting = busyId === widget.id;
          if (widget.type === "slider") {
            const num = Number(value || 0);
            const min = resolveBoundNumber(widget.min, snap.vars ?? {}, 0, snap.config.variables);
            const max = resolveBoundNumber(widget.max, snap.vars ?? {}, 100, snap.config.variables);
            const live = drag[widget.id];
            const shown = live ?? (Number.isFinite(num) ? num : min);
            const clamped = Math.min(max, Math.max(min, shown));
            return (
              <div
                key={widget.id}
                className="flex flex-col justify-between rounded-2xl border border-border/70 bg-surface/80 px-4 py-3"
                style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] tracking-[0.16em] uppercase text-muted">{widget.label}</span>
                  <span className="text-2xl font-medium tabular-nums tracking-tight">{clamped}</span>
                </div>
                <input
                  type="range"
                  disabled={!on}
                  min={min}
                  max={max}
                  value={clamped}
                  onChange={(e) => slide(widget, Number(e.target.value))}
                  onPointerUp={(e) => slide(widget, Number((e.target as HTMLInputElement).value), true)}
                  onPointerCancel={(e) => slide(widget, Number((e.target as HTMLInputElement).value), true)}
                  className="panel-slider w-full"
                />
              </div>
            );
          }
          if (widget.type === "label") {
            return (
              <div
                key={widget.id}
                className="flex items-center rounded-lg px-3 text-sm text-muted"
                style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
              >
                {widget.label}
              </div>
            );
          }
          if (widget.type === "schedule") {
            const upcoming = nextScheduled(snap.config.schedules, snap.config.room.network?.timezone);
            return (
              <div
                key={widget.id}
                style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
              >
                <WidgetShell widget={{ ...widget, label: widget.label === "Next" || widget.label === "Button" || !widget.label ? "Next scheduled task:" : widget.label }}>
                  {upcoming ? (
                    <span className="flex flex-col gap-1">
                      <span className="text-xl font-medium leading-tight">{upcoming.label}</span>
                      <span className="text-base text-muted">{upcoming.when}</span>
                    </span>
                  ) : (
                    <span className="text-xl font-medium">Nothing scheduled</span>
                  )}
                </WidgetShell>
              </div>
            );
          }
          return (
            <div
              key={widget.id}
              style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
            >
              <WidgetShell
                widget={widget}
                disabled={!on}
                active={lit || waiting}
                onClick={() => run(widget)}
              >
                {widget.type === "status"
                  ? String(value)
                  : confirm?.id === widget.id
                    ? "Confirm?"
                    : waiting
                      ? "…"
                      : ""}
              </WidgetShell>
            </div>
          );
        })}
      </section>

      {offline ? (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-bg/95 px-8 text-center">
          <p className="max-w-4xl text-4xl font-medium leading-tight tracking-tight text-clay sm:text-6xl">Controller unreachable</p>
          <p className="mt-6 text-sm text-muted">Waiting for the room host…</p>
        </div>
      ) : null}
      {note ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg/95 px-8 text-center"
          onClick={() => setNote(null)}
        >
          <p className="max-w-4xl text-4xl font-medium leading-tight tracking-tight sm:text-6xl">{note}</p>
          <p className="mt-8 text-sm tracking-[0.18em] uppercase text-subtle">Tap to dismiss</p>
        </button>
      ) : null}
      {block ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/95 px-8 text-center">
          <p className="max-w-4xl text-4xl font-medium leading-tight tracking-tight text-clay sm:text-6xl">{block}</p>
        </div>
      ) : null}

      <p className="pointer-events-none absolute bottom-4 right-5 text-[10px] tracking-[0.22em] uppercase text-subtle">
        {snap.config.room.name}
      </p>
      <button
        type="button"
        className="absolute bottom-3 left-4 z-20 size-9 rounded-full border border-border/70 bg-surface/80 text-sm text-muted"
        onClick={() => setLegal(true)}
        aria-label="Licenses"
      >
        i
      </button>
      {legal ? (
        <button type="button" className="fixed inset-0 z-50 overflow-auto bg-bg/96 px-6 py-10 text-left" onClick={() => setLegal(false)}>
          <article className="mx-auto max-w-lg space-y-3 text-sm leading-relaxed text-muted" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg text-fg">Relay</h2>
            <p>This software incorporates open-source components, including React, TanStack Router, Radix UI, Lucide, Tailwind CSS, Zod, and PGLite. Those components remain the property of their authors and are used under their respective licenses.</p>
            <p>Brand and model names that appear in drivers belong to their owners. Listing a device here only means Relay can address it. It is not a partnership or a certification.</p>
            <p>Control interfaces follow what each product documents or commonly exposes. Behaviour can differ by firmware.</p>
            <p>Relay is meant to stay on a private network. Do not publish this interface on the public internet.</p>
            <p>Layouts, tokens and logs are stored on this host. Relay does not upload the room to a cloud service.</p>
            <button type="button" className="mt-4 rounded-md border border-border px-3 py-2 text-fg" onClick={() => setLegal(false)}>Close</button>
          </article>
        </button>
      ) : null}
    </main>
  );
}
