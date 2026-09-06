import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ConfigApp } from "@/components/config/config-app";

function ConfigGate() {
  const [token, setToken] = useState<string | null>(() => {
    try { return sessionStorage.getItem("relay-config-token"); } catch { return null; }
  });
  const [pin, setPin] = useState("");
  const [note, setNote] = useState<string | null>(null);

  if (!token) {
    return (
      <main className="relative z-20 mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Relay setup</p>
        <h1 className="text-3xl font-medium tracking-tight">Configurator</h1>
        <p className="text-sm text-muted">Enter the configurator PIN. First-run default is 1234.</p>
        <input
          className="h-12 rounded-md border border-border bg-surface px-3"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (document.getElementById("config-unlock") as HTMLButtonElement | null)?.click(); }}
          placeholder="PIN"
        />
        <button
          id="config-unlock"
          type="button"
          className="h-14 w-full rounded-md bg-accent text-base text-accent-fg"
          onClick={async () => {
            setNote(null);
            try {
              const res = await fetch("/api/config-unlock", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pin: pin.trim() }),
              });
              const data = await res.json().catch(() => ({})) as { ok?: boolean; token?: string; message?: string };
              if (data.ok && data.token) {
                sessionStorage.setItem("relay-config-token", data.token);
                setToken(data.token);
                return;
              }
              setNote(data.message || "Wrong PIN");
            } catch (err) {
              setNote(err instanceof Error ? err.message : "Unlock failed");
            }
          }}
        >
          Unlock
        </button>
        <Link to="/" className="text-center text-sm text-muted underline-offset-4 hover:underline">Back to room</Link>
        {note ? <p className="text-center text-sm text-clay">{note}</p> : null}
      </main>
    );
  }

  return <ConfigApp />;
}

export const Route = createFileRoute("/config")({ component: ConfigGate });
