import { useState } from "react";
import type { InventoryItem } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

export function InventoryBoard(props: {
  lists: { id: string; label: string; items: InventoryItem[]; command?: string }[];
  onRefresh?: () => void;
  onUse?: (command: string, id: string) => void;
}) {
  const [listId, setListId] = useState(props.lists[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const list = props.lists.find((item) => item.id === listId) ?? props.lists[0];
  const filtered = (list?.items ?? []).filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.id} ${item.group ?? ""}`.toLowerCase().includes(q);
  });
  const groups = [...new Set(filtered.map((item) => item.group || list?.label || "Other"))];
  if (!props.lists.length) return null;
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-border bg-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {props.lists.map((item) => (
          <button key={item.id} type="button" className={cn("rounded-full border px-3 py-1 text-xs", listId === item.id ? "border-accent bg-surface text-fg" : "border-border text-subtle")} onClick={() => { setListId(item.id); setQuery(""); }}>
            {item.label} ({item.items.length})
          </button>
        ))}
        {props.onRefresh ? <Button size="sm" variant="secondary" onClick={props.onRefresh}>Refresh</Button> : null}
      </div>
      <input className={fieldClass()} placeholder={`Filter ${list?.label ?? ""}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-56 space-y-3 overflow-auto">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-subtle">{group}</p>
            <div className="grid gap-1">
              {filtered.filter((item) => (item.group || list?.label || "Other") === group).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.name}</p>
                    <p className="font-mono text-[10px] text-subtle">{item.id}{item.value !== undefined ? ` = ${item.value}` : ""}</p>
                  </div>
                  {props.onUse && list?.command ? (
                    <Button size="sm" variant="ghost" onClick={() => props.onUse?.(list.command!, item.id)}>Use</Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length ? <p className="text-sm text-muted">Empty. Refresh inventory.</p> : null}
      </div>
    </div>
  );
}

export function InventoryPicker(props: {
  lists: { id: string; label: string; items: InventoryItem[]; command: string }[];
  command?: string;
  value?: string | number;
  onPick: (command: string, value: string) => void;
}) {
  return <InventoryBoard lists={props.lists} onUse={props.onPick} />;
}
