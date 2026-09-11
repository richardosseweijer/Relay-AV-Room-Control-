import { useMemo, useState } from "react";
import { addDriverFromLibrary, deleteDriver, saveDriver } from "@/lib/control/actions";
import { indexDriver, type DriverIndex, type DriverSpec, type RoomConfig, type RoomSnapshot } from "@/lib/control/types";
import { driverInUse } from "@/lib/control/vars";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

function haystack(row: DriverIndex) {
  return `${row.filename} ${row.manufacturer} ${row.model} ${row.type} ${row.notes ?? ""}`.toLowerCase();
}

function asIndex(name: string, spec: DriverSpec | DriverIndex): DriverIndex {
  if ("manufacturer" in spec && !("commands" in spec)) {
    return { filename: name, manufacturer: spec.manufacturer, model: spec.model, type: spec.type, notes: spec.notes };
  }
  return indexDriver(name, spec as DriverSpec);
}

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
  const { draft, snap, token, flash, refresh, driverName, setDriverName, driverText, setDriverText, pendingDriver, setPendingDriver } = props;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"brand" | "file">("brand");

  const indexed = useMemo(() => {
    return Object.entries(snap.library ?? {}).map(([name, spec]) => asIndex(name, spec as DriverSpec | DriverIndex));
  }, [snap.library]);

  const types = useMemo(() => [...new Set(indexed.map((row) => row.type).filter(Boolean))].sort(), [indexed]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = indexed.filter((row) => {
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (q && !haystack(row).includes(q)) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sortBy === "file") return a.filename.localeCompare(b.filename);
      return a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model) || a.filename.localeCompare(b.filename);
    });
    return rows;
  }, [indexed, query, typeFilter, sortBy]);

  const loadedVisible = useMemo(() => {
    const names = new Set(visible.map((row) => row.filename));
    return Object.entries(snap.drivers).filter(([name]) => names.has(name) || (!query.trim() && typeFilter === "all"));
  }, [snap.drivers, visible, query, typeFilter]);

  return (
    <section className="grid gap-3">
      <label className="grid gap-1 text-sm text-muted">
        Search library
        <input className={fieldClass()} value={query} placeholder="Brand, model, type, filename" onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={cn("rounded-full border px-3 py-1 text-xs", typeFilter === "all" ? "border-accent bg-surface text-fg" : "border-border text-subtle")} onClick={() => setTypeFilter("all")}>All</button>
        {types.map((type) => (
          <button key={type} type="button" className={cn("rounded-full border px-3 py-1 text-xs capitalize", typeFilter === type ? "border-accent bg-surface text-fg" : "border-border text-subtle")} onClick={() => setTypeFilter(type)}>{type}</button>
        ))}
      </div>
      <label className="grid gap-1 text-sm text-muted w-fit">
        Sort
        <select className={fieldClass()} value={sortBy} onChange={(e) => setSortBy(e.target.value as "brand" | "file")}>
          <option value="brand">Brand, then model</option>
          <option value="file">Filename</option>
        </select>
      </label>
      <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-2">
        {visible.map((row) => {
          const loaded = Boolean(snap.drivers[row.filename]);
          return (
            <div key={row.filename} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{row.manufacturer} · {row.model}</p>
                <p className="font-mono text-[10px] text-subtle">{row.type} · {row.filename}</p>
              </div>
              {loaded ? (
                <span className="shrink-0 text-xs text-subtle">In room</span>
              ) : (
                <Button size="sm" variant="secondary" onClick={async () => {
                  const res = await addDriverFromLibrary({ data: { token: token || "", filename: row.filename } });
                  flash(res.ok ? "Added" : "Not added", res.message);
                  await refresh();
                }}>Add</Button>
              )}
            </div>
          );
        })}
        {!visible.length ? <p className="px-2 text-sm text-subtle">No drivers match.</p> : null}
      </div>
      {loadedVisible.map(([name, spec]) => (
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
