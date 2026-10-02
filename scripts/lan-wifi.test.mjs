import test from "node:test";
import assert from "node:assert/strict";
import {
  isWirelessIfaceName,
  listWirelessIfaceNames,
  normalizeWifiSsid,
  normalizeWifiPsk,
  buildNmcliWifiRescanArgv,
  buildNmcliWifiListArgv,
  buildNmcliWifiConnectArgv,
  parseWifiListOutput,
  scrubWifiSecret,
  resolveLanWifiTarget,
  scanLanWifiViaNmcli,
  applyLanWifiViaNmcli,
  platformGate,
  LAN_WIFI_LINUX_ONLY,
  LAN_WIFI_SSID_REQUIRED,
  LAN_WIFI_NOT_WIRELESS,
  LAN_WIFI_LAN_UNSET,
  LAN_WIFI_NMCLI_MISSING,
} from "./lan-wifi.mjs";
import { listLanNicsFrom } from "../src/lib/control/nics.ts";

test("isWirelessIfaceName: sysfs wireless / phy80211", () => {
  const exists = (p) => p.endsWith("/wireless") && p.includes("wlan0");
  assert.equal(isWirelessIfaceName("wlan0", { existsSync: exists }), true);
  assert.equal(isWirelessIfaceName("eth0", { existsSync: exists }), false);
  const phy = (p) => p.endsWith("/phy80211") && p.includes("wlp1s0");
  assert.equal(isWirelessIfaceName("wlp1s0", { existsSync: phy }), true);
});

test("isWirelessIfaceName: name heuristic when sysfs misses", () => {
  const none = () => false;
  assert.equal(isWirelessIfaceName("wlan0", { existsSync: none }), true);
  assert.equal(isWirelessIfaceName("wlp2s0", { existsSync: none }), true);
  assert.equal(isWirelessIfaceName("wlx123abc", { existsSync: none }), true);
  assert.equal(isWirelessIfaceName("enp1s0", { existsSync: none }), false);
  assert.equal(isWirelessIfaceName("../wlan0", { existsSync: none }), false);
});

test("listWirelessIfaceNames filters lo and sorts", () => {
  const names = listWirelessIfaceNames({
    readdirSync: () => ["lo", "eth0", "wlan1", "wlan0"],
    existsSync: () => false,
  });
  assert.deepEqual(names, ["wlan0", "wlan1"]);
});

test("normalizeWifiSsid / PSK", () => {
  assert.equal(normalizeWifiSsid("").ok, false);
  assert.equal(normalizeWifiSsid("").message, LAN_WIFI_SSID_REQUIRED);
  assert.equal(normalizeWifiSsid("Venue WiFi").ssid, "Venue WiFi");
  assert.equal(normalizeWifiPsk("").ok, true);
  assert.equal(normalizeWifiPsk("", { required: true }).ok, false);
  assert.equal(normalizeWifiPsk("short").ok, false);
  assert.equal(normalizeWifiPsk("password1").psk, "password1");
  assert.equal(normalizeWifiPsk("z".repeat(64)).ok, false); // 64 non-hex
  assert.equal(normalizeWifiPsk("ab".repeat(32)).ok, true); // 64 hex
});

test("buildNmcli wifi argv", () => {
  assert.deepEqual(buildNmcliWifiRescanArgv("wlan0"), [
    "device", "wifi", "rescan", "ifname", "wlan0",
  ]);
  assert.deepEqual(buildNmcliWifiListArgv("wlan0"), [
    "-t", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "device", "wifi", "list", "ifname", "wlan0",
  ]);
  assert.deepEqual(buildNmcliWifiConnectArgv("Cafe", "wlan0", "secret12"), [
    "device", "wifi", "connect", "Cafe", "ifname", "wlan0", "password", "secret12",
  ]);
  assert.deepEqual(buildNmcliWifiConnectArgv("OpenNet", "wlan0", ""), [
    "device", "wifi", "connect", "OpenNet", "ifname", "wlan0",
  ]);
});

