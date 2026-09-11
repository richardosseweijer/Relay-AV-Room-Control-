import { useEffect, useState } from "react";
import { getEditorConfig, wipeLog } from "@/lib/control/actions";
import type { HostProcessStatus, RoomSnapshot } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

function formatAge(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function LogTab(props: {
  snap: RoomSnapshot;
  token: string;
  setSnap: (fn: (cur: RoomSnapshot | null) => RoomSnapshot | null) => void;
  refresh: () => Promise<unknown>;
}) {
  const [logKind, setLogKind] = useState("all");
  const [proc, setProc] = useState<HostProcessStatus | null>(null);

  useEffect(() => {
    if (!props.token) return;
    let cancel = false;
    const tick = async () => {
      const ed = await getEditorConfig({ data: { token: props.token } }).catch(() => ({ ok: false as const }));
      if (cancel || !ed.ok) return;
      if ("process" in ed && ed.process) setProc(ed.process as HostProcessStatus);
      if ("log" in ed && Array.isArray(ed.log)) props.setSnap((cur) => cur ? { ...cur, log: ed.log as RoomSnapshot["log"] } : cur);
    };
    tick().catch(() => undefined);
    const id = window.setInterval(() => { tick().catch(() => undefined); }, 2000);
    return () => { cancel = true; window.clearInterval(id); };
  }, [props.token]);

  return (
          <section className="grid gap-3">
            <div className={cn("rounded-md border px-3 py-2 font-mono text-xs leading-relaxed", proc && proc.rssMb >= 700 ? "border-clay/60 text-clay" : "border-border text-muted")}>
              {proc
                ? `up ${formatAge(proc.uptimeSec)} · rss ${proc.rssMb} MB · heap ${proc.heapMb}/${proc.heapTotalMb} MB · load ${proc.load} · sockets ws ${proc.sockets.ws} tcp ${proc.sockets.tcp} cast ${proc.sockets.cast} · monitors ${proc.monitors} · errors ${proc.healthFail} · ${proc.runningMacro || "idle"}${proc.lastError ? ` · ${proc.lastError}` : ""}`
                : "Live host status…"}
            </div>
            <div className="flex gap-2">
              <select className={fieldClass()} value={logKind} onChange={(e) => setLogKind(e.target.value)}>
                <option value="all">All</option>
                <option value="command">Commands</option>
                <option value="macro">Macros</option>
                <option value="monitor">Monitors</option>
                <option value="error">Errors</option>
              </select>
              <Button size="sm" variant="secondary" onClick={async () => { await wipeLog({ data: { token: props.token || "" } }); await props.refresh(); }}>Clear log</Button>
            </div>
            {(props.snap.log ?? []).filter((row) => logKind === "all" || row.kind === logKind || (logKind === "error" && !row.ok)).map((row) => (
              <div key={row.id} className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <div className="flex justify-between"><span className={row.ok ? "" : "text-clay"}>{row.title}</span><span className="text-[11px] text-subtle">{new Date(row.at).toLocaleTimeString()}</span></div>
                <p className="text-xs text-muted">{row.detail}</p>
              </div>
            ))}
            {!(props.snap.log ?? []).length ? <p className="text-sm text-subtle">No events since last start. Logs live in RAM only.</p> : null}
          </section>
  );
}
