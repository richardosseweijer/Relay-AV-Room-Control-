import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROOM_THEME_LABELS,
  THEME_CHROME,
  resolveRoomTheme,
} from "../src/lib/theme.ts";

describe("resolveRoomTheme", () => {
  it("keeps known themes including glass", () => {
    assert.equal(resolveRoomTheme("dark"), "dark");
    assert.equal(resolveRoomTheme("glass-dark"), "glass-dark");
    assert.equal(resolveRoomTheme("glass-light"), "glass-light");
    assert.equal(resolveRoomTheme("peach"), "peach");
    assert.equal(resolveRoomTheme("green"), "green");
    assert.equal(resolveRoomTheme("office"), "office");
  });

  it("maps legacy aliases and falls back to dark", () => {
    assert.equal(resolveRoomTheme("pastel"), "peach");
    assert.equal(resolveRoomTheme("lilac"), "peach");
    assert.equal(resolveRoomTheme("coral"), "office");
    assert.equal(resolveRoomTheme(null), "dark");
    assert.equal(resolveRoomTheme(undefined), "dark");
    assert.equal(resolveRoomTheme("nope"), "dark");
  });

  it("labels and chrome cover every RoomTheme id", () => {
    for (const id of Object.keys(ROOM_THEME_LABELS)) {
      assert.equal(typeof ROOM_THEME_LABELS[id], "string");
      assert.ok(ROOM_THEME_LABELS[id].length > 0);
      assert.match(THEME_CHROME[id], /^#[0-9a-fA-F]{6}$/);
    }
    assert.equal(ROOM_THEME_LABELS["glass-dark"], "Glass dark");
    assert.equal(ROOM_THEME_LABELS["glass-light"], "Glass light");
  });
});
