import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { falseActionOf, normalizeTriggerFields, runTriggerTruePlan, triggerHasFalseWork, triggerHasTrueWork } from "../src/lib/control/trigger-actions.ts";

test("trigger none id matches NONE_MACRO_ID", () => {
  const types = fs.readFileSync("src/lib/control/types.ts", "utf8");
  assert.match(types, /export const NONE_MACRO_ID = "none"/);
});

test("trigger false-work uses the same plan and ignores a None-only side", () => {
  assert.equal(triggerHasFalseWork({ falseMacroId: "none" }), false);
  assert.equal(triggerHasFalseWork({ falseMacroId: "mac-stop" }), true);
  assert.equal(triggerHasFalseWork({ falseSetVar: "occupancy", falseMacroId: "none" }), true);
  assert.equal(triggerHasFalseWork({ falseDevice: "mps", falseCommand: "", falseMacroId: "none" }), false);
  const side = falseActionOf({ falseSetVar: "occupancy", falseSetValue: "0", falseDevice: "mps", falseCommand: "power.off", falseMacroId: "mac-stop" });
  assert.equal(side.setVar, "occupancy");
  assert.equal(side.macroId, "mac-stop");
  assert.equal(triggerHasTrueWork(side), true);
});

test("trigger true-work ignores a None-only rule", () => {
  assert.equal(triggerHasTrueWork({ macroId: "none" }), false);
  assert.equal(triggerHasTrueWork({ macroId: "" }), false);
  assert.equal(triggerHasTrueWork({ setVar: "occupancy", macroId: "none" }), true);
  assert.equal(triggerHasTrueWork({ device: "mps", command: "power.on", macroId: "none" }), true);
  assert.equal(triggerHasTrueWork({ device: "mps", command: "", macroId: "none" }), false);
  assert.equal(triggerHasTrueWork({ macroId: "mac-start" }), true);
});

test("trigger plan writes, then commands, then a real macro, and stops on first failure", async () => {
  const calls = [];
  const ok = await runTriggerTruePlan(
    { setVar: "occupancy", setValue: "1", device: "mps", command: "power.on", commandValue: "", macroId: "mac-start" },
    {
      resolve: (raw) => raw,
      writeVar: async (id, value) => {
        calls.push(`write:${id}=${value}`);
        return { ok: true, message: value, ranMacro: false };
      },
      exec: async (device, command) => {
        calls.push(`exec:${device}:${command}`);
        return { ok: true, message: "sent", ranMacro: false };
      },
      runMacro: async (id) => {
        calls.push(`macro:${id}`);
        return { ok: true, message: "ran", ranMacro: true };
      },
    },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.ranMacro, true);
  assert.deepEqual(calls, ["write:occupancy=1", "exec:mps:power.on", "macro:mac-start"]);

  const stopped = [];
  const fail = await runTriggerTruePlan(
    { setVar: "time", setValue: "12:00", device: "mps", command: "power.on", macroId: "mac-start" },
    {
      resolve: (raw) => raw,
      writeVar: async () => {
        stopped.push("write");
        return { ok: false, message: "Read-only variable", ranMacro: false };
      },
      exec: async () => {
        stopped.push("exec");
        return { ok: true, message: "sent", ranMacro: false };
      },
      runMacro: async () => {
        stopped.push("macro");
        return { ok: true, message: "ran", ranMacro: true };
      },
    },
  );
  assert.equal(fail.ok, false);
  assert.equal(fail.message, "Read-only variable");
  assert.equal(fail.ranMacro, false);
  assert.deepEqual(stopped, ["write"]);
});

test("trigger plan skips None and does not invent a macro", async () => {
  let macros = 0;
  const result = await runTriggerTruePlan(
    { setVar: "flag", setValue: "on", macroId: "none" },
    {
      resolve: (raw) => raw,
      writeVar: async () => ({ ok: true, message: "on", ranMacro: false }),
      exec: async () => {
        throw new Error("no command");
      },
      runMacro: async () => {
        macros += 1;
        return { ok: true, message: "ran", ranMacro: true };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.ranMacro, false);
  assert.equal(macros, 0);
});

test("normalize fills blank trigger actions and keeps the macro", () => {
  const rule = normalizeTriggerFields({ macroId: "mac-start", setVar: undefined, device: null });
  assert.equal(rule.macroId, "mac-start");
  assert.equal(rule.setVar, "");
  assert.equal(rule.setValue, "");
  assert.equal(rule.device, "");
  assert.equal(rule.command, "");
  assert.equal(rule.commandValue, "");
  const src = fs.readFileSync("src/lib/control/store-normalize.ts", "utf8");
  assert.match(src, /normalizeTriggerFields/);
  const schedules = fs.readFileSync("src/lib/control/store-schedules.ts", "utf8");
  assert.match(schedules, /runTriggerTruePlan/);
  assert.match(schedules, /triggerHasTrueWork/);
  assert.match(schedules, /if \(!macro && !extra\) continue/);
  assert.match(schedules, /rule\.macroId \|\| triggerHasTrueWork\(rule\)/);
  const pane = fs.readFileSync("src/components/config/trigger-pane.tsx", "utf8");
  assert.match(pane, /Set variable/);
  assert.match(pane, /Function/);
  assert.match(pane, /SYSTEM_TIME_VAR_ID/);
  const logic = fs.readFileSync("src/components/config/logic-tab.tsx", "utf8");
  assert.match(logic, /<TriggersSection draft=\{draft\} snap=\{snap\}/);
});
