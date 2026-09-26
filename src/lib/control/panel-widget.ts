import type { EnableClause, RoomSnapshot, Widget } from "./types";

/** Read device feedback text for a panel tile (or "—" when unbound). */
export function readFeedback(snap: RoomSnapshot, device?: string, feedback?: string) {
  if (!device || !feedback) return "";
  return snap.state[device]?.[feedback] ?? "—";
}

/** Compare snap/feedback string against enableWhen.equals with optional op. */
export function compareValue(have: string, op: string | undefined, want: string) {
  const left = have.trim().toLowerCase();
  const right = want.trim().toLowerCase();
  const ln = Number(have);
  const rn = Number(want);
  const numeric = Number.isFinite(ln) && Number.isFinite(rn) && have !== "" && want !== "";
  switch (op) {
    case "neq": return left !== right;
    case "gt": return numeric ? ln > rn : left > right;
    case "lt": return numeric ? ln < rn : left < right;
    case "gte": return numeric ? ln >= rn : left >= right;
    case "lte": return numeric ? ln <= rn : left <= right;
    default: return left === right;
  }
}

export function clauseOk(snap: RoomSnapshot, clause: EnableClause) {
  if (clause.variable) return compareValue(String(snap.vars[clause.variable] ?? ""), clause.op, clause.equals);
  if (clause.device && clause.feedback) return compareValue(String(snap.state[clause.device]?.[clause.feedback] ?? ""), clause.op, clause.equals);
  return true;
}

/** Whether a widget's enableWhen rule currently passes. */
export function enabled(snap: RoomSnapshot, widget: Widget) {
  const rule = widget.enableWhen;
  if (!rule) return true;
  const rows = rule.all?.length ? rule.all : (rule.variable || rule.device ? [rule] : []);
  if (!rows.length) return true;
  return rows.every((row) => clauseOk(snap, row));
}

/** Map raw fire errors to a short operator-facing note. */
export function friendlyError(raw: string, snap: RoomSnapshot) {
  const device = snap.config.devices.find((d) => raw.includes(d.id));
  const name = device?.name ?? "Device";
  if (/timeout|did not finish|abort/i.test(raw)) return `${name} didn’t answer`;
  if (/refused|ECONNREFUSED|unreachable/i.test(raw)) return `${name} isn’t on the network`;
  if (/Allow|link button|pair/i.test(raw)) return `${name} needs permission`;
  if (/Blocked/i.test(raw)) return `${name} isn’t ready`;
  if (/token/i.test(raw)) return `${name} needs pairing`;
  return `${name} didn’t finish`;
}

/** Highlight for a command-bound button when feedback matches on/off or .current. */
export function commandIsActive(snap: RoomSnapshot, widget: Widget) {
  const device = widget.bind.device;
  const command = widget.bind.command;
  if (!device || !command) return false;
  const slot = snap.state[device] ?? {};
  const [head, tail] = command.split(".");
  if (!head || !tail) return false;
  if (tail === "on" || tail === "off") return String(slot[`${head}.state`] ?? "") === tail;
  const current = slot[`${head}.current`];
  if (current !== undefined) return String(current) === tail;
  return false;
}

/**
 * Resolve the number variable a slider should drive.
 * Latch-linked sliders follow the latched macro's first number var / setVar.
 */
export function sliderVariable(snap: RoomSnapshot, widget: Widget): string | undefined {
  if (widget.latchGroup) {
    const latchedId = (snap.latches ?? {})[widget.latchGroup];
    const source = snap.config.pages.flatMap((p) => p.widgets).find((w) => w.id === latchedId);
    const macro = snap.config.macros.find((m) => m.id === source?.bind.id);
    for (const step of macro?.steps ?? []) {
      const token = String(step.value ?? "").match(/\{([^}]+)\}/);
      if (token?.[1] && snap.config.variables.some((v) => v.id === token[1] && v.kind === "number")) return token[1];
      if (step.setVar && snap.config.variables.some((v) => v.id === step.setVar && v.kind === "number")) return step.setVar;
    }
    if (source?.bind.variable) return source.bind.variable;
  }
  return widget.bind.variable ?? undefined;
}

/** Whether a tile should show the lit/active face. */
export function widgetActive(snap: RoomSnapshot, widget: Widget, confirming: boolean) {
  if (confirming) return true;
  if (widget.highlight === "off") return false;
  if (widget.highlight === "latch" || widget.latchGroup) {
    const group = widget.latchGroup || widget.id;
    return (snap.latches ?? {})[group] === widget.id;
  }
  if (widget.enableWhen) return enabled(snap, widget);
  if (widget.bind.kind === "macro" && widget.bind.id) return snap.activeScene === widget.bind.id;
  if (widget.bind.kind === "command") return commandIsActive(snap, widget);
  return false;
}

/** Label-only: completely omit the tile when enableWhen fails and hideWhenDisabled is set. */
export function shouldHideWhenDisabled(snap: RoomSnapshot, widget: Widget) {
  return widget.type === "label" && widget.hideWhenDisabled === true && !enabled(snap, widget);
}

/**
 * Normalize hideWhenDisabled for labels (missing/invalid → false).
 * Non-label widgets leave the field untouched.
 */
export function normalizeHideWhenDisabledFields<T extends Widget>(widget: T): T {
  if (widget.type !== "label") return widget;
  const hideWhenDisabled = widget.hideWhenDisabled === true;
  if (hideWhenDisabled === widget.hideWhenDisabled) return widget;
  return { ...widget, hideWhenDisabled };
}

