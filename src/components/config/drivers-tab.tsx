import { addDriverFromLibrary, deleteDriver, saveDriver } from "@/lib/control/actions";
import type { DriverSpec, RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { driverInUse } from "@/lib/control/vars";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";

export function DriversTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  token: string;
  flash: (title: string, body: string) => void;
  refresh: () => Promise<unknown>;
  driverName: string;
  setDriverName: (s: string) => void;
  driverText: string;
  setDriverText: (s: string) => void;
  libraryPick: string;
  setLibraryPick: (s: string) => void;
  pendingDriver: string | null;
  setPendingDriver: (s: string | null) => void;
}) {
  const { draft, snap, token, flash, refresh, driverName, setDriverName, driverText, setDriverText, libraryPick, setLibraryPick, pendingDriver, setPendingDriver } = props;
  return (
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
  );
}
