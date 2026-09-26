import assert from "node:assert/strict";
import test from "node:test";
import { resolveTemplate, resolveWidgetLabel } from "../src/lib/control/vars.ts";

const variables = [
  { id: "roomName", label: "Room name", kind: "text", default: "Default Room" },
  { id: "level", label: "Level", kind: "number", default: 0 },
];

test("resolveTemplate: known var expands", () => {
  assert.equal(resolveTemplate("Hello {roomName}", { roomName: "Lobby" }, variables), "Hello Lobby");
  assert.equal(resolveTemplate("{level}", { level: 42 }, variables), 42);
});

test("resolveTemplate: missing var hides token (empty, no braces)", () => {
  assert.equal(resolveTemplate("Hello {missing}", {}, variables), "Hello ");
  assert.equal(resolveTemplate("{missing}", {}, variables), "");
  assert.equal(resolveTemplate("{gone}!", { roomName: "Lobby" }, variables), "!");
});

test("resolveTemplate: multiple tokens + literal around", () => {
  const out = resolveTemplate("[{roomName}] / {level}", { roomName: "Lobby", level: 3 }, variables);
  assert.equal(out, "[Lobby] / 3");
});

test("resolveTemplate: defined var without live value uses default", () => {
  assert.equal(resolveTemplate("{roomName}", {}, variables), "Default Room");
});

test("resolveWidgetLabel: always string; empty raw ok", () => {
  assert.equal(resolveWidgetLabel("Hi {roomName}", { roomName: "A" }, variables), "Hi A");
  assert.equal(resolveWidgetLabel("{missing}", {}, variables), "");
  assert.equal(resolveWidgetLabel(undefined, {}, variables), "");
  assert.equal(resolveWidgetLabel("{level}", { level: 7 }, variables), "7");
});

test("resolveWidgetLabel: label match by variable label name", () => {
  assert.equal(resolveWidgetLabel("X {Room name}", { roomName: "Lobby" }, variables), "X Lobby");
});
