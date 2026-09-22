import type { StatusColorWhen, StatusDefault, Widget, WidgetColor } from "./types";

export type StatusAppearance = {
  color: WidgetColor;
  text: string;
  macroId?: string | null;
  /** True when a colorWhen row matched. */
  matched: boolean;
  /** True when statusDefault was applied (no rule matched). */
  fromDefault: boolean;
};

function displayText(label: string | undefined, rawValue: string) {
  return label != null && label !== "" ? label : rawValue;
}

/**
 * Resolve Status traffic-light color / readout / press macro.
 * Exact string equals for v1. First colorWhen match wins; else statusDefault; else legacy widget.color + raw text.
 */
export function resolveStatusAppearance(
  widget: Pick<Widget, "color" | "colorWhen" | "statusDefault">,
  rawValue: string,
): StatusAppearance {
  const value = String(rawValue);
  for (const rule of widget.colorWhen ?? []) {
    if (rule.equals === value) {
      return {
        color: rule.color,
        text: displayText(rule.label, value),
        macroId: rule.macroId,
        matched: true,
        fromDefault: false,
      };
    }
  }
  if (widget.statusDefault?.color) {
    const fallback = widget.statusDefault;
    return {
      color: fallback.color,
      text: displayText(fallback.label, value),
      macroId: fallback.macroId,
      matched: false,
      fromDefault: true,
    };
  }
  return {
    color: widget.color,
    text: value,
    macroId: undefined,
    matched: false,
    fromDefault: false,
  };
}

function cleanMacroId(macroId: string | null | undefined) {
  if (macroId == null || macroId === "") return undefined;
  return String(macroId);
}

function cleanRule(row: StatusColorWhen): StatusColorWhen | null {
  if (!row || typeof row.equals !== "string" || !row.color) return null;
  const out: StatusColorWhen = { equals: String(row.equals), color: row.color };
  if (row.label != null && row.label !== "") out.label = String(row.label);
  const macroId = cleanMacroId(row.macroId);
  if (macroId) out.macroId = macroId;
  return out;
}

function cleanDefault(row: StatusDefault | null | undefined): StatusDefault | undefined {
  if (!row?.color) return undefined;
  const out: StatusDefault = { color: row.color };
  if (row.label != null && row.label !== "") out.label = String(row.label);
  const macroId = cleanMacroId(row.macroId);
  if (macroId) out.macroId = macroId;
  return out;
}

/** Normalize/migrate Status fields: missing OK; drop invalid rows. */
export function normalizeStatusFields<T extends Widget>(widget: T): T {
  const hasRules = "colorWhen" in widget && widget.colorWhen != null;
  const hasDefault = "statusDefault" in widget && widget.statusDefault != null;
  if (!hasRules && !hasDefault) return widget;

  const next: T = { ...widget };
  if (hasRules) {
    const rows = Array.isArray(widget.colorWhen) ? widget.colorWhen : [];
    next.colorWhen = rows.map(cleanRule).filter((row): row is StatusColorWhen => Boolean(row));
  }
  if (hasDefault) {
    const cleaned = cleanDefault(widget.statusDefault);
    next.statusDefault = cleaned ?? null;
  }
  return next;
}
