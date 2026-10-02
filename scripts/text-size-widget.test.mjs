import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceTextSize,
  normalizeTextSizeFields,
  supportsTextSize,
  TEXT_SIZE_REF_REM,
  TEXT_SIZE_BODY_REM,
  TEXT_SIZE_BODY_MAX_REM,
  TEXT_SIZE_BODY_MIN_REM,
  TEXT_SIZE_BODY_CQH_FRAC,
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

test("TEXT_SIZE_BODY_MAX_REM freezes former h=1 height fractions at TEXT_SIZE_REF_REM", () => {
  assert.equal(TEXT_SIZE_REF_REM, 8);
  assert.equal(TEXT_SIZE_BODY_MAX_REM, TEXT_SIZE_BODY_REM);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.xs, (7 / 64) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.sm, (7 / 32) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.md, (7 / 16) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.lg, (7 / 8) * TEXT_SIZE_REF_REM);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.xs, 0.875);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.sm, 1.75);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.md, 3.5);
  assert.equal(TEXT_SIZE_BODY_MAX_REM.lg, 7);
  assert.equal(widgetTextBodyRem(undefined), TEXT_SIZE_BODY_MAX_REM.md);
  assert.equal(widgetTextBodyRem("nope"), TEXT_SIZE_BODY_MAX_REM.md);
});

test("TEXT_SIZE_BODY_MIN_REM and CQH fracs match documented clamp design", () => {
  assert.deepEqual(TEXT_SIZE_BODY_MIN_REM, { xs: 0.75, sm: 1, md: 1.75, lg: 3.5 });
  assert.equal(TEXT_SIZE_BODY_CQH_FRAC.xs, 7 / 64);
  assert.equal(TEXT_SIZE_BODY_CQH_FRAC.sm, 7 / 32);
  assert.equal(TEXT_SIZE_BODY_CQH_FRAC.md, 7 / 16);
  assert.equal(TEXT_SIZE_BODY_CQH_FRAC.lg, 7 / 8);
});

test("widgetTextSizeStyle emits clamp(min rem, Ncqh, max rem) for body/chip/secondary", () => {
  assert.deepEqual(widgetBodyTextStyle("md"), {
    fontSize: "clamp(1.75rem, 43.75cqh, 3.5rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetBodyTextStyle("xs"), {
    fontSize: "clamp(0.75rem, 10.9375cqh, 0.875rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetBodyTextStyle("sm"), {
    fontSize: "clamp(1rem, 21.875cqh, 1.75rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetBodyTextStyle("lg"), {
    fontSize: "clamp(3.5rem, 87.5cqh, 7rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetChipTextStyle("md"), {
    fontSize: "clamp(0.7rem, 17.5cqh, 1.4rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetSecondaryTextStyle("lg"), {
    fontSize: "clamp(2.45rem, 61.25cqh, 4.9rem)",
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetLabelTileTextStyle("sm"), widgetTextSizeStyle("sm", "body"));
  assert.match(widgetBodyTextStyle("md").fontSize, /^clamp\(/);
  assert.match(widgetBodyTextStyle("md").fontSize, /cqh/);
  assert.match(widgetBodyTextStyle("md").fontSize, /rem/);
});
