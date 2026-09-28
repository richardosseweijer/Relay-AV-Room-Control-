import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { latchGroupOptions, suggestMatches, valueSuggestions } from "../src/lib/control/suggest.ts";
import { duplicateLabel } from "../src/components/config/config-ui.ts";

const options = [
  { id: "mps", label: "Projector" },
  { id: "mic", label: "Mic level" },
];

test("suggestMatches shows the full list for an empty or exact query", () => {
  assert.equal(suggestMatches(options, "").length, 2);
  assert.equal(suggestMatches(options, "Projector").length, 2);
  assert.equal(suggestMatches(options, "mic").length, 2);
  assert.deepEqual(suggestMatches(options, "mi").map((row) => row.id), ["mic"]);
});

test("valueSuggestions: macros, pages, enum values; empty enum stays quiet", () => {
  const macros = valueSuggestions({ commandId: "macro.run", macros: [{ id: "none", label: "None" }, { id: "start", label: "Start" }] });
  assert.deepEqual(macros.map((row) => row.id), ["start"]);
  const pages = valueSuggestions({ commandId: "ui.page", pages: [{ id: "pg-main", label: "Main" }] });
  assert.equal(pages[0].hint, "pg-main");
  const occ = valueSuggestions({ varId: "occupancy", varKind: "enum", varValues: ["0", "1"] });
  assert.equal(occ[0].label, "Closed");
  assert.equal(occ[0].hint, "0");
  assert.deepEqual(valueSuggestions({ commandId: "ui.toast", commandKind: "enum", commandValues: [] }), []);
  assert.deepEqual(valueSuggestions({ commandKind: "range", commandValues: ["1"] }), []);
  assert.deepEqual(valueSuggestions({ commandKind: "enum", commandValues: ["hdmi"] }).map((row) => row.id), ["hdmi"]);
});

test("latch groups dedupe blanks", () => {
  assert.deepEqual(latchGroupOptions([" sources ", "", "sources", "scene"]).map((row) => row.id), ["sources", "scene"]);
});

test("long lists and value hints use the shared field", () => {
  const macros = fs.readFileSync("src/components/config/macros-tab.tsx", "utf8");
  const triggers = fs.readFileSync("src/components/config/trigger-pane.tsx", "utf8");
  const bind = fs.readFileSync("src/components/config/pages-bind-fields.tsx", "utf8");
  const status = fs.readFileSync("src/components/config/pages-status-fields.tsx", "utf8");
  const enable = fs.readFileSync("src/components/config/pages-enable-when.tsx", "utf8");
  const logic = fs.readFileSync("src/components/config/logic-tab.tsx", "utf8");
  const preview = fs.readFileSync("src/components/config/pages-preview-fields.tsx", "utf8");
  const image = fs.readFileSync("src/components/config/pages-image-fields.tsx", "utf8");
  for (const src of [macros, triggers, bind, status, enable, logic, preview, image]) assert.match(src, /SuggestField/);
  assert.match(macros, /valueSuggestions/);
  assert.match(triggers, /valueSuggestions/);
  assert.match(logic, /valueSuggestions/);
  assert.match(bind, /latchGroupOptions/);
  assert.doesNotMatch(enable, /VarTokenField/);
  assert.doesNotMatch(status, /equals[\s\S]{0,180}VarTokenField/);
});

test("duplicate label stays unique", () => {
  assert.equal(duplicateLabel(["Lights"], "Lights"), "Lights copy");
  assert.equal(duplicateLabel(["Lights", "Lights copy"], "Lights"), "Lights copy copy");
  assert.equal(duplicateLabel([], "  "), "Copy copy");
  const macros = fs.readFileSync("src/components/config/macros-tab.tsx", "utf8");
  const triggers = fs.readFileSync("src/components/config/trigger-pane.tsx", "utf8");
  const logic = fs.readFileSync("src/components/config/logic-tab.tsx", "utf8");
  for (const src of [macros, triggers, logic]) assert.match(src, /Duplicate/);
  assert.match(logic, /mon-\$\{Date\.now/);
  assert.match(logic, /sch-\$\{Date\.now/);
});
