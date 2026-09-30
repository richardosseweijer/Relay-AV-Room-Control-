export type SuggestOption = { id: string; label: string; hint?: string };

const OCCUPANCY_LABEL: Record<string, string> = {
  "0": "Closed",
  "1": "Open",
  "2": "In session",
  "3": "Do not disturb",
};

/** Empty query, or a query that already is one option, shows the whole list. Otherwise filter. */
export function suggestMatches(options: SuggestOption[], query: string): SuggestOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const exact = options.some((option) => option.id.toLowerCase() === q || option.label.toLowerCase() === q);
  if (exact) return options;
  return options.filter((option) => option.label.toLowerCase().includes(q) || option.id.toLowerCase().includes(q));
}

export function namedValues(variableId: string | null | undefined, values: string[] | null | undefined): SuggestOption[] {
  return (values ?? []).filter(Boolean).map((id) => {
    const friendly = variableId === "occupancy" ? OCCUPANCY_LABEL[id] : undefined;
    return friendly ? { id, label: friendly, hint: id } : { id, label: id };
  });
}

/**
 * Whole-field hints for a command or variable value.
 * `macro.run` → macros, `ui.page` → pages, list variables and enum commands → their values.
 * Empty enum lists (toast, block, app id) return nothing.
 */
export function valueSuggestions(opts: {
  commandId?: string | null;
  commandKind?: string | null;
  commandValues?: string[] | null;
  varId?: string | null;
  varKind?: string | null;
  varValues?: string[] | null;
  macros?: { id: string; label: string }[];
  pages?: { id: string; label: string }[];
}): SuggestOption[] {
  if (opts.commandId === "macro.run") {
    return (opts.macros ?? []).filter((macro) => macro.id && macro.id !== "none").map((macro) => ({ id: macro.id, label: macro.label, hint: macro.id }));
  }
  if (opts.commandId === "ui.page") {
    return (opts.pages ?? []).filter((page) => page.id).map((page) => ({ id: page.id, label: page.label, hint: page.id }));
  }
  if (opts.varKind === "enum" && opts.varValues?.length) return namedValues(opts.varId, opts.varValues);
  if (opts.commandKind === "enum" && opts.commandValues?.length) return namedValues(undefined, opts.commandValues);
  return [];
}

/** Distinct latch-group names already used on widgets. */
export function latchGroupOptions(groups: (string | null | undefined)[]): SuggestOption[] {
  const seen = new Set<string>();
  const out: SuggestOption[] = [];
  for (const raw of groups) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: name, label: name });
  }
  return out;
}
