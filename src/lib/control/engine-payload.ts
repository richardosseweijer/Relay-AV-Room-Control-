import type { DriverCommand, DriverSpec, InventoryItem, InventoryResource } from "./types";
import type { VarMap } from "./vars";

export function pickJsonField(raw: string, path: string): string | undefined {
  const named = raw.match(/"displayName"\s*:\s*"([^"]+)"/)?.[1];
  if (path.toLowerCase().includes("displayname") && named) return named;
  try {
    const start = raw.indexOf("{");
    const json = start >= 0 ? raw.slice(start) : raw;
    let cur: unknown = JSON.parse(json);
    for (const key of path.split(".")) {
      if (Array.isArray(cur)) {
        const i = Number(key);
        cur = Number.isFinite(i) ? cur[i] : cur[0];
        continue;
      }
      if (!cur || typeof cur !== "object") return undefined;
      const rec = cur as Record<string, unknown>;
      const hit = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
      if (!hit) return undefined;
      cur = rec[hit];
    }
    return cur === undefined || cur === null ? undefined : String(cur);
  } catch {
    return named;
  }
}

export function mapCommandValue(command: DriverCommand, raw: string | number | undefined) {
  const spec = command.valueMap;
  if (!spec || raw === undefined || spec.kind === "text") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const inMin = spec.inMin ?? command.min ?? 0;
  const inMax = spec.inMax ?? command.max ?? 100;
  const outMin = spec.outMin ?? 0;
  const outMax = spec.outMax ?? 1;
  const t = inMax === inMin ? 0 : (n - inMin) / (inMax - inMin);
  const out = outMin + Math.min(1, Math.max(0, t)) * (outMax - outMin);
  if (spec.kind === "int") {
    const rounded = Math.round(out);
    if (spec.hexBytes && spec.hexBytes > 0) return rounded.toString(16).padStart(spec.hexBytes * 2, "0");
    return rounded;
  }
  return Number(out.toFixed(spec.decimals ?? 3));
}

