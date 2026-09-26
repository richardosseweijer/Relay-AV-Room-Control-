import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImageFields } from "../src/lib/control/image-widget.ts";

function imageWidget(extra = {}) {
  return {
    id: "img1",
    type: "image",
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    label: "Logo",
    color: "steel",
    bind: { kind: "macro" },
    ...extra,
  };
}

test("normalizeImageFields defaults imageFit to contain", () => {
  const out = normalizeImageFields(imageWidget());
  assert.equal(out.imageFit, "contain");
  assert.equal(out.imageSrc, undefined);
});

test("normalizeImageFields keeps cover; coerces invalid fit to contain", () => {
  assert.equal(normalizeImageFields(imageWidget({ imageFit: "cover" })).imageFit, "cover");
  assert.equal(normalizeImageFields(imageWidget({ imageFit: "fill" })).imageFit, "contain");
  assert.equal(normalizeImageFields(imageWidget({ imageFit: "" })).imageFit, "contain");
});

test("normalizeImageFields leaves imageSrc as string|undefined", () => {
  assert.equal(normalizeImageFields(imageWidget({ imageSrc: "/api/media/a.png" })).imageSrc, "/api/media/a.png");
  assert.equal(normalizeImageFields(imageWidget({ imageSrc: undefined })).imageSrc, undefined);
  assert.equal(normalizeImageFields(imageWidget({ imageSrc: null })).imageSrc, undefined);
});

test("normalizeImageFields is a no-op for non-image widgets", () => {
  const button = {
    id: "b1",
    type: "button",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    label: "Go",
    color: "steel",
    bind: { kind: "macro" },
  };
  assert.equal(normalizeImageFields(button), button);
});
