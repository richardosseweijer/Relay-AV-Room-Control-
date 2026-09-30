import type { RoomVariable } from "./types";

/** Same id as SYSTEM_TIME_VAR_ID in vars.ts. Inlined so node --test can load this file. */
const SYSTEM_TIME_VAR_ID = "time";

function timeChoice(): RoomVariable {
  return { id: SYSTEM_TIME_VAR_ID, label: "Time", kind: "text", default: "" };
}

/** Caret is inside an unclosed `{...` token. Query is the text after `{`. */
export function openVarToken(value: string, caret: number): { start: number; query: string } | null {
  const end = Math.max(0, Math.min(caret, value.length));
  const upto = value.slice(0, end);
  const start = upto.lastIndexOf("{");
  if (start < 0) return null;
  const query = upto.slice(start + 1);
  if (/[}{\n]/.test(query)) return null;
  return { start, query };
}

/** Replace the open token (from `{` through the caret) with `{id}`. Text after the caret stays. */
export function applyVarToken(value: string, start: number, caret: number, id: string): { value: string; caret: number } {
  const end = Math.max(start, Math.min(caret, value.length));
  const insert = `{${id}}`;
  return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
}

/**
 * Number-only template fields must not suggest text, enum, or `{time}`.
 * Bounds (slider min/max), range commands, writes into a number variable, and gt/lt compares.
 * Raw gateway lines are never numeric — they are device text.
 */
export function templateNumericOnly(opts: {
  bound?: boolean;
  compare?: string;
  varKind?: string | null;
  commandKind?: string | null;
  raw?: boolean;
}) {
  if (opts.raw) return false;
  if (opts.bound) return true;
  if (opts.compare === "gt" || opts.compare === "lt") return true;
  if (opts.varKind === "number") return true;
  if (opts.commandKind === "range") return true;
  return false;
}

/** Suggestions for the open `{` token. `{time}` is included unless the field is numeric-only. */
export function varTokenChoices(variables: RoomVariable[], query: string, numericOnly: boolean): RoomVariable[] {
  const pool: RoomVariable[] = [];
  if (!numericOnly) pool.push(timeChoice());
  for (const variable of variables) {
    if (variable.id === SYSTEM_TIME_VAR_ID) continue;
    if (numericOnly && variable.kind !== "number") continue;
    pool.push(variable);
  }
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  return pool.filter((variable) => variable.id.toLowerCase().includes(q) || variable.label.toLowerCase().includes(q));
}