export function renderPayload(
  template: string,
  value?: string | number,
  auth: Record<string, string> = {},
  ctx: { host?: string; port?: number | string; id?: string; vars?: Record<string, string | number> } = {},
) {
  const raw = String(value ?? "");
  const n = Number(value);
  const hex2 = Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0") : raw;
  const n14 = Number.isFinite(n) ? Math.max(0, Math.min(16383, Math.round(n))) : 0;
  const nrpn = `${((n14 >> 7) & 0x7f).toString(16).padStart(2, "0")}${(n14 & 0x7f).toString(16).padStart(2, "0")}`;
  const channel = auth.midiChannel || auth.channel || "1";
  const ch = Math.max(1, Math.min(16, Number(channel) || 1));
  let out = template
    .replaceAll("{value:hex2}", hex2)
    .replaceAll("{value:nrpn14}", nrpn)
    .replaceAll("{midiChannel}", String(ch))
    .replaceAll("{channel}", String(ch))
    .replaceAll("{value}", raw)
    .replaceAll("{token}", auth.token ?? "")
    .replaceAll("{host}", ctx.host ?? "")
    .replaceAll("{port}", String(ctx.port ?? ""))
    .replaceAll("{id}", ctx.id ?? "");
  for (const [k, v] of Object.entries(auth)) out = out.replaceAll(`{auth.${k}}`, v ?? "");
  for (const [k, v] of Object.entries(ctx.vars ?? {})) {
    if (["value", "token", "host", "port", "id", "midiChannel", "channel"].includes(k)) continue;
    out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

export function applySim(command: DriverCommand, value: string | number | undefined, slot: Record<string, string | number | boolean>) {
  const id = command.id;
  if (id.endsWith(".on")) slot[`${id.slice(0, -3)}.state`] = "on";
  if (id.endsWith(".off")) slot[`${id.slice(0, -4)}.state`] = "off";
  if (id.startsWith("power.")) slot["power.state"] = id.includes("off") ? "off" : "on";
  if (command.kind === "range" && value !== undefined) slot[id === "volume.set" ? "volume.level" : id] = Number(value);
  if (id.startsWith("input.")) slot["input.current"] = id.split(".")[1] ?? "";
}

export function guardOk(requires: string[] | undefined, slot: Record<string, string | number | boolean>, vars: VarMap = {}) {
  if (!requires?.length) return true;
  return requires.every((rule) => {
    const [key, want] = rule.split("=");
    const have = String(slot[key ?? ""] ?? vars[key ?? ""] ?? "").trim().toLowerCase();
    return have === String(want ?? "").trim().toLowerCase();
  });
}

function jsonAt(raw: string, path?: string): unknown {
  const startObj = raw.search(/[\[{]/);
  const json = startObj >= 0 ? raw.slice(startObj) : raw;
  let cur: unknown = JSON.parse(json);
  if (!path) return cur;
  for (const key of path.split(".").filter(Boolean)) {
    if (Array.isArray(cur)) {
      const i = Number(key);
      cur = Number.isFinite(i) ? cur[i] : cur[0];
      continue;
    }
    if (!cur || typeof cur !== "object") return undefined;
    const rec = cur as Record<string, unknown>;
    const hit = Object.keys(rec).find((k) => k.toLowerCase() === key.toLowerCase());
    if (!hit) return undefined;
    cur = rec[hit];
  }
  return cur;
}

function fieldFromRow(row: Record<string, unknown>, path: string | undefined, fallbacks: string[]): string {
  const blob = JSON.stringify(row);
  if (path) {
    const hit = pickJsonField(blob, path);
    if (hit && hit !== "[object Object]") return hit;
  }
  for (const key of fallbacks) {
    const hit = pickJsonField(blob, key);
    if (hit && hit !== "[object Object]") return hit;
  }
  return "";
}

export function parseInventoryItems(raw: string, resource: InventoryResource): InventoryItem[] {
  const paths = resource.parsePath ? [resource.parsePath] : [""];
  for (const path of paths) {
    try {
      const node = jsonAt(raw, path || undefined);
      const rows: Record<string, unknown>[] = [];
      if (Array.isArray(node)) {
        for (const row of node) {
          if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
        }
      } else if (node && typeof node === "object") {
        for (const [id, row] of Object.entries(node as Record<string, unknown>)) {
          if (row && typeof row === "object") rows.push({ id, ...(row as Record<string, unknown>) });
          else rows.push({ id, value: row });
        }
      }
      const items = rows.map((row) => {
        const id = fieldFromRow(row, resource.idField, []) || String(row.id || "");
        const name = fieldFromRow(row, resource.nameField || resource.itemName, []) || id;
        const value = fieldFromRow(row, resource.valueField, []);
        return { id, name, value, group: resource.label, kind: resource.id };
      }).filter((item) => item.id);
      if (items.length) return items;
    } catch {
      /* try next path */
    }
  }
  return [];
}

function parseHaystacks(raw: string, needle?: string) {
  const piles = [raw, raw.trim()];
  const hexNeedle = !!needle && /^[0-9a-fA-F]{2,}(?:\s+[0-9a-fA-F]{2,})*$/.test(needle.trim());
  const binary = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw);
  if (!hexNeedle && !binary) return [...new Set(piles)];
  const hex = Buffer.from(raw, "latin1").toString("hex");
  const spaced = hex.replace(/../g, (b) => `${b} `).trim();
  return [...new Set([...piles, hex, hex.toUpperCase(), spaced, spaced.toUpperCase()])];
}

export function parseFeedback(rule: DriverSpec["feedback"][number]["parse"] | undefined, raw: string): string {
  if (!rule) return raw.trim();
  const piles = parseHaystacks(raw, rule.value ?? rule.pattern);
  let out = raw.trim();
  if (rule.type === "jsonpath") out = pickJsonField(raw, rule.path ?? "") ?? out;
  else if (rule.type === "map") out = raw.trim();
  else if (rule.type === "regex" && rule.pattern) {
    const re = new RegExp(rule.pattern);
    out = piles.map((text) => text.match(re)?.[1]).find(Boolean) ?? out;
  } else if (rule.type === "contains") {
    const want = (rule.value ?? "").toLowerCase();
    out = piles.some((text) => text.toLowerCase().includes(want)) ? (rule.value ?? "1") : "";
  } else if (rule.type === "exact") {
    const want = (rule.value ?? "").trim().toLowerCase();
    out = piles.some((text) => text.trim().toLowerCase() === want) ? (rule.value ?? raw.trim()) : "";
  }
  if (rule.map) {
    const hit = Object.keys(rule.map).find((k) => k.toLowerCase() === out.toLowerCase());
    if (hit) return rule.map[hit] ?? out;
  }
  return out;
}
