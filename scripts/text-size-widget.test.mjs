import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceTextSize,
  normalizeTextSizeFields,
  supportsTextSize,
  widgetBodyTextClass,
  widgetChipTextClass,
  widgetLabelTileTextClass,
} from "../src/lib/control/text-size-widget.ts";

function widget(type, extra = {}) {
  return {
    id: "w1",
    type,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    label: "Go",
    color: "steel",
    bind: { kind: "macro" },
    ...extra,
  };
}

test("supportsTextSize excludes preview and image", () => {
  assert.equal(supportsTextSize("button"), true);
  assert.equal(supportsTextSize("slider"), true);
  assert.equal(supportsTextSize("label"), true);
  assert.equal(supportsTextSize("status"), true);
  assert.equal(supportsTextSize("schedule"), true);
  assert.equal(supportsTextSize("preview"), false);
  assert.equal(supportsTextSize("image"), false);
});

test("coerceTextSize defaults invalid/missing to md", () => {
  assert.equal(coerceTextSize(undefined), "md");
  assert.equal(coerceTextSize(null), "md");
  assert.equal(coerceTextSize("xl"), "md");
  assert.equal(coerceTextSize("sm"), "sm");
  assert.equal(coerceTextSize("md"), "md");
  assert.equal(coerceTextSize("lg"), "lg");
});

test("normalizeTextSizeFields fills md for button family; no-op for preview/image", () => {
  assert.equal(normalizeTextSizeFields(widget("button")).textSize, "md");
  assert.equal(normalizeTextSizeFields(widget("slider", { textSize: "lg" })).textSize, "lg");
  assert.equal(normalizeTextSizeFields(widget("status", { textSize: "nope" })).textSize, "md");
  const preview = widget("preview", { streamUrl: "" });
  assert.equal(normalizeTextSizeFields(preview), preview);
  const image = widget("image");
  assert.equal(normalizeTextSizeFields(image), image);
});

test("widget text class helpers keep md as prior defaults", () => {
  assert.equal(widgetBodyTextClass("md"), "text-xl");
  assert.equal(widgetBodyTextClass("md", { status: true }), "text-3xl");
  assert.equal(widgetBodyTextClass("sm"), "text-base");
  assert.equal(widgetBodyTextClass("lg", { status: true }), "text-4xl");
  assert.equal(widgetChipTextClass("md"), "text-[11px]");
  assert.equal(widgetLabelTileTextClass("md"), "text-sm");
});
