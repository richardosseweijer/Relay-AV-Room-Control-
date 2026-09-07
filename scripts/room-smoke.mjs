import { executeCommand, runMacro, applyHost } from "../src/lib/control/engine.ts";

const lg = {
  specVersion: "2",
  device: { manufacturer: "LG", model: "OLED55C3", type: "display" },
  transports: { lan: { protocol: "tcp", port: 9761 } },
  commands: [
    { id: "power.on", label: "On", kind: "action", transport: "lan", payload: "ka 01 01", requires: [] },
    { id: "input.hdmi1", label: "HDMI 1", kind: "action", transport: "lan", payload: "xb 01 90", requires: ["power.state=on"] },
    { id: "volume.set", label: "Vol", kind: "range", min: 0, max: 100, transport: "lan", payload: "kf 01 {value:hex2}" },
  ],
  feedback: [],
};
const amp = {
  specVersion: "2",
  device: { manufacturer: "Generic", model: "AMP", type: "amplifier" },
  transports: { lan: { protocol: "http", port: 80 } },
  commands: [
    { id: "power.on", label: "On", kind: "action", transport: "lan", payload: "{\"cmd\":\"power\",\"value\":\"on\"}" },
  ],
  feedback: [],
};
const hostDrv = {
  specVersion: "2",
  device: { manufacturer: "Relay", model: "Host", type: "host" },
  transports: { lan: { protocol: "tcp", port: 0 } },
  commands: [{ id: "ui.toast", label: "Toast", kind: "action", transport: "lan", payload: "" }],
  feedback: [],
};

const config = {
  room: { name: "Smoke", configPin: "1152", panelPin: "1337", panelAccess: "pin", grid: { cols: 4, rows: 6 } },
  devices: [
    { id: "tv", name: "Display", driver: "lg.json", transport: "lan", host: "10.0.0.10", simulate: true, enabledFeatures: [], auth: {} },
    { id: "amp", name: "Amp", driver: "amp.json", transport: "lan", host: "10.0.0.11", simulate: true, enabledFeatures: [], auth: {} },
    { id: "pi", name: "Pi", driver: "relay-host.json", transport: "lan", host: "127.0.0.1", simulate: false, enabledFeatures: [], auth: {} },
  ],
  pages: [],
  macros: [{
    id: "present", label: "Present", retries: 0, onFail: { kind: "none" },
    steps: [
      { id: "s1", device: "tv", command: "power.on" },
      { id: "s2", device: "tv", command: "input.hdmi1" },
      { id: "s3", device: "amp", command: "power.on" },
      { id: "s4", device: "pi", command: "ui.toast", value: "Present" },
    ],
  }],
  variables: [], schedules: [], monitors: [], triggers: [], interfaces: [],
};
const drivers = { "lg.json": lg, "amp.json": amp, "relay-host.json": hostDrv };
const state = {};
const vars = {};
const host = { dim: false, locked: false, toast: null, block: null, pageId: null };
const rows = [];
function log(name, got, expect) {
  const ok = expect === undefined ? !!got.ok : Boolean(got.ok) === expect;
  rows.push({ name, ok, message: String(got.message ?? got.value ?? "") });
}

log("lg on payload", { ok: lg.commands[0].payload === "ka 01 01" });
const blocked = await executeCommand({ config, drivers, state, vars, host, deviceId: "tv", commandId: "input.hdmi1" });
log("hdmi blocked while off", blocked, false);
const on = await executeCommand({ config, drivers, state, vars, host, deviceId: "tv", commandId: "power.on" });
log("tv power.on", on, true);
log("power.state", { ok: state.tv["power.state"] === "on", message: String(state.tv["power.state"]) });
const hdmi = await executeCommand({ config, drivers, state, vars, host, deviceId: "tv", commandId: "input.hdmi1" });
log("hdmi after on", hdmi, true);
log("input.current", { ok: state.tv["input.current"] === "hdmi1", message: String(state.tv["input.current"]) });
const vol = await executeCommand({ config, drivers, state, vars, host, deviceId: "tv", commandId: "volume.set", value: 16 });
log("volume", vol, true);
log("volume.level", { ok: Number(state.tv["volume.level"]) === 16, message: String(state.tv["volume.level"]) });
const toast = await applyHost("ui.toast", "Hello", host, vars);
log("toast", toast, true);
log("toast text", { ok: host.toast === "Hello", message: String(host.toast) });
const present = await runMacro({ config, drivers, state, vars, host, macro: config.macros[0] });
log("macro", present, true);
log("amp on", { ok: state.amp["power.state"] === "on", message: String(state.amp?.["power.state"]) });

console.log(JSON.stringify(rows, null, 2));
console.log(rows.every((r) => r.ok) ? "SMOKE_OK" : "SMOKE_FAIL");
