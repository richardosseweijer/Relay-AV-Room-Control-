import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PANEL_TOKEN_KEY } from "@/lib/control/panel-token";

/** PIN unlock screen shown when the panel session is gated. */
export function PanelPinGate({
  roomName,
  loadErr,
  onUnlocked,
}: {
  roomName: string;
  loadErr: string | null;
  /** Persist session + refresh; return true when the room snap is usable. */
  onUnlocked: (token: string) => Promise<boolean>;
}) {
  const [pin, setPin] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function unlockRoom() {
    setNote(null);
    try {
      const res = await fetch("/api/panel-unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; token?: string; message?: string };
      if (data.ok && data.token) {
        sessionStorage.setItem(PANEL_TOKEN_KEY, data.token);
        localStorage.setItem(PANEL_TOKEN_KEY, data.token);
        const ok = await onUnlocked(data.token);
        if (!ok) setNote(loadErr || "Room did not load");
        return;
      }
      setNote(data.message || "Wrong PIN");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Unlock failed");
    }
  }

  return (
    <main className="relative z-20 mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 bg-bg px-6">
      <p className="text-[11px] tracking-[0.28em] uppercase text-subtle">Relay</p>
      <h1 className="text-4xl font-medium tracking-tight">{roomName}</h1>
      <p className="text-sm text-muted">PIN to open the room. First-run default is 1234.</p>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        enterKeyHint="done"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") void unlockRoom(); }}
        className="h-14 rounded-2xl border border-border bg-surface px-4 text-center text-2xl tracking-[0.5em]"
        placeholder="••••"
      />
      {note ? <p className="text-center text-sm text-clay">{note}</p> : null}
      {loadErr ? <p className="text-center text-xs text-muted">{loadErr}</p> : null}
      <Button type="button" className="relative z-20 h-14 w-full text-base" onClick={() => void unlockRoom()}>
        Unlock
      </Button>
      <Link to="/config" className="text-center text-sm text-muted underline-offset-4 hover:underline">Configurator</Link>
    </main>
  );
}
