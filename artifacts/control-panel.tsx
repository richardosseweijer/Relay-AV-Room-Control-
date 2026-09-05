import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { clearDeviceError, fireCommand, fireMacro, getRoomState, verifyPanelPin } from "@/lib/control/actions";
import type { RoomSnapshot, Widget } from "@/lib/control/types";
import { resolveBoundNumber } from "@/lib/control/vars";
import { Button } from "@/components/ui/button";
import { WidgetShell } from "./widget-face";
import { cn } from "@/lib/utils";

function readFeedback(snap: RoomSnapshot, device?: string, feedback?: string) {
  if (!device || !feedback) return "";
  return snap.state[device]?.[feedback] ?? "—";
}

function enabled(snap: RoomSnapshot, widget: Widget) {
  const deviceId = widget.bind.device || widget.enableWhen?.device;
  if (deviceId && snap.health?.[deviceId] && !snap.health[deviceId]!.ok) return false;
  const rule = widget.enableWhen;
  if (!rule) return true;
  if (rule.variable) return String(snap.vars[rule.variable] ?? "") === rule.equals;
  if (!rule.device || !rule.feedback) return true;
  return String(snap.state[rule.device]?.[rule.feedback] ?? "") === rule.equals;
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

function widgetActive(snap: RoomSnapshot, widget: Widget, confirming: boolean) {
  if (confirming) return true;
  if (widget.bind.kind === "macro" && widget.bind.id) return snap.activeScene === widget.bind.id;
  if (widget.bind.kind === "command") return commandIsActive(snap, widget);
  return false;
}

export function ControlPanel() {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [pageId, setPageId] = useState("home");
  const [pin, setPin] = useState("");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Widget | null>(null);
  const [dim, setDim] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    const next = await getRoomState();
    setSnap(next);
    return next;
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      const next = await refresh();
      if (cancel) return;
      if (next.config.room.panelAccess === "pin") {
        const stored = sessionStorage.getItem("relay-panel-token");
        setLocked(!stored);
      }
    })();
    const t = setInterval(() => {
      refresh().catch(() => undefined);
    }, 1200);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!snap) return;
    const ms = Math.max(20, snap.config.room.idleDimSeconds) * 1000;
    let timer = window.setTimeout(() => setDim(true), ms);
    const bump = () => {
      setDim(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDim(true), ms);
    };
    window.addEventListener("pointerdown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
    };
  }, [snap?.config.room.idleDimSeconds]);

  const page = useMemo(() => snap?.config.pages.find((p) => p.id === pageId) ?? snap?.config.pages[0], [snap, pageId]);

  async function run(widget: Widget) {
    if (!snap) return;
    if (widget.type === "status" || widget.type === "label") return;
    if (!enabled(snap, widget)) return;
    if (widget.confirm && confirm?.id !== widget.id) {
      setConfirm(widget);
      return;
    }
    setConfirm(null);
    setBusy(true);
    setNote(null);
    try {
      if (widget.bind.kind === "gotoPage" && widget.bind.id) {
        setPageId(widget.bind.id);
        return;
      }
      if (widget.bind.kind === "macro" && widget.bind.id) {
        const res = await fireMacro({ data: { macroId: widget.bind.id } });
        if (!res.ok) setNote(res.message);
        if (snap.config.macros.find((m) => m.id === widget.bind.id)?.onFail.kind === "gotoPage") {
          const fail = snap.config.macros.find((m) => m.id === widget.bind.id)?.onFail.id;
          if (!res.ok && fail) setPageId(fail);
        }
      }
      if ((widget.bind.kind === "command" || widget.bind.kind === "range") && widget.bind.device && widget.bind.command) {
        const res = await fireCommand({
          data: {
            deviceId: widget.bind.device,
            commandId: widget.bind.command,
            value: widget.bind.value,
          },
        });
        if (!res.ok) setNote(res.message);
      }
      if (widget.bind.gotoPage) setPageId(widget.bind.gotoPage);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function slide(widget: Widget, value: number) {
    if (!widget.bind.device || !widget.bind.command) return;
    setBusy(true);
    await fireCommand({
      data: {
        deviceId: widget.bind.device,
        commandId: widget.bind.command,
        value,
        variable: widget.bind.variable,
      },
    });
    await refresh();
    setBusy(false);
  }

  if (!snap || !page) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        Loading room…
      </main>
    );
  }

  if (locked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Relay</p>
        <h1 className="text-3xl font-medium tracking-tight">{snap.config.room.name}</h1>
        <p className="text-sm text-muted">Enter the panel PIN to open this room.</p>
        <input
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="h-12 rounded-md border border-border bg-surface px-3 text-lg tracking-[0.4em]"
          placeholder="••••"
        />
        <Button
          onClick={async () => {
            const res = await verifyPanelPin({ data: { pin } });
            if (res.ok && res.token) {
              sessionStorage.setItem("relay-panel-token", res.token);
              setLocked(false);
            } else setNote("Wrong PIN");
          }}
        >
          Unlock
        </Button>
        {note ? <p className="text-sm text-clay">{note}</p> : null}
      </main>
    );
  }

  return (
    <main className={cn("relative flex min-h-dvh flex-col bg-bg px-3 pb-14 pt-3 sm:px-6", dim && "opacity-40")}>
      <header className="mx-auto mb-3 flex w-full max-w-3xl items-center justify-end gap-2">
        {snap.runningMacro ? <span className="mr-auto text-xs text-muted">Running…</span> : <span className="mr-auto" />}
        <Link to="/config" className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-muted">
          <Settings2 className="size-4" />
        </Link>
      </header>
      {Object.entries(snap.health ?? {}).some(([, row]) => !row.ok) ? (
        <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border border-clay/40 bg-clay/10 px-3 py-2">
          <p className="flex-1 text-sm text-clay">
            {Object.entries(snap.health)
              .filter(([, row]) => !row.ok)
              .map(([id]) => snap.config.devices.find((d) => d.id === id)?.name ?? id)
              .join(", ")}{" "}
            flagged in error
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await clearDeviceError({ data: {} });
              await refresh();
            }}
          >
            Clear errors
          </Button>
        </div>
      ) : null}

      <section
        className="mx-auto grid w-full max-w-3xl gap-2"
        style={{
          gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${page.grid.rows}, minmax(4.4rem, 4.4rem))`,
        }}
      >
        {page.widgets.map((widget) => {
          const on = enabled(snap, widget);
          const value = widget.bind.kind === "variable"
            ? String(snap.vars[widget.bind.variable ?? ""] ?? "—")
            : readFeedback(snap, widget.bind.device, widget.bind.feedback);
          const lit = widgetActive(snap, widget, confirm?.id === widget.id);
          if (widget.type === "slider") {
            const num = Number(value || 0);
            const min = resolveBoundNumber(widget.min, snap.vars ?? {}, 0, snap.config.variables);
            const max = resolveBoundNumber(widget.max, snap.vars ?? {}, 100, snap.config.variables);
            const clamped = Math.min(max, Math.max(min, Number.isFinite(num) ? num : min));
            return (
              <div
                key={widget.id}
                className="rounded-lg border border-border bg-surface p-3"
                style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
              >
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted">
                  <span>{widget.label}</span>
                  <span className="font-mono text-fg tabular-nums">{Number.isFinite(num) ? num : "—"}</span>
                </div>
                <input
                  type="range"
                  disabled={!on || busy}
                  min={min}
                  max={max}
                  value={clamped}
                  onChange={(e) => slide(widget, Number(e.target.value))}
                  className="w-full accent-accent"
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
          return (
            <div
              key={widget.id}
              style={{ gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }}
            >
              <WidgetShell
                widget={widget}
                disabled={!on || busy}
                active={lit}
                onClick={() => run(widget)}
              >
                {widget.type === "status" ? String(value) : confirm?.id === widget.id ? "Confirm?" : ""}
              </WidgetShell>
            </div>
          );
        })}
      </section>

      {note ? <p className="mx-auto mt-4 max-w-3xl text-sm text-clay">{note}</p> : null}
      {snap.lastError ? <p className="mx-auto mt-2 max-w-3xl text-xs text-muted">{snap.lastError}</p> : null}

      <p className="pointer-events-none absolute bottom-3 right-4 text-[11px] uppercase tracking-[0.18em] text-subtle">
        {snap.config.room.name}
      </p>
    </main>
  );
}
