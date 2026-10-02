import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceTextSize,
  normalizeTextSizeFields,
  supportsTextSize,
  TEXT_SIZE_REF_REM,
  TEXT_SIZE_BODY_REM,
  widgetTextBodyRem,
  widgetTextSizeStyle,
  widgetBodyTextStyle,
  widgetChipTextStyle,
  widgetLabelTileTextStyle,
  widgetSecondaryTextStyle,
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

test("supportsTextSize excludes preview, image, and slider", () => {
  assert.equal(supportsTextSize("button"), true);
  assert.equal(supportsTextSize("slider"), false);
  assert.equal(supportsTextSize("label"), true);
  assert.equal(supportsTextSize("status"), true);
  assert.equal(supportsTextSize("schedule"), true);
  assert.equal(supportsTextSize("preview"), false);
  assert.equal(supportsTextSize("image"), false);
});

test("coerceTextSize defaults invalid/missing to md; accepts xs", () => {
  assert.equal(coerceTextSize(undefined), "md");
  assert.equal(coerceTextSize(null), "md");
  assert.equal(coerceTextSize("xl"), "md");
  assert.equal(coerceTextSize("xs"), "xs");
  assert.equal(coerceTextSize("sm"), "sm");
  assert.equal(coerceTextSize("md"), "md");
  assert.equal(coerceTextSize("lg"), "lg");
});

test("normalizeTextSizeFields fills md for button family; strips slider; no-op for preview/image", () => {
  assert.equal(normalizeTextSizeFields(widget("button")).textSize, "md");
  assert.equal(normalizeTextSizeFields(widget("label", { textSize: "lg" })).textSize, "lg");
  assert.equal(normalizeTextSizeFields(widget("status", { textSize: "xs" })).textSize, "xs");
  assert.equal(normalizeTextSizeFields(widget("schedule", { textSize: "nope" })).textSize, "md");
  const sliderKeep = widget("slider");
  assert.equal(normalizeTextSizeFields(sliderKeep), sliderKeep);
  const sliderStrip = normalizeTextSizeFields(widget("slider", { textSize: "lg" }));
  assert.equal(sliderStrip.textSize, undefined);
  assert.equal("textSize" in sliderStrip, false);
  const preview = widget("preview", { streamUrl: "" });
  assert.equal(normalizeTextSizeFields(preview), preview);
  const image = widget("image");
  assert.equal(normalizeTextSizeFields(image), image);
});

test("TEXT_SIZE_BODY_REM freezes former h=1 height fractions at TEXT_SIZE_REF_REM", () => {
  assert.equal(TEXT_SIZE_REF_REM, 8);
  // Former: usable = 7/8; xs/sm/md/lg = 1/8, 1/4, 1/2, 1 of usable → 7/64, 7/32, 7/16, 7/8 of height
  assert.equal(TEXT_SIZE_BODY_REM.xs, (7 / 64) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_REM.sm, (7 / 32) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_REM.md, (7 / 16) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_REM.lg, (7 / 8) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_REM.xs, 0.875);
  assert.equal(TEXT_SIZE_BODY_REM.sm, 1.75);
  assert.equal(TEXT_SIZE_BODY_REM.md, 3.5);
  assert.equal(TEXT_SIZE_BODY_REM.lg, 7);
  assert.equal(widgetTextBodyRem(undefined), TEXT_SIZE_BODY_REM.md);
  assert.equal(widgetTextBodyRem("nope"), TEXT_SIZE_BODY_REM.md);
});

test("widgetTextSizeStyle emits fixed rem body/chip/secondary sizes (not cqh)", () => {
  assert.deepEqual(widgetBodyTextStyle("md"), {
    fontSize: "3.5rem",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetChipTextStyle("md"), {
    fontSize: `${3.5 * 0.4}rem`,
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetSecondaryTextStyle("lg"), {
    fontSize: `${7 * 0.7}rem`,
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetLabelTileTextStyle("sm"), widgetTextSizeStyle("sm", "body"));
  assert.match(widgetBodyTextStyle("xs").fontSize, /rem$/);
  assert.equal(widgetBodyTextStyle("xs").fontSize, "0.875rem");
  assert.equal(widgetBodyTextStyle("sm").fontSize, "1.75rem");
  assert.equal(widgetBodyTextStyle("lg").fontSize, "7rem");
  assert.equal(/cqh/.test(widgetBodyTextStyle("md").fontSize), false);
});
