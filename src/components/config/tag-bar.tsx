import { useState } from "react";
import { NONE_MACRO_ID } from "@/lib/control/types";
import type { RoomConfig } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";

export type TagBucket = "macros" | "variables" | "monitors" | "schedules" | "triggers";
export const TAG_ALL = "*";
export type Tagged = { id: string; tag?: string | null; folder?: string | null };

export function tagOf(item: Tagged) {
  return (item.tag || item.folder || "").trim();
}

export function tagVisible(filter: string, item: Tagged) {
  if (filter === TAG_ALL) return true;
  return tagOf(item) === filter;
}

export function tagNames(config: RoomConfig, bucket: TagBucket): string[] {
  const listed = [...(config.tags?.[bucket] ?? [])];
  const items: Tagged[] =
    bucket === "macros" ? config.macros.filter((m) => m.id !== NONE_MACRO_ID) :
    bucket === "variables" ? config.variables :
    bucket === "monitors" ? config.monitors :
    bucket === "schedules" ? config.schedules :
    (config.triggers ?? []);
  for (const item of items) {
    const name = tagOf(item);
    if (name && !listed.includes(name)) listed.push(name);
  }
  return listed;
}

export function currentTag(filter: string) {
  return filter === TAG_ALL ? "" : filter;
}

export function setTags(c: RoomConfig, bucket: TagBucket, names: string[]) {
  c.tags = { ...(c.tags ?? {}), [bucket]: names };
}

export function fileItem(c: RoomConfig, bucket: TagBucket, id: string, tag: string) {
  const name = tag.trim();
  const names = tagNames(c, bucket);
  if (name && !names.includes(name)) setTags(c, bucket, [...names, name]);
  const apply = (item: Tagged) => {
    if (item.id === id) {
      item.tag = name || null;
      item.folder = undefined;
    }
  };
  if (bucket === "macros") c.macros.forEach(apply);
  if (bucket === "variables") c.variables.forEach(apply);
  if (bucket === "monitors") c.monitors.forEach(apply);
  if (bucket === "schedules") c.schedules.forEach(apply);
  if (bucket === "triggers") (c.triggers ?? []).forEach(apply);
}

export function TagBar({
  names,
  filter,
  onFilter,
  onReorder,
  onFile,
  onCreate,
  onRemove,
}: {
  names: string[];
  filter: string;
  onFilter: (id: string) => void;
  onReorder: (from: string, onto: string) => void;
  onFile: (raw: string, tag: string) => void;
  onCreate: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const chips = [{ id: TAG_ALL, label: "All" }, { id: "", label: "Untagged" }, ...names.map((n) => ({ id: n, label: n }))];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <button
          key={chip.id || "untagged"}
          type="button"
          draggable={Boolean(chip.id && chip.id !== TAG_ALL)}
          className={cn("h-9 rounded-md border px-3 text-sm", filter === chip.id ? "border-accent bg-raised text-fg" : "border-border text-muted")}
          onClick={() => onFilter(chip.id)}
          onDragStart={(e) => {
            if (!chip.id || chip.id === TAG_ALL) return;
            e.dataTransfer.setData("text/plain", `tag:${chip.id}`);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData("text/plain");
            if (raw.startsWith("tag:")) {
              const from = raw.slice(4);
              if (chip.id && chip.id !== TAG_ALL && from !== chip.id) onReorder(from, chip.id);
              return;
            }
            if (chip.id === TAG_ALL) return;
            onFile(raw, chip.id);
          }}
        >
          {chip.label}
        </button>
      ))}
      <input className={cn(fieldClass(), "h-9 w-36")} placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        const next = name.trim();
        if (!next || next === "All" || next === "Untagged") return;
        onCreate(next);
        setName("");
      }} />
      <Button size="sm" variant="secondary" onClick={() => {
        const next = name.trim();
        if (!next || next === "All" || next === "Untagged") return;
        onCreate(next);
        setName("");
      }}>Add tag</Button>
      {filter && filter !== TAG_ALL ? (
        <Button size="sm" variant="ghost" onClick={() => onRemove(filter)}>Delete tag</Button>
      ) : null}
    </div>
  );
}
