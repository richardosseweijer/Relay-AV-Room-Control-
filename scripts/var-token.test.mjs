import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyVarToken, openVarToken, templateNumericOnly, varTokenChoices } from "../src/lib/control/var-token.ts";

const variables = [
  { id: "level", label: "Level", kind: "number", default: 0 },
  { id: "roomName", label: "Room name", kind: "text", default: "" },
  { id: "mode", label: "Mode", kind: "enum", default: "off", values: ["off", "on"] },
];

test("time id stays the built-in clock", () => {
  const vars = fs.readFileSync("src/lib/control/vars.ts", "utf8");
  assert.match(vars, /export const SYSTEM_TIME_VAR_ID = "time"/);
  assert.match(vars, /label: "Time"/);
});

test("openVarToken finds an unclosed brace and ignores a finished token", () => {
  assert.deepEqual(openVarToken("Hello {occ", 10), { start: 6, query: "occ" });
  assert.equal(openVarToken("Hello {occupancy} ", 18), null);
  assert.deepEqual(openVarToken("{occ} and {le", 14), { start: 10, query: "le" });
  assert.equal(openVarToken("plain", 5), null);
  assert.deepEqual(openVarToken("{", 1), { start: 0, query: "" });
});

test("applyVarToken inserts the id and keeps text after the caret", () => {
  const next = applyVarToken("Hi {oc there", 3, 6, "occupancy");
  assert.equal(next.value, "Hi {occupancy} there");
  assert.equal(next.caret, 3 + "{occupancy}".length);
});

test("varTokenChoices: numbers only on numeric fields; time is text", () => {
  const all = varTokenChoices(variables, "", false).map((v) => v.id);
  assert.deepEqual(all, ["time", "level", "roomName", "mode"]);
  const nums = varTokenChoices(variables, "", true).map((v) => v.id);
  assert.deepEqual(nums, ["level"]);
  const filtered = varTokenChoices(variables, "room", false).map((v) => v.id);
  assert.deepEqual(filtered, ["roomName"]);
  const byLabel = varTokenChoices(variables, "lev", true).map((v) => v.id);
  assert.deepEqual(byLabel, ["level"]);
});

test("templateNumericOnly is bounds, range, number writes, and gt/lt — not raw text", () => {
  assert.equal(templateNumericOnly({ bound: true }), true);
  assert.equal(templateNumericOnly({ commandKind: "range" }), true);
  assert.equal(templateNumericOnly({ commandKind: "enum" }), false);
  assert.equal(templateNumericOnly({ varKind: "number" }), true);
  assert.equal(templateNumericOnly({ varKind: "text" }), false);
  assert.equal(templateNumericOnly({ compare: "gt" }), true);
  assert.equal(templateNumericOnly({ compare: "lt" }), true);
  assert.equal(templateNumericOnly({ compare: "eq" }), false);
  assert.equal(templateNumericOnly({ raw: true, bound: true }), false);
  assert.equal(templateNumericOnly({}), false);
});

test("template fields share VarTokenField; literal compares do not", () => {
  const editor = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  const bind = fs.readFileSync("src/components/config/pages-bind-fields.tsx", "utf8");
  const status = fs.readFileSync("src/components/config/pages-status-fields.tsx", "utf8");
  const macros = fs.readFileSync("src/components/config/macros-tab.tsx", "utf8");
  const triggers = fs.readFileSync("src/components/config/trigger-pane.tsx", "utf8");
  const enable = fs.readFileSync("src/components/config/pages-enable-when.tsx", "utf8");
  for (const src of [editor, bind, status, macros, triggers]) assert.match(src, /VarTokenField/);
  assert.match(bind, /templateNumericOnly\(\{ bound: true \}\)/);
  assert.match(macros, /templateNumericOnly/);
  assert.match(triggers, /templateNumericOnly/);
  assert.doesNotMatch(enable, /VarTokenField/);
  assert.match(status, /placeholder="equals"/);
  assert.doesNotMatch(triggers, /<datalist/);
});
