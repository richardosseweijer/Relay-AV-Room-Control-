import assert from "node:assert/strict";
import test from "node:test";
import { resolveTemplate, resolveWidgetLabel, expandLabelNewlines, formatWidgetLabel } from "../src/lib/control/vars.ts";

const variables = [
  { id: "roomName", label: "Room name", kind: "text", default: "Default Room" },
  { id: "level", label: "Level", kind: "number", default: 0 },
];

test("resolveTemplate: known var expands", () => {
  assert.equal(resolveTemplate("Hello {roomName}", { roomName: "Lobby" }, variables), "Hello Lobby");
  assert.equal(resolveTemplate("{level}", { level: 42 }, variables), 42);
});

test("resolveTemplate: missing var hides token (empty, no braces)", () => {
  assert.equal(resolveTemplate("Hello {missing}", {}, variables), "Hello ");
  assert.equal(resolveTemplate("{missing}", {}, variables), "");
  assert.equal(resolveTemplate("{gone}!", { roomName: "Lobby" }, variables), "!");
});

test("resolveTemplate: multiple tokens + literal around", () => {
  const out = resolveTemplate("[{roomName}] / {level}", { roomName: "Lobby", level: 3 }, variables);
  assert.equal(out, "[Lobby] / 3");
});

test("resolveTemplate: defined var without live value uses default", () => {
  assert.equal(resolveTemplate("{roomName}", {}, variables), "Default Room");
});

test("resolveWidgetLabel: always string; empty raw ok", () => {
  assert.equal(resolveWidgetLabel("Hi {roomName}", { roomName: "A" }, variables), "Hi A");
  assert.equal(resolveWidgetLabel("{missing}", {}, variables), "");
  assert.equal(resolveWidgetLabel(undefined, {}, variables), "");
  assert.equal(resolveWidgetLabel("{level}", { level: 7 }, variables), "7");
});

test("resolveWidgetLabel: label match by variable label name", () => {
  assert.equal(resolveWidgetLabel("X {Room name}", { roomName: "Lobby" }, variables), "X Lobby");
});

test("expandLabelNewlines: typed \\n becomes real newline", () => {
  assert.equal(expandLabelNewlines("Hello\\nWorld"), "Hello\nWorld");
  assert.equal(expandLabelNewlines("a\\nb\\nc"), "a\nb\nc");
});

test("expandLabelNewlines: real newlines preserved; bare backslash unchanged", () => {
  assert.equal(expandLabelNewlines("Hello\nWorld"), "Hello\nWorld");
  assert.equal(expandLabelNewlines("path\\to"), "path\\to");
  assert.equal(expandLabelNewlines("ok\\"), "ok\\");
  assert.equal(expandLabelNewlines("no escapes"), "no escapes");
});

test("formatWidgetLabel: vars then \\n; unresolved still hides", () => {
  assert.equal(formatWidgetLabel("Hello\\nWorld", {}, variables), "Hello\nWorld");
  assert.equal(formatWidgetLabel("Hi {roomName}\\nBye", { roomName: "Lobby" }, variables), "Hi Lobby\nBye");
  assert.equal(formatWidgetLabel("{missing}\\nX", {}, variables), "\nX");
  assert.equal(formatWidgetLabel("plain", {}, variables), "plain");
});

test("formatWidgetLabel: no double-expand of resulting newlines", () => {
  const once = formatWidgetLabel("A\\nB", {}, variables);
  assert.equal(once, "A\nB");
  assert.equal(expandLabelNewlines(once), "A\nB");
});

import {
  formatSystemTime,
  SYSTEM_TIME_VAR_ID,
  systemTimeVarSpec,
  withSystemTimeVar,
  writeConfiguredVar,
  seedVars,
} from "../src/lib/control/vars.ts";

test("formatSystemTime: HH:mm from given Date (OS-local Intl)", () => {
  const at = new Date(2026, 0, 15, 9, 5, 30); // local Jan 15 09:05
  assert.match(formatSystemTime(at), /^\d{2}:\d{2}$/);
  assert.equal(formatSystemTime(at), "09:05");
});

test("resolveTemplate: {time} expands to non-empty time-like string", () => {
  const out = resolveTemplate("Now {time}", {}, []);
  assert.match(String(out), /^Now \d{2}:\d{2}$/);
  // Stale stored value must not win — compute-on-read.
  const fresh = resolveTemplate("{time}", { time: "stale" }, [systemTimeVarSpec()]);
  assert.match(String(fresh), /^\d{2}:\d{2}$/);
  assert.notEqual(fresh, "stale");
});

test("resolveTemplate: unknown still hides; time label alias works when baked", () => {
  assert.equal(resolveTemplate("{missing}", {}, []), "");
  const baked = [systemTimeVarSpec()];
  assert.match(String(resolveTemplate("{Time}", {}, baked)), /^\d{2}:\d{2}$/);
});

test("resolveWidgetLabel / formatWidgetLabel: {time} present", () => {
  assert.match(resolveWidgetLabel("T={time}", {}, []), /^T=\d{2}:\d{2}$/);
  assert.match(formatWidgetLabel("{time}\\nok", {}, []), /^\d{2}:\d{2}\nok$/);
});

test("writeConfiguredVar: time is read-only; unknown still rejects", () => {
  const variables = [systemTimeVarSpec(), { id: "vol", label: "Vol", kind: "number", default: 0, min: 0, max: 100 }];
  const ro = writeConfiguredVar(variables, SYSTEM_TIME_VAR_ID, "12:00");
  assert.equal(ro.ok, false);
  assert.equal(ro.message, "Read-only variable");
  const unknown = writeConfiguredVar(variables, "nope", 1);
  assert.equal(unknown.ok, false);
});

test("withSystemTimeVar bakes and overwrites hijacked time var", () => {
  const next = withSystemTimeVar({
    room: {},
    variables: [{ id: "time", label: "Hijack", kind: "number", default: 0 }],
  });
  const row = next.variables.find((v) => v.id === "time");
  assert.equal(row?.label, "Time");
  assert.equal(row?.kind, "text");
});

test("seedVars omits system time (not stored)", () => {
  const cfg = withSystemTimeVar({ room: {}, variables: [{ id: "roomName", label: "Room", kind: "text", default: "A" }] });
  const seeded = seedVars(cfg, { time: "99:99", roomName: "B" });
  assert.equal("time" in seeded, false);
  assert.equal(seeded.roomName, "B");
});
