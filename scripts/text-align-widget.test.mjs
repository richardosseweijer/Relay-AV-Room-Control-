import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceTextAlign,
  normalizeTextAlignFields,
  supportsTextAlign,
  textAlignClass,
  textAlignJustifyClass,
  textAlignItemsClass,
} from "../src/lib/control/text-align-widget.ts";

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

test("supportsTextAlign only label/button/status", () => {
  assert.equal(supportsTextAlign("label"), true);
  assert.equal(supportsTextAlign("button"), true);
  assert.equal(supportsTextAlign("status"), true);
  assert.equal(supportsTextAlign("slider"), false);
  assert.equal(supportsTextAlign("schedule"), false);
  assert.equal(supportsTextAlign("preview"), false);
  assert.equal(supportsTextAlign("image"), false);
});

test("coerceTextAlign defaults invalid/missing to left (prior look)", () => {
  assert.equal(coerceTextAlign(undefined), "left");
  assert.equal(coerceTextAlign(null), "left");
  assert.equal(coerceTextAlign("middle"), "left");
  assert.equal(coerceTextAlign("left"), "left");
  assert.equal(coerceTextAlign("center"), "center");
  assert.equal(coerceTextAlign("right"), "right");
});

test("normalizeTextAlignFields fills left for label/button/status; no-op for others", () => {
  assert.equal(normalizeTextAlignFields(widget("label")).textAlign, "left");
  assert.equal(normalizeTextAlignFields(widget("button")).textAlign, "left");
  assert.equal(normalizeTextAlignFields(widget("status", { textAlign: "right" })).textAlign, "right");
  assert.equal(normalizeTextAlignFields(widget("status", { textAlign: "nope" })).textAlign, "left");
  const slider = widget("slider");
  assert.equal(normalizeTextAlignFields(slider), slider);
  const schedule = widget("schedule");
  assert.equal(normalizeTextAlignFields(schedule), schedule);
  const preview = widget("preview", { streamUrl: "" });
  assert.equal(normalizeTextAlignFields(preview), preview);
  const image = widget("image");
  assert.equal(normalizeTextAlignFields(image), image);
});

test("textAlign class helpers map left/center/right", () => {
  assert.equal(textAlignClass(undefined), "text-left");
  assert.equal(textAlignClass("left"), "text-left");
  assert.equal(textAlignClass("center"), "text-center");
  assert.equal(textAlignClass("right"), "text-right");
  assert.equal(textAlignJustifyClass(undefined), "justify-start");
  assert.equal(textAlignJustifyClass("center"), "justify-center");
  assert.equal(textAlignJustifyClass("right"), "justify-end");
  assert.equal(textAlignItemsClass("left"), "items-start");
  assert.equal(textAlignItemsClass("center"), "items-center");
  assert.equal(textAlignItemsClass("right"), "items-end");
});
