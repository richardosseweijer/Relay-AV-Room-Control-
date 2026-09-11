import { getEditorConfig, revokeAllSessions, revokeSession } from "@/lib/control/actions";
import type { RoomConfig } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

type PairRow = { id: string; kind: string; label: string; created: number; lastSeen?: number };

export function SecurityTab(props: {
  draft: RoomConfig;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  paired: PairRow[];
  setPaired: (rows: PairRow[]) => void;
}) {
  const { draft, token, update, flash, paired, setPaired } = props;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Config PIN
              <input className={fieldClass()} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="unchanged" value={String(draft.room.configPin || "").startsWith("scrypt$") ? "" : draft.room.configPin} onChange={(e) => update((c) => { c.room.configPin = e.target.value.replace(/\D/g, ""); })} />
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
                <input className={fieldClass()} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="unchanged" value={String(draft.room.panelPin ?? "").startsWith("scrypt$") ? "" : (draft.room.panelPin ?? "")} onChange={(e) => update((c) => { c.room.panelPin = e.target.value.replace(/\D/g, ""); })} />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={draft.room.externalControl === true} onChange={(e) => update((c) => { c.room.externalControl = e.target.checked; })} />
              Allow commands from the LAN with no token (debug only)
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={draft.room.panelAcceptsConfigPin === true} onChange={(e) => update((c) => { c.room.panelAcceptsConfigPin = e.target.checked; })} />
              Room unlock also accepts the configurator PIN
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
  );
}
