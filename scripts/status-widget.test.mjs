import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { normalizeStatusFields, resolveStatusAppearance } from "../src/lib/control/status-widget.ts";

function statusWidget(extra = {}) {
  return {
    id: "s1",
    type: "status",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    label: "Power",
    color: "steel",
    bind: { kind: "variable", variable: "pwr" },
    ...extra,
  };
}

test("matched colorWhen row wins (first match, exact equals)", () => {
  const widget = statusWidget({
    colorWhen: [
      { equals: "on", color: "pine", label: "ON", macroId: "m-on" },
      { equals: "on", color: "rust", label: "second", macroId: "m-2" },
      { equals: "off", color: "rust", label: "OFF", macroId: "m-off" },
    ],
    statusDefault: { color: "fog", label: "?", macroId: "m-default" },
  });
  const got = resolveStatusAppearance(widget, "on");
  assert.equal(got.color, "pine");
  assert.equal(got.text, "ON");
  assert.equal(got.macroId, "m-on");
  assert.equal(got.matched, true);
  assert.equal(got.fromDefault, false);
});

test("exact equals is case-sensitive for v1", () => {
  const widget = statusWidget({
    colorWhen: [{ equals: "On", color: "pine" }],
    statusDefault: { color: "fog" },
  });
  assert.equal(resolveStatusAppearance(widget, "on").color, "fog");
  assert.equal(resolveStatusAppearance(widget, "On").color, "pine");
});

test("catch-all statusDefault when no rule matches", () => {
  const widget = statusWidget({
    colorWhen: [{ equals: "ok", color: "pine", macroId: "m-ok" }],
    statusDefault: { color: "clay", label: "Unknown", macroId: "m-fallback" },
  });
  const got = resolveStatusAppearance(widget, "weird");
  assert.equal(got.color, "clay");
  assert.equal(got.text, "Unknown");
  assert.equal(got.macroId, "m-fallback");
  assert.equal(got.matched, false);
  assert.equal(got.fromDefault, true);
});

test("press macro: matched row vs catch-all", () => {
  const widget = statusWidget({
    colorWhen: [{ equals: "1", color: "pine", macroId: "macro-match" }],
    statusDefault: { color: "fog", macroId: "macro-default" },
  });
  assert.equal(resolveStatusAppearance(widget, "1").macroId, "macro-match");
  assert.equal(resolveStatusAppearance(widget, "0").macroId, "macro-default");
});

test("legacy status without rules still shows raw var and widget.color", () => {
  const widget = statusWidget();
  const got = resolveStatusAppearance(widget, "hdmi");
  assert.equal(got.color, "steel");
  assert.equal(got.text, "hdmi");
  assert.equal(got.macroId, undefined);
  assert.equal(got.matched, false);
  assert.equal(got.fromDefault, false);
});

test("empty rules + no catch-all: press has no macro (no-op)", () => {
  const widget = statusWidget({ colorWhen: [] });
  assert.equal(resolveStatusAppearance(widget, "x").macroId, undefined);
});

test("rule label empty falls back to raw value", () => {
  const widget = statusWidget({
    colorWhen: [{ equals: "a", color: "ocean", label: "" }],
  });
  assert.equal(resolveStatusAppearance(widget, "a").text, "a");
});

test("normalizeStatusFields: missing OK; drops invalid; keeps valid", () => {
  const bare = normalizeStatusFields(statusWidget());
  assert.equal(bare.colorWhen, undefined);
  assert.equal(bare.statusDefault, undefined);

  const cleaned = normalizeStatusFields(statusWidget({
    colorWhen: [
      { equals: "ok", color: "pine", label: "OK", macroId: "m1" },
      { equals: "bad" },
      null,
    ],
    statusDefault: { label: "x" },
  }));
  assert.deepEqual(cleaned.colorWhen, [{ equals: "ok", color: "pine", label: "OK", macroId: "m1" }]);
  assert.equal(cleaned.statusDefault, null);
});

test("panel no longer hard-blocks status presses", () => {
  const src = fs.readFileSync("src/components/panel/control-panel.tsx", "utf8");
  assert.equal(src.includes('widget.type === "status" || widget.type === "label"'), false);
  assert.match(src, /resolveStatusAppearance/);
  assert.match(src, /statusMacroId/);
});

test("pages editor uses Status setup title and colorWhen editor", () => {
  const src = fs.readFileSync("src/components/config/pages-editor.tsx", "utf8");
  assert.match(src, /Status setup/);
  assert.match(src, /colorWhen/);
  assert.match(src, /statusDefault/);
  assert.match(src, /Catch-all color/);
});
