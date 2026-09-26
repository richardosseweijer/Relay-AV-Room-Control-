import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceTextSize,
  normalizeTextSizeFields,
  supportsTextSize,
  TEXT_SIZE_PAD_FRAC,
  widgetTextHeightFraction,
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

test("coerceTextSize defaults invalid/missing to md", () => {
  assert.equal(coerceTextSize(undefined), "md");
  assert.equal(coerceTextSize(null), "md");
  assert.equal(coerceTextSize("xl"), "md");
  assert.equal(coerceTextSize("sm"), "sm");
  assert.equal(coerceTextSize("md"), "md");
  assert.equal(coerceTextSize("lg"), "lg");
});

test("normalizeTextSizeFields fills md for button family; strips slider; no-op for preview/image", () => {
  assert.equal(normalizeTextSizeFields(widget("button")).textSize, "md");
  assert.equal(normalizeTextSizeFields(widget("label", { textSize: "lg" })).textSize, "lg");
  assert.equal(normalizeTextSizeFields(widget("status", { textSize: "nope" })).textSize, "md");
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

test("widgetTextHeightFraction: usable = 7/8 height; sm/md/lg = 1/4, 1/2, 1 of usable", () => {
  assert.equal(TEXT_SIZE_PAD_FRAC, 1 / 16);
  const usable = 1 - 2 * TEXT_SIZE_PAD_FRAC; // 7/8
  assert.equal(usable, 7 / 8);
  assert.equal(widgetTextHeightFraction("sm"), (1 / 4) * usable);
  assert.equal(widgetTextHeightFraction("md"), (1 / 2) * usable);
  assert.equal(widgetTextHeightFraction("lg"), 1 * usable);
  assert.equal(widgetTextHeightFraction(undefined), (1 / 2) * usable);
  assert.equal(widgetTextHeightFraction("nope"), (1 / 2) * usable);
});

test("widgetTextSizeStyle emits cqh body/chip/secondary sizes", () => {
  const md = widgetTextHeightFraction("md");
  assert.deepEqual(widgetBodyTextStyle("md"), {
    fontSize: `${md * 100}cqh`,
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetChipTextStyle("md"), {
    fontSize: `${md * 0.4 * 100}cqh`,
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetSecondaryTextStyle("lg"), {
    fontSize: `${widgetTextHeightFraction("lg") * 0.7 * 100}cqh`,
    lineHeight: 1.15,
  });
  assert.deepEqual(widgetLabelTileTextStyle("sm"), widgetTextSizeStyle("sm", "body"));
  assert.match(widgetBodyTextStyle("sm").fontSize, /cqh$/);
});
