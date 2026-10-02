import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  clearHostBlock,
  hostUiListenerCount,
  hostUiListenersReset,
  hostUiPublic,
  publishHostUi,
  subscribeHostUi,
} from "../src/lib/control/host-ui-bus.ts";
import { applyHost } from "../src/lib/control/engine-host.ts";

test("hostUiPublic normalizes nullish host", () => {
  assert.deepEqual(hostUiPublic(null), {
    dim: false,
    locked: false,
    toast: null,
    toastAt: undefined,
    block: null,
    blockAt: undefined,
    pageId: null,
    pageAt: undefined,
    fullscreenAt: undefined,
  });
});

test("subscribeHostUi receives publishHostUi payloads", () => {
  hostUiListenersReset();
  const seen = [];
  const unsub = subscribeHostUi((h) => seen.push(h));
  assert.equal(hostUiListenerCount(), 1);
  publishHostUi({ dim: true, locked: false, toast: null, block: "Please wait", blockAt: 42, pageId: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].dim, true);
  assert.equal(seen[0].block, "Please wait");
  assert.equal(seen[0].blockAt, 42);
  unsub();
  publishHostUi({ dim: false, locked: false, toast: null, block: null, pageId: "home" });
  assert.equal(seen.length, 1);
  assert.equal(hostUiListenerCount(), 0);
  hostUiListenersReset();
});

test("publishHostUi soft-fails a throwing listener", () => {
  hostUiListenersReset();
  const seen = [];
  subscribeHostUi(() => {
    throw new Error("boom");
  });
  subscribeHostUi((h) => seen.push(h.block));
  publishHostUi({ dim: false, locked: false, toast: null, block: "x", pageId: null });
  assert.deepEqual(seen, ["x"]);
  hostUiListenersReset();
});

test("clearHostBlock clears and publishes", () => {
  hostUiListenersReset();
  const seen = [];
  subscribeHostUi((h) => seen.push(h.block));
  const host = { dim: false, locked: false, toast: null, block: "Busy", pageId: null };
  assert.equal(clearHostBlock(host), true);
  assert.equal(host.block, null);
  assert.equal(typeof host.blockAt, "number");
  assert.deepEqual(seen, [null]);
  assert.equal(clearHostBlock(host), false);
  hostUiListenersReset();
});

test("applyHost ui.block/unblock publishes with blockAt", async () => {
  hostUiListenersReset();
  const seen = [];
  subscribeHostUi((h) => seen.push({ block: h.block, blockAt: h.blockAt }));
  const host = { dim: false, locked: false, toast: null, block: null, pageId: null };
  const block = await applyHost("ui.block", "Hold on", host);
  assert.equal(block.ok, true);
  assert.equal(host.block, "Hold on");
  assert.equal(typeof host.blockAt, "number");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].block, "Hold on");
  const unblock = await applyHost("ui.unblock", undefined, host);
  assert.equal(unblock.ok, true);
  assert.equal(host.block, null);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].block, null);
  hostUiListenersReset();
});

test("applyHost display.dim / panel.lock publish", async () => {
  hostUiListenersReset();
  const seen = [];
  subscribeHostUi((h) => seen.push({ dim: h.dim, locked: h.locked }));
  const host = { dim: false, locked: false, toast: null, block: null, pageId: null };
  await applyHost("display.dim", undefined, host);
  await applyHost("panel.lock", undefined, host);
  assert.deepEqual(seen, [
    { dim: true, locked: false },
    { dim: true, locked: true },
  ]);
  hostUiListenersReset();
});

test("GET /api/host is an SSE route with room-like rate-limit auth", () => {
  const src = fs.readFileSync(new URL("../src/routes/api/host.ts", import.meta.url), "utf8");
  assert.match(src, /text\/event-stream/);
  assert.match(src, /subscribeHostUi/);
  assert.match(src, /roomRateLimited/);
  assert.match(src, /validToken|Authorization|authorization/);
  assert.match(src, /createFileRoute\("\/api\/host"\)/);
});

test("control-panel EventSource + honest preview when SSE live", () => {
  const src = fs.readFileSync(new URL("../src/components/panel/control-panel.tsx", import.meta.url), "utf8");
  assert.match(src, /new EventSource\("\/api\/host"\)/);
  assert.match(src, /hostSseLive/);
  assert.match(src, /previewMacroId && !hostSseLive\.current/);
  assert.match(src, /applyHostFields/);
});

test("routeTree registers /api/host", () => {
  const src = fs.readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  assert.match(src, /api\/host/);
  assert.match(src, /ApiHostRoute/);
});

test("fail-clear paths use clearHostBlock", () => {
  const runtime = fs.readFileSync(new URL("../src/lib/control/actions-runtime.ts", import.meta.url), "utf8");
  const schedules = fs.readFileSync(new URL("../src/lib/control/store-schedules.ts", import.meta.url), "utf8");
  assert.match(runtime, /clearHostBlock\(mem\.host\)/);
  assert.match(schedules, /clearHostBlock/);
});
