import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { emptyRoomConfig, defaultDeviceState, hostDriverSeed, HOST_DRIVER, workingSetNames } from "../src/lib/control/defaults.ts";

test("empty room is Relay host only", () => {
  const cfg = emptyRoomConfig("1234");
  assert.equal(cfg.devices.length, 1);
  assert.equal(cfg.devices[0].id, "host");
  assert.equal(cfg.devices[0].driver, HOST_DRIVER);
  assert.equal(cfg.devices[0].host, "localhost");
  assert.equal(cfg.pages[0].widgets.length, 0);
  assert.deepEqual(cfg.pages[0].portraitGrid, { cols: 4, rows: 10 });
  assert.equal(cfg.macros.length, 0);
  assert.equal(cfg.room.name, "New room");
  assert.deepEqual(defaultDeviceState(), {});
  assert.deepEqual(Object.keys(hostDriverSeed()), [HOST_DRIVER]);
});

test("working set ignores stuffed persist keys", () => {
  const names = workingSetNames([{ driver: "extron-mps-602.json" }, { driver: "data/library/evil.json" }]);
  assert.deepEqual(new Set(names), new Set([HOST_DRIVER, "extron-mps-602.json", "evil.json"]));
  assert.equal(names.includes("lg-oled55c3.json"), false);
});

test("working set keeps unbound room copies already on disk", () => {
  const names = workingSetNames([{ driver: HOST_DRIVER }], ["samsung-tizen.json", "index.json"]);
  assert.ok(names.includes("samsung-tizen.json"));
  assert.equal(names.includes("index.json"), false);
});

test("joke driver is gone; Home Assistant is in the library", () => {
  assert.equal(fs.existsSync("src/lib/control/extra-drivers.ts"), false);
  assert.equal(fs.existsSync("data/library/Driver-voor-christiaans-kut-TV.json"), false);
  const ha = JSON.parse(fs.readFileSync("data/library/home-assistant.json", "utf8"));
  assert.equal(ha.device.manufacturer, "Home Assistant");
});

test("library index lists stock without command bodies", () => {
  const index = JSON.parse(fs.readFileSync("data/library/index.json", "utf8"));
  assert.equal(index[HOST_DRIVER].type, "host");
  assert.ok(index["samsung-qe50q65t.json"]);
  assert.ok(index["home-assistant.json"]);
  assert.equal(JSON.stringify(index).includes('"commands"'), false);
});

test("boot load does not iterate saved.drivers keys", () => {
  const src = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  const drivers = fs.readFileSync("src/lib/control/store-drivers.ts", "utf8");
  assert.ok(src.includes("workingSetNames(mem.config.devices, roomFiles)"));
  assert.equal(src.includes("Object.keys(saved.drivers)"), false);
  assert.ok(drivers.includes("(await readLibrarySpec(HOST_DRIVER)) ?? seed[HOST_DRIVER]"));
});

test("store.server re-exports driver disk I/O leaf", () => {
  const src = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  assert.match(src, /export \{[\s\S]*safeDriverName[\s\S]*writeDriverFile[\s\S]*removeDriverFile[\s\S]*readLibrarySpec[\s\S]*loadLibraryIndex[\s\S]*loadDriverFiles[\s\S]*pruneRoomDrivers[\s\S]*\} from "\.\/store-drivers"/);
  assert.equal(/export function safeDriverName\(/.test(src), false);
  assert.equal(/export async function loadDriverFiles\(/.test(src), false);
});

test("store.server re-exports secrets leaf", () => {
  const src = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  assert.match(src, /export \{\s*reloadSecretsFromDisk\s*\} from "\.\/store-secrets"/);
  assert.equal(/export async function reloadSecretsFromDisk\(/.test(src), false);
  assert.equal(/function pickSecrets\(/.test(src), false);
  assert.equal(/async function readSecretCandidate\(/.test(src), false);
  const leaf = fs.readFileSync("src/lib/control/store-secrets.ts", "utf8");
  assert.match(leaf, /export async function reloadSecretsFromDisk\s*\(/);
  assert.match(leaf, /export function pickSecrets\s*\(/);
  assert.match(leaf, /export async function readSecretCandidate\s*\(/);
});

test("store.server re-exports persist leaf", () => {
  const src = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  assert.match(src, /export \{\s*persist,\s*persistNow\s*\}/);
  assert.equal(/export async function persistNow\(/.test(src), false);
  assert.equal(/export function persist\(/.test(src), false);
  assert.equal(/async function flushPersist\(/.test(src), false);
  assert.equal(/async function writeFileStore\(/.test(src), false);
  const leaf = fs.readFileSync("src/lib/control/store-persist.ts", "utf8");
  assert.match(leaf, /export async function persistNow\s*\(/);
  assert.match(leaf, /export function persist\s*\(/);
  assert.match(leaf, /async function flushPersist\s*\(/);
  assert.match(leaf, /export const FILE_STORE/);
});

test("store.server re-exports normalize leaf", () => {
  const src = fs.readFileSync("src/lib/control/store.server.ts", "utf8");
  assert.match(src, /export \{\s*normalize,\s*normalizedConfig,\s*invalidateNormalizedConfig,\s*installRoomConfig,\s*\} from "\.\/store-normalize"/);
  assert.equal(/export function normalize\(/.test(src), false);
  assert.equal(/export function normalizedConfig\(/.test(src), false);
  assert.equal(/export function invalidateNormalizedConfig\(/.test(src), false);
  assert.equal(/export function installRoomConfig\(/.test(src), false);
  const leaf = fs.readFileSync("src/lib/control/store-normalize.ts", "utf8");
  assert.match(leaf, /export function normalize\s*\(/);
  assert.match(leaf, /export function normalizedConfig\s*\(/);
  assert.match(leaf, /export function invalidateNormalizedConfig\s*\(/);
  assert.match(leaf, /export function installRoomConfig\s*\(/);
  assert.match(leaf, /export function bindNormalizeInstallDeps\s*\(/);
});

