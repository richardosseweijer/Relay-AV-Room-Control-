import type { RefObject } from "react";
import { getEditorConfig, importBundle, rebootHost, restartHost, updateHost } from "@/lib/control/actions";
import type { RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { ROOM_THEME_LABELS, resolveRoomTheme, type RoomTheme } from "@/lib/theme";

const TIMEZONES = ["system", "Europe/Brussels", "Europe/Amsterdam", "Europe/London", "Europe/Berlin", "UTC", "America/New_York"];

export function RoomTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  refresh: () => Promise<RoomSnapshot | null | undefined>;
  setDraft: (c: RoomConfig) => void;
  importRef: RefObject<HTMLInputElement | null>;
  setGate: (g: { action: "wipe"; pin: string } | null) => void;
  downloadRoomFile: (draft: RoomConfig, drivers: RoomSnapshot["drivers"]) => void;
}) {
  const { draft, snap, token, update, flash, refresh, setDraft, importRef, setGate, downloadRoomFile } = props;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Room name<input className={fieldClass()} value={draft.room.name} onChange={(e) => update((c) => { c.room.name = e.target.value; })} /></label>
            <p className="grid gap-1 text-sm text-muted">Relay version<span className="font-mono text-fg">{snap.version || "—"}</span></p>
            <label className="grid gap-1 text-sm text-muted">Theme
              <select className={fieldClass()} value={resolveRoomTheme(draft.room.theme)} onChange={(e) => update((c) => { c.room.theme = e.target.value as RoomTheme; })}>
                {(Object.keys(ROOM_THEME_LABELS) as RoomTheme[]).map((id) => (
                  <option key={id} value={id}>{ROOM_THEME_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Idle dim (s)
              <InputNum min={0} value={draft.room.idleDimSeconds} onNumber={(n) => update((c) => { if (n == null) return; c.room.idleDimSeconds = Math.max(0, n); })} />
              <span className="text-xs">0 = never</span>
            </label>
            <label className="grid gap-1 text-sm text-muted">Clock
              <select className={fieldClass()} value={draft.room.network?.timezone ?? "system"} onChange={(e) => update((c) => { c.room.network.timezone = e.target.value; })}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone === "system" ? "This computer" : zone}</option>)}
              </select>
              <span className="text-xs">Schedules use this host’s clock. Set the OS time if it is wrong.</span>
            </label>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => {
                downloadRoomFile(draft, snap.drivers);
                flash("Download started", "PINs and tokens are blank in the file. This does not save the room.");
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
  );
}
