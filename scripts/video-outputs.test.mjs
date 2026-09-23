import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isPhysicalConnector,
  scanDrmConnectors,
  listVideoOutputs,
  resolveVideoOutput,
  kioskEnvBody,
  isForbiddenKioskHost,
} from "./video-outputs.mjs";

test("isPhysicalConnector filters writeback/virtual/tv", () => {
  assert.equal(isPhysicalConnector("card0-HDMI-A-1"), true);
  assert.equal(isPhysicalConnector("card0-DP-1"), true);
  assert.equal(isPhysicalConnector("card0-Writeback-1"), false);
  assert.equal(isPhysicalConnector("card0-Virtual-1"), false);
  assert.equal(isPhysicalConnector("card0-TV-1"), false);
});

test("listVideoOutputs: DRM fixture — connected first, indexed labels", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-drm-"));
  try {
    for (const [name, status] of [
      ["card0-HDMI-A-1", "disconnected"],
      ["card0-HDMI-A-2", "connected"],
      ["card0-Writeback-1", "connected"],
      ["card0-DP-1", "connected"],
    ]) {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, "status"), `${status}\n`);
    }
    const rows = listVideoOutputs(root);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].name, "DP-1");
    assert.equal(rows[0].connected, true);
    assert.equal(rows[0].index, 0);
    assert.match(rows[0].label, /^0 — /);
    assert.equal(rows[1].name, "HDMI-A-2");
    assert.equal(rows[2].name, "HDMI-A-1");
    assert.equal(rows[2].connected, false);
    assert.match(rows[2].label, /unplugged/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listVideoOutputs: empty DRM → local fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-drm-empty-"));
  try {
    const rows = listVideoOutputs(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "local");
    assert.equal(rows[0].connected, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanDrmConnectors returns raw rows", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-drm-scan-"));
  try {
    mkdirSync(join(root, "card0-HDMI-A-1"));
    writeFileSync(join(root, "card0-HDMI-A-1", "status"), "connected\n");
    const found = scanDrmConnectors(root);
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "HDMI-A-1");
    assert.equal(found[0].connected, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVideoOutput: name preferred over index", () => {
  const outputs = [
    { index: 0, name: "HDMI-A-1", connected: true, label: "0 — HDMI-A-1" },
    { index: 1, name: "HDMI-A-2", connected: true, label: "1 — HDMI-A-2" },
  ];
  const byName = resolveVideoOutput(
    { panelHdmiOutputName: "HDMI-A-2", panelHdmiOutputIndex: 0 },
    outputs,
  );
  assert.equal(byName?.name, "HDMI-A-2");
  const byIndex = resolveVideoOutput(
    { panelHdmiOutputName: null, panelHdmiOutputIndex: 1 },
    outputs,
  );
  assert.equal(byIndex?.name, "HDMI-A-2");
});

test("kioskEnvBody: RELAY_VIDEO_OUTPUT + RELAY_KIOSK_URL", () => {
  const outputs = [
    { index: 0, name: "HDMI-A-1", connected: true, label: "0 — HDMI-A-1" },
  ];
  const body = kioskEnvBody(
    { panelHdmiOutputName: "HDMI-A-1", panelHdmiOutputIndex: 0 },
    "http://10.0.25.10:8081/",
    outputs,
  );
  assert.equal(body, "RELAY_VIDEO_OUTPUT=HDMI-A-1\nRELAY_KIOSK_URL=http://10.0.25.10:8081/\n");
});

test("isForbiddenKioskHost: 0.0.0.0 / ::", () => {
  assert.equal(isForbiddenKioskHost("0.0.0.0"), true);
  assert.equal(isForbiddenKioskHost("::"), true);
  assert.equal(isForbiddenKioskHost("[::]"), true);
  assert.equal(isForbiddenKioskHost(""), true);
  assert.equal(isForbiddenKioskHost("10.0.25.10"), false);
  assert.equal(isForbiddenKioskHost("127.0.0.1"), false);
});
