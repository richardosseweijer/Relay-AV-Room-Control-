/** Same id as NONE_MACRO_ID in types.ts. Inlined so node --test can load this file. */
const NONE_MACRO_ID = "none";
export type TriggerActionRule = {
  setVar?: string | null;
  setValue?: string;
  device?: string | null;
  command?: string | null;
  commandValue?: string;
  macroId?: string | null;
};

export type TriggerActionResult = { ok: boolean; message: string; ranMacro: boolean };

function filled(value: string | null | undefined) {
  return (value ?? "").trim();
}

/** True when the true path should run the new plan. A None-only rule stays on the old empty-macro path. */
export function triggerHasTrueWork(rule: TriggerActionRule) {
  if (filled(rule.setVar)) return true;
  if (filled(rule.device) && filled(rule.command)) return true;
  const macroId = filled(rule.macroId);
  return macroId !== "" && macroId !== NONE_MACRO_ID;
}

export function normalizeTriggerFields<T extends TriggerActionRule>(rule: T): T {
  return {
    ...rule,
    setVar: rule.setVar || "",
    setValue: rule.setValue ?? "",
    device: rule.device || "",
    command: rule.command || "",
    commandValue: rule.commandValue ?? "",
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
