import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  compareValue,
  enabled,
  friendlyError,
  readFeedback,
  widgetActive,
} from "../src/lib/control/panel-widget.ts";

test("control-panel imports widget helpers from panel-widget leaf", () => {
  const src = fs.readFileSync("src/components/panel/control-panel.tsx", "utf8");
  assert.match(src, /from\s+[\"']@\/lib\/control\/panel-widget[\"']/);
  assert.equal(/function readFeedback\s*\(/.test(src), false);
  assert.equal(/function compareValue\s*\(/.test(src), false);
  assert.equal(/function clauseOk\s*\(/.test(src), false);
  assert.equal(/function enabled\s*\(/.test(src), false);
  assert.equal(/function friendlyError\s*\(/.test(src), false);
  assert.equal(/function commandIsActive\s*\(/.test(src), false);
  assert.equal(/function sliderVariable\s*\(/.test(src), false);
  assert.equal(/function widgetActive\s*\(/.test(src), false);
  assert.match(src, /export function ControlPanel\s*\(/);
  const leaf = fs.readFileSync("src/lib/control/panel-widget.ts", "utf8");
  assert.match(leaf, /export function readFeedback\s*\(/);
  assert.match(leaf, /export function compareValue\s*\(/);
  assert.match(leaf, /export function clauseOk\s*\(/);
  assert.match(leaf, /export function enabled\s*\(/);
  assert.match(leaf, /export function friendlyError\s*\(/);
  assert.match(leaf, /export function commandIsActive\s*\(/);
  assert.match(leaf, /export function sliderVariable\s*\(/);
  assert.match(leaf, /export function widgetActive\s*\(/);
});

function snap(extra = {}) {
  return {
    vars: {},
    state: {},
    latches: {},
    activeScene: null,
    health: {},
    host: null,
    config: {
      room: { name: "Test" },
      devices: [{ id: "amp", name: "Amp", driver: "x.json", host: "1.2.3.4" }],
      pages: [{ id: "home", name: "Home", widgets: [] }],
      macros: [],
      variables: [],
      schedules: [],
      triggers: [],
      monitors: [],
    },
    ...extra,
  };
}

function widget(extra = {}) {
  return {
    id: "w1",
    type: "button",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    label: "Go",
    color: "steel",
    bind: { kind: "macro", id: "m1" },
    ...extra,
  };
}

test("compareValue: eq default is case-insensitive trim", () => {
  assert.equal(compareValue(" On ", undefined, "on"), true);
  assert.equal(compareValue("on", "neq", "off"), true);
  assert.equal(compareValue("10", "gt", "5"), true);
  assert.equal(compareValue("3", "lte", "3"), true);
});

test("enabled: all clauses must pass; unbound rule is open", () => {
  const s = snap({ vars: { mode: "live" }, state: { amp: { "power.state": "on" } } });
  assert.equal(enabled(s, widget()), true);
  assert.equal(
    enabled(s, widget({ enableWhen: { variable: "mode", equals: "live" } })),
    true,
  );
  assert.equal(
    enabled(s, widget({
      enableWhen: {
        equals: "",
        all: [
          { variable: "mode", equals: "live" },
          { device: "amp", feedback: "power.state", equals: "off" },
        ],
      },
    })),
    false,
  );
});

test("readFeedback and friendlyError stay operator-facing", () => {
  const s = snap({ state: { amp: { "power.state": "on" } } });
  assert.equal(readFeedback(s, "amp", "power.state"), "on");
  assert.equal(readFeedback(s, "", "power.state"), "");
  assert.equal(readFeedback(s, "amp", "missing"), "—");
  assert.match(friendlyError("amp timeout after 2s", s), /Amp didn’t answer/);
  assert.match(friendlyError("amp ECONNREFUSED", s), /isn’t on the network/);
  assert.match(friendlyError("mystery", s), /Device didn’t finish/);
});

test("widgetActive: confirm, latch, scene, and highlight=off", () => {
  const s = snap({
    activeScene: "m1",
    latches: { g1: "w1" },
  });
  assert.equal(widgetActive(s, widget(), true), true);
  assert.equal(widgetActive(s, widget({ highlight: "off" }), false), false);
  assert.equal(widgetActive(s, widget({ latchGroup: "g1" }), false), true);
  assert.equal(widgetActive(s, widget({ bind: { kind: "macro", id: "m1" } }), false), true);
  assert.equal(widgetActive(s, widget({ bind: { kind: "macro", id: "other" } }), false), false);
});
