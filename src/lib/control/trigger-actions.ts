/** Same id as NONE_MACRO_ID in types.ts. Inlined so node --test can load this file. */
const NONE_MACRO_ID = "none";
export type TriggerActionRule = {
  setVar?: string | null;
  setValue?: string;
  device?: string | null;
  command?: string | null;
  commandValue?: string;
  macroId?: string | null;
  falseSetVar?: string | null;
  falseSetValue?: string;
  falseDevice?: string | null;
  falseCommand?: string | null;
  falseCommandValue?: string;
  falseMacroId?: string | null;
};

export type TriggerActionResult = { ok: boolean; message: string; ranMacro: boolean };

function filled(value: string | null | undefined) {
  return (value ?? "").trim();
}

/** True when this action side should run the plan. A None-only side stays empty. */
export function triggerHasTrueWork(rule: TriggerActionRule) {
  if (filled(rule.setVar)) return true;
  if (filled(rule.device) && filled(rule.command)) return true;
  const macroId = filled(rule.macroId);
  return macroId !== "" && macroId !== NONE_MACRO_ID;
}

/** False-side fields, same plan as true. */
export function falseActionOf(rule: TriggerActionRule): TriggerActionRule {
  return {
    setVar: rule.falseSetVar,
    setValue: rule.falseSetValue,
    device: rule.falseDevice,
    command: rule.falseCommand,
    commandValue: rule.falseCommandValue,
    macroId: rule.falseMacroId,
  };
}

export function triggerHasFalseWork(rule: TriggerActionRule) {
  return triggerHasTrueWork(falseActionOf(rule));
}

export function normalizeTriggerFields<T extends TriggerActionRule>(rule: T): T {
  return {
    ...rule,
    setVar: rule.setVar || "",
    setValue: rule.setValue ?? "",
    device: rule.device || "",
    command: rule.command || "",
    commandValue: rule.commandValue ?? "",
    falseSetVar: rule.falseSetVar || "",
    falseSetValue: rule.falseSetValue ?? "",
    falseDevice: rule.falseDevice || "",
    falseCommand: rule.falseCommand || "",
    falseCommandValue: rule.falseCommandValue ?? "",
    falseMacroId: rule.falseMacroId || NONE_MACRO_ID,
  };
}

/**
 * True-path actions: write variable, then device command, then a real macro.
 * Stops on the first failure. None / missing macro is skipped (not a failure).
 */
export async function runTriggerTruePlan(
  rule: TriggerActionRule,
  deps: {
    resolve: (raw: string) => string;
    writeVar: (id: string, value: string) => Promise<TriggerActionResult> | TriggerActionResult;
    exec: (device: string, command: string, value: string) => Promise<TriggerActionResult> | TriggerActionResult;
    runMacro: (macroId: string) => Promise<TriggerActionResult> | TriggerActionResult;
  },
): Promise<TriggerActionResult> {
  const setVar = filled(rule.setVar);
  if (setVar) {
    const wrote = await deps.writeVar(setVar, deps.resolve(rule.setValue ?? ""));
    if (!wrote.ok) return { ok: false, message: wrote.message, ranMacro: false };
  }
  const device = filled(rule.device);
  const command = filled(rule.command);
  if (device && command) {
    const ran = await deps.exec(device, command, deps.resolve(rule.commandValue ?? ""));
    if (!ran.ok) return { ok: false, message: ran.message, ranMacro: false };
  }
  const macroId = filled(rule.macroId);
  if (macroId && macroId !== NONE_MACRO_ID) {
    const ran = await deps.runMacro(macroId);
    return { ok: ran.ok, message: ran.message, ranMacro: true };
  }
  return { ok: true, message: "ok", ranMacro: false };
}