test("parseWifiListOutput: escape, dedupe, sort by signal", () => {
  const text = [
    "Cafe\\:Main:80:WPA2:*",
    "Cafe\\:Main:40:WPA2:",
    "Other:90:WPA3:",
    ":10:WPA2:", // hidden / empty SSID dropped
    "Weak:5:WEP:",
  ].join("\n");
  const rows = parseWifiListOutput(text);
  assert.deepEqual(rows.map((r) => r.ssid), ["Other", "Cafe:Main", "Weak"]);
  assert.equal(rows[1].signal, 80);
  assert.equal(rows[1].inUse, true);
});

test("scrubWifiSecret strips password tokens", () => {
  assert.match(scrubWifiSecret("failed password hunter2 more", "hunter2"), /password \*\*\*/);
  assert.equal(scrubWifiSecret("x hunter2 y", "hunter2").includes("hunter2"), false);
});

test("resolveLanWifiTarget requires wireless outbound pick", () => {
  const nics = listLanNicsFrom(
    {
      enp1s0: [{ address: "10.0.0.1", family: "IPv4", internal: false }],
      wlan0: [{ address: "192.168.1.5", family: "IPv4", internal: false }],
    },
    { isWireless: (n) => n === "wlan0" },
  );
  const resolveNic = (list, pick) => {
    if (pick.name) return list.find((n) => n.name === pick.name) ?? null;
    return list.find((n) => n.index === pick.index) ?? null;
  };
  assert.equal(resolveLanWifiTarget({}, nics, resolveNic).message, LAN_WIFI_LAN_UNSET);
  assert.equal(resolveLanWifiTarget({ name: "enp1s0" }, nics, resolveNic).message, LAN_WIFI_NOT_WIRELESS);
  const ok = resolveLanWifiTarget({ name: "wlan0" }, nics, resolveNic);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.nic.name, "wlan0");
});

test("platformGate linux only", () => {
  assert.equal(platformGate("linux").ok, true);
  assert.equal(platformGate("win32").message, LAN_WIFI_LINUX_ONLY);
});

test("scanLanWifiViaNmcli: soft-fail when radio/list errors", async () => {
  const res = await scanLanWifiViaNmcli({
    device: "wlan0",
    rescan: false,
    runNmcli: async (argv) => {
      if (argv[0] === "networking") return { code: 0, stdout: "enabled\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "Error: Device 'wlan0' not available.\n" };
    },
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.networks, []);
  assert.match(res.message, /not available|scan failed|Wi‑Fi/i);
});

test("scanLanWifiViaNmcli: missing nmcli", async () => {
  const res = await scanLanWifiViaNmcli({
    device: "wlan0",
    rescan: false,
    runNmcli: async () => ({
      code: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawn nmcli ENOENT"), { code: "ENOENT" }),
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, LAN_WIFI_NMCLI_MISSING);
});

test("scanLanWifiViaNmcli: parses list", async () => {
  const res = await scanLanWifiViaNmcli({
    device: "wlan0",
    rescan: false,
    runNmcli: async (argv) => {
      if (argv[0] === "networking") return { code: 0, stdout: "enabled\n", stderr: "" };
      return { code: 0, stdout: "Venue:70:WPA2:\n", stderr: "" };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.networks[0].ssid, "Venue");
});

test("applyLanWifiViaNmcli: connect argv + success", async () => {
  /** @type {string[][]} */
  const sudoCalls = [];
  const res = await applyLanWifiViaNmcli({
    device: "wlan0",
    ssid: "Venue",
    psk: "password1",
    runNmcli: async (argv, opts) => {
      if (argv[0] === "networking") return { code: 0, stdout: "", stderr: "" };
      if (opts?.sudo) sudoCalls.push(argv);
      return { code: 0, stdout: "connected\n", stderr: "" };
    },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(sudoCalls[0], [
    "device", "wifi", "connect", "Venue", "ifname", "wlan0", "password", "password1",
  ]);
});

test("listLanNicsFrom marks wireless in label", () => {
  const nics = listLanNicsFrom(
    {
      wlan0: [{ address: "10.0.0.8", family: "IPv4", internal: false }],
      enp1s0: [{ address: "10.0.25.10", family: "IPv4", internal: false }],
    },
    { isWireless: (n) => n === "wlan0" },
  );
  const wifi = nics.find((n) => n.name === "wlan0");
  assert.equal(wifi?.wireless, true);
  assert.match(wifi?.label ?? "", /wifi/);
  assert.equal(nics.find((n) => n.name === "enp1s0")?.wireless, false);
});
