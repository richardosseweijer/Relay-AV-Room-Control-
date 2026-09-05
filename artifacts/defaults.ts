import type { DriverSpec, RoomConfig } from "./types";

export const DEFAULT_CONFIG_PIN = "1234";

export const lgDisplayDriver: DriverSpec = {
  specVersion: "1.0",
  device: { manufacturer: "LG", model: "OLED55C3", type: "display", notes: "IP control demo driver. Simulated by default." },
  transports: {
    lan: { protocol: "tcp", port: 9761, encoding: "ascii", lineEnding: "\r", timeoutMs: 1000 },
    rs232: { baud: 9600, dataBits: 8, parity: "none", stopBits: 1, encoding: "ascii", lineEnding: "\r", timeoutMs: 1000 },
  },
  auth: { type: "none", instanceFields: [] },
  session: { connect: [], keepalive: { payload: null, intervalMs: 0 }, disconnect: [] },
  pacing: { minIntervalMs: 120, powerOnDelayMs: 3000 },
  probe: { transport: "lan", payload: "ka 01 ff", success: { type: "contains", value: "OK" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "ka 01 01", requires: [], ack: { success: { type: "contains", value: "OK" } } },
    { id: "power.off", label: "Power Off", kind: "action", transport: "lan", payload: "ka 01 00", requires: [], ack: { success: { type: "contains", value: "OK" } } },
    { id: "volume.set", label: "Set Volume", kind: "range", min: 0, max: 100, step: 1, unit: "%", transport: "lan", payload: "kf 01 {value:hex2}", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
    { id: "input.hdmi1", label: "HDMI 1", kind: "action", transport: "lan", payload: "xb 01 90", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
    { id: "input.hdmi2", label: "HDMI 2", kind: "action", transport: "lan", payload: "xb 01 91", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
    { id: "input.usb", label: "USB", kind: "action", transport: "lan", payload: "xb 01 10", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
    { id: "mute.on", label: "Mute", kind: "action", transport: "lan", payload: "ke 01 01", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
    { id: "mute.off", label: "Unmute", kind: "action", transport: "lan", payload: "ke 01 00", requires: ["power.state=on"], ack: { success: { type: "contains", value: "OK" } } },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "ka 01 ff", pollMs: 2000, parse: { type: "regex", pattern: "OK([0-9A-Fa-f]+)", map: { "00": "off", "01": "on" } } },
    { id: "volume.level", label: "Volume", kind: "range", min: 0, max: 100, transport: "lan", mode: "poll", query: "kf 01 ff", pollMs: 2000, parse: { type: "regex", pattern: "OK([0-9A-Fa-f]+)" } },
    { id: "input.current", label: "Input", kind: "enum", values: ["hdmi1", "hdmi2", "usb"], transport: "lan", mode: "poll", query: "xb 01 ff", pollMs: 3000, parse: { type: "contains", value: "OK" } },
    { id: "mute.state", label: "Mute", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "ke 01 ff", pollMs: 3000, parse: { type: "regex", pattern: "OK([0-9A-Fa-f]+)", map: { "00": "off", "01": "on" } } },
  ],
};

export const ampDriver: DriverSpec = {
  specVersion: "1.0",
  device: { manufacturer: "Generic", model: "LAN-AMP", type: "amplifier", notes: "HTTP JSON demo amplifier." },
  transports: { lan: { protocol: "http", port: 80, timeoutMs: 1500, http: { method: "POST", path: "/api", contentType: "application/json" } } },
  auth: { type: "none", instanceFields: [] },
  pacing: { minIntervalMs: 80, powerOnDelayMs: 800 },
  probe: { transport: "lan", payload: "{\"cmd\":\"ping\"}", success: { type: "contains", value: "ok" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "{\"cmd\":\"power\",\"value\":\"on\"}" },
    { id: "power.off", label: "Power Off", kind: "action", transport: "lan", payload: "{\"cmd\":\"power\",\"value\":\"off\"}" },
    { id: "volume.set", label: "Set Volume", kind: "range", min: 0, max: 80, step: 1, unit: "dB", transport: "lan", payload: "{\"cmd\":\"volume\",\"value\":{value}}" },
    { id: "source.tv", label: "Source TV", kind: "action", transport: "lan", payload: "{\"cmd\":\"source\",\"value\":\"tv\"}" },
    { id: "source.aux", label: "Source Aux", kind: "action", transport: "lan", payload: "{\"cmd\":\"source\",\"value\":\"aux\"}" },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "{\"cmd\":\"power?\"}", pollMs: 2000, parse: { type: "jsonpath", path: "power" } },
    { id: "volume.level", label: "Volume", kind: "range", min: 0, max: 80, transport: "lan", mode: "poll", query: "{\"cmd\":\"volume?\"}", pollMs: 2000, parse: { type: "jsonpath", path: "volume" } },
    { id: "source.current", label: "Source", kind: "enum", values: ["tv", "aux"], transport: "lan", mode: "poll", query: "{\"cmd\":\"source?\"}", pollMs: 3000, parse: { type: "jsonpath", path: "source" } },
  ],
};

export const lightsDriver: DriverSpec = {
  specVersion: "1.0",
  device: { manufacturer: "Generic", model: "RoomLights", type: "lighting" },
  transports: { lan: { protocol: "http", port: 8088, timeoutMs: 1200, http: { method: "PUT", path: "/light", contentType: "application/json" } } },
  auth: { type: "token", instanceFields: ["token"] },
  pacing: { minIntervalMs: 50 },
  probe: { transport: "lan", payload: "{}", success: { type: "contains", value: "ok" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "power.on", label: "Lights On", kind: "action", transport: "lan", payload: "{\"on\":true}" },
    { id: "power.off", label: "Lights Off", kind: "action", transport: "lan", payload: "{\"on\":false}" },
    { id: "level.set", label: "Dimmer", kind: "range", min: 0, max: 100, step: 1, unit: "%", transport: "lan", payload: "{\"bri\":{value}}" },
    { id: "scene.present", label: "Present scene", kind: "action", transport: "lan", payload: "{\"scene\":\"present\"}" },
    { id: "scene.movie", label: "Movie scene", kind: "action", transport: "lan", payload: "{\"scene\":\"movie\"}" },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", pollMs: 2500, parse: { type: "jsonpath", path: "on" } },
    { id: "level.value", label: "Level", kind: "range", min: 0, max: 100, transport: "lan", mode: "poll", pollMs: 2500, parse: { type: "jsonpath", path: "bri" } },
    { id: "scene.current", label: "Scene", kind: "enum", values: ["present", "movie", "off"], transport: "lan", mode: "poll", pollMs: 4000, parse: { type: "jsonpath", path: "scene" } },
  ],
};

export const blindsDriver: DriverSpec = {
  specVersion: "1.0",
  device: { manufacturer: "Generic", model: "ShadeBus", type: "shades" },
  transports: { lan: { protocol: "tcp", port: 23, encoding: "ascii", lineEnding: "\r\n", timeoutMs: 1500 } },
  auth: { type: "none" },
  pacing: { minIntervalMs: 200 },
  probe: { transport: "lan", payload: "STATUS", success: { type: "contains", value: "OK" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "position.open", label: "Open", kind: "action", transport: "lan", payload: "OPEN" },
    { id: "position.close", label: "Close", kind: "action", transport: "lan", payload: "CLOSE" },
    { id: "position.set", label: "Set position", kind: "range", min: 0, max: 100, step: 5, unit: "%", transport: "lan", payload: "POS {value}" },
  ],
  feedback: [{ id: "position.level", label: "Position", kind: "range", min: 0, max: 100, transport: "lan", mode: "poll", query: "STATUS", pollMs: 3000, parse: { type: "regex", pattern: "POS=(\\d+)" } }],
};

export const ptzDriver: DriverSpec = {
  specVersion: "1.0",
  device: { manufacturer: "Generic", model: "PTZ-20x", type: "camera" },
  transports: { lan: { protocol: "http", port: 80, timeoutMs: 2000, http: { method: "GET", path: "/cgi-bin/ptz" } } },
  auth: { type: "password", instanceFields: ["user", "password"] },
  pacing: { minIntervalMs: 150 },
  probe: { transport: "lan", payload: "cmd=version", success: { type: "contains", value: "PTZ" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "preset.1", label: "Preset 1", kind: "action", transport: "lan", payload: "cmd=preset&n=1" },
    { id: "preset.2", label: "Preset 2", kind: "action", transport: "lan", payload: "cmd=preset&n=2" },
    { id: "preset.3", label: "Preset 3", kind: "action", transport: "lan", payload: "cmd=preset&n=3" },
    { id: "power.on", label: "Camera On", kind: "action", transport: "lan", payload: "cmd=power&v=on" },
    { id: "power.off", label: "Camera Off", kind: "action", transport: "lan", payload: "cmd=power&v=off" },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", pollMs: 4000, parse: { type: "contains", value: "on" } },
    { id: "preset.current", label: "Preset", kind: "enum", values: ["1", "2", "3"], transport: "lan", mode: "poll", pollMs: 4000, parse: { type: "regex", pattern: "preset=(\\d+)" } },
  ],
};

export const samsungQ65tDriver: DriverSpec = {
  specVersion: "1.0",
  device: {
    manufacturer: "Samsung",
    model: "QE50Q65TASXXN",
    type: "display",
    notes: "2020 Q65T Tizen. First connect shows Allow on the TV. Start on port 8001. If the set only accepts a token, switch the device port to 8002 and paste the token in auth.token. Power on/off keys work on 2019+ firmware; use Power toggle if one of them is ignored.",
  },
  transports: {
    lan: {
      protocol: "websocket",
      port: 8001,
      timeoutMs: 8000,
      http: { path: "/api/v2/channels/samsung.remote.control" },
    },
    rs232: { baud: 9600, dataBits: 8, parity: "none", stopBits: 1, encoding: "ascii", lineEnding: "\r", timeoutMs: 1000 },
  },
  auth: {
    type: "token",
    instanceFields: ["token", "name"],
    pairing: {
      kind: "websocket-handshake",
      ports: [8001, 8002],
      tlsPorts: [8002],
      path: "/api/v2/channels/samsung.remote.control",
      discoverPath: "/api/v2/",
      query: { nameParam: "name", tokenParam: "token", nameFrom: "auth.name" },
      waitContains: "ms.channel.connect",
      commandAck: "none",
      tokenJsonPath: "token",
      userPrompt: "Accept Allow on the TV. If Probe returns a token, save it and use port 8002.",
    },
  },
  pacing: { minIntervalMs: 250, powerOnDelayMs: 4000 },
  probe: { transport: "lan", payload: "", success: { type: "contains", value: "ms.channel" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "power.off", label: "Power Off", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "power.toggle", label: "Power toggle", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "volume.up", label: "Volume up", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLUP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "volume.down", label: "Volume down", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLDOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "mute.on", label: "Mute", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "mute.off", label: "Unmute", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}" },
    { id: "input.hdmi1", label: "HDMI 1", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI1\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}", requires: ["power.state=on"] },
    { id: "input.hdmi2", label: "HDMI 2", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI2\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}", requires: ["power.state=on"] },
    { id: "input.hdmi3", label: "HDMI 3", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI3\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}", requires: ["power.state=on"] },
    { id: "input.source", label: "Source list", kind: "action", transport: "lan", payload: "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_SOURCE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}", requires: ["power.state=on"] },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "", pollMs: 4000, parse: { type: "contains", value: "ms.channel.connect" } },
    { id: "input.current", label: "Input", kind: "enum", values: ["hdmi1", "hdmi2", "hdmi3"], transport: "lan", mode: "poll", pollMs: 8000, parse: { type: "contains", value: "ms.channel" } },
  ],
};

export const hueBridgeDriver: DriverSpec = {
  specVersion: "1.0",
  device: {
    manufacturer: "Philips",
    model: "Hue Bridge",
    type: "lighting",
    notes: "Press the button on the bridge, then Probe. Save the username token. group 0 = all lights.",
  },
  transports: {
    lan: { protocol: "http", port: 80, timeoutMs: 3000, http: { method: "PUT", path: "/api", contentType: "application/json" } },
  },
  auth: {
    type: "token",
    instanceFields: ["token", "group"],
    pairing: {
      kind: "http-handshake",
      ports: [80, 443],
      path: "/api",
      discoverPath: "/api/config",
      tokenJsonPath: "username",
      userPrompt: "Press the link button on the Hue bridge, then Probe. Save the token it prints.",
    },
  },
  pacing: { minIntervalMs: 80 },
  probe: { transport: "lan", payload: "{\"devicetype\":\"relay#room\"}", success: { type: "contains", value: "username" } },
  helpers: { checksum: "none" },
  commands: [
    { id: "power.on", label: "Lights On", kind: "action", transport: "lan", httpMethod: "PUT", httpPath: "/api/{auth.token}/groups/{auth.group}/action", payload: "{\"on\":true}" },
    { id: "power.off", label: "Lights Off", kind: "action", transport: "lan", httpMethod: "PUT", httpPath: "/api/{auth.token}/groups/{auth.group}/action", payload: "{\"on\":false}" },
    { id: "level.set", label: "Brightness", kind: "range", min: 0, max: 254, step: 1, unit: "bri", transport: "lan", httpMethod: "PUT", httpPath: "/api/{auth.token}/groups/{auth.group}/action", payload: "{\"bri\":{value}}" },
    { id: "scene.relax", label: "Relax", kind: "action", transport: "lan", httpMethod: "PUT", httpPath: "/api/{auth.token}/groups/{auth.group}/action", payload: "{\"scene\":\"relax\"}" },
    { id: "scene.concentrate", label: "Concentrate", kind: "action", transport: "lan", httpMethod: "PUT", httpPath: "/api/{auth.token}/groups/{auth.group}/action", payload: "{\"scene\":\"concentrate\"}" },
  ],
  feedback: [
    { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "", pollMs: 4000, parse: { type: "contains", value: "on" } },
    { id: "level.value", label: "Level", kind: "range", min: 0, max: 254, transport: "lan", mode: "poll", pollMs: 4000, parse: { type: "jsonpath", path: "bri" } },
  ],
};

export const bundledDrivers: Record<string, DriverSpec> = {
  "lg-oled55c3.json": lgDisplayDriver,
  "samsung-qe50q65t.json": samsungQ65tDriver,
  "philips-hue-bridge.json": hueBridgeDriver,
  "lan-amp.json": ampDriver,
  "room-lights.json": lightsDriver,
  "shade-bus.json": blindsDriver,
  "ptz-20x.json": ptzDriver,
};

export function defaultRoomConfig(): RoomConfig {
  return {
    configVersion: "1.0",
    exportedAt: null,
    sourceRoomId: null,
    room: {
      id: "room-a",
      name: "Conference A",
      panelAccess: "open",
      panelPin: null,
      configPin: DEFAULT_CONFIG_PIN,
      theme: "dark",
      idleDimSeconds: 90,
      grid: { cols: 6, rows: 8 },
      network: { mode: "dhcp", address: "10.0.10.10", prefix: 24, gateway: "10.0.10.1", dns: "10.0.10.1", ntp: "pool.ntp.org", timezone: "Europe/Brussels", hostname: "relay-room-a" },
    },
    devices: [
      { id: "tv", name: "Display", driver: "lg-oled55c3.json", transport: "lan", host: "10.0.10.21", auth: {}, enabledFeatures: ["power.on", "power.off", "volume.set", "input.hdmi1", "input.hdmi2", "input.usb", "mute.on", "mute.off", "power.state", "volume.level", "input.current", "mute.state"], simulate: true },
      { id: "amp", name: "Amplifier", driver: "lan-amp.json", transport: "lan", host: "10.0.10.22", auth: {}, enabledFeatures: ["power.on", "power.off", "volume.set", "source.tv", "source.aux", "power.state", "volume.level", "source.current"], simulate: true },
      { id: "lights", name: "Lights", driver: "room-lights.json", transport: "lan", host: "10.0.10.30", auth: {}, enabledFeatures: ["power.on", "power.off", "level.set", "scene.present", "scene.movie", "power.state", "level.value", "scene.current"], simulate: true },
      { id: "blinds", name: "Blinds", driver: "shade-bus.json", transport: "lan", host: "10.0.10.31", auth: {}, enabledFeatures: ["position.open", "position.close", "position.set", "position.level"], simulate: true },
      { id: "cam", name: "Camera", driver: "ptz-20x.json", transport: "lan", host: "10.0.10.40", auth: {}, enabledFeatures: ["preset.1", "preset.2", "preset.3", "power.on", "power.off", "power.state", "preset.current"], simulate: true },
    ],
    pages: [
      {
        id: "home",
        label: "Home",
        grid: { cols: 6, rows: 8 },
        widgets: [
          { id: "w-watch", type: "button", x: 0, y: 0, w: 2, h: 2, label: "Watch", color: "steel", icon: "tv", confirm: false, bind: { kind: "macro", id: "watch-tv" } },
          { id: "w-present", type: "button", x: 2, y: 0, w: 2, h: 2, label: "Present", color: "sage", icon: "presentation", confirm: false, bind: { kind: "macro", id: "present" } },
          { id: "w-off", type: "button", x: 4, y: 0, w: 2, h: 2, label: "All Off", color: "clay", icon: "power", confirm: true, bind: { kind: "macro", id: "all-off" } },
          { id: "w-tv-pwr", type: "status", x: 0, y: 2, w: 3, h: 1, label: "Display", color: "fog", icon: "monitor", bind: { kind: "variable", variable: "tvPower" } },
          { id: "w-amp-pwr", type: "status", x: 3, y: 2, w: 3, h: 1, label: "Amp", color: "fog", icon: "speaker", bind: { kind: "variable", variable: "ampPower" } },
          { id: "w-vol", type: "slider", x: 0, y: 3, w: 6, h: 1, label: "Volume", color: "steel", enableWhen: { device: "tv", feedback: "power.state", equals: "on" }, min: "{volMin}", max: "{volMax}", bind: { kind: "range", device: "tv", command: "volume.set", feedback: "volume.level", variable: "watchVol" } },
          { id: "w-lights", type: "slider", x: 0, y: 4, w: 6, h: 1, label: "Lights", color: "sage", bind: { kind: "range", device: "lights", command: "level.set", feedback: "level.value" } },
          { id: "w-blinds", type: "slider", x: 0, y: 5, w: 6, h: 1, label: "Blinds", color: "fog", bind: { kind: "range", device: "blinds", command: "position.set", feedback: "position.level" } },
          { id: "w-src", type: "button", x: 0, y: 6, w: 3, h: 2, label: "Sources", color: "ink", icon: "waypoints", bind: { kind: "macro", id: "open-sources", gotoPage: "sources" } },
          { id: "w-cam", type: "button", x: 3, y: 6, w: 3, h: 2, label: "Camera", color: "ink", icon: "video", bind: { kind: "macro", id: "open-camera", gotoPage: "camera" } },
        ],
      },
      {
        id: "sources",
        label: "Sources",
        grid: { cols: 6, rows: 6 },
        widgets: [
          { id: "s-home", type: "button", x: 0, y: 0, w: 2, h: 1, label: "Home", color: "ink", icon: "house", bind: { kind: "macro", id: "open-home", gotoPage: "home" } },
          { id: "s-title", type: "label", x: 2, y: 0, w: 4, h: 1, label: "Inputs", color: "fog", bind: { kind: "macro", id: "open-sources" } },
          { id: "s-hdmi1", type: "button", x: 0, y: 1, w: 3, h: 2, label: "HDMI 1", color: "ocean", icon: "hdmi", enableWhen: { device: "tv", feedback: "power.state", equals: "on" }, bind: { kind: "macro", id: "input-hdmi1" } },
          { id: "s-hdmi2", type: "button", x: 3, y: 1, w: 3, h: 2, label: "HDMI 2", color: "ocean", icon: "hdmi", enableWhen: { device: "tv", feedback: "power.state", equals: "on" }, bind: { kind: "macro", id: "input-hdmi2" } },
          { id: "s-usb", type: "button", x: 0, y: 3, w: 3, h: 2, label: "USB", color: "slate", bind: { kind: "macro", id: "input-usb" } },
          { id: "s-aux", type: "button", x: 3, y: 3, w: 3, h: 2, label: "Amp Aux", color: "pine", bind: { kind: "macro", id: "source-aux" } },
        ],
      },
      {
        id: "camera",
        label: "Camera",
        grid: { cols: 6, rows: 6 },
        widgets: [
          { id: "c-home", type: "button", x: 0, y: 0, w: 2, h: 1, label: "Home", color: "ink", icon: "house", bind: { kind: "macro", id: "open-home", gotoPage: "home" } },
          { id: "c-st", type: "status", x: 2, y: 0, w: 4, h: 1, label: "Preset", color: "fog", bind: { kind: "variable", variable: "camPreset" } },
          { id: "c-p1", type: "button", x: 0, y: 1, w: 2, h: 2, label: "Desk", color: "ocean", icon: "user", bind: { kind: "macro", id: "cam-desk" } },
          { id: "c-p2", type: "button", x: 2, y: 1, w: 2, h: 2, label: "Board", color: "ocean", icon: "users", bind: { kind: "macro", id: "cam-board" } },
          { id: "c-p3", type: "button", x: 4, y: 1, w: 2, h: 2, label: "Wide", color: "ocean", icon: "scan", bind: { kind: "macro", id: "cam-wide" } },
          { id: "c-on", type: "button", x: 0, y: 3, w: 3, h: 2, label: "Camera On", color: "pine", bind: { kind: "macro", id: "cam-on" } },
          { id: "c-off", type: "button", x: 3, y: 3, w: 3, h: 2, label: "Camera Off", color: "clay", confirm: true, bind: { kind: "macro", id: "cam-off" } },
        ],
      },
    ],
    macros: [
      { id: "watch-tv", label: "Watch TV", retries: 2, onFail: { kind: "none" }, steps: [
        { device: "tv", command: "power.on", skipIf: { feedback: "power.state", equals: "on" }, delayMsAfter: 400 },
        { device: "amp", command: "power.on", skipIf: { feedback: "power.state", equals: "on" }, delayMsAfter: 200 },
        { device: "tv", command: "input.hdmi1", delayMsAfter: 150 },
        { device: "amp", command: "source.tv", delayMsAfter: 150 },
        { device: "tv", command: "volume.set", value: "{watchVol}", delayMsAfter: 80 },
        { device: "lights", command: "scene.movie", delayMsAfter: 80 },
        { device: "blinds", command: "position.set", value: 20 },
      ] },
      { id: "present", label: "Present", retries: 2, onFail: { kind: "none" }, steps: [
        { device: "tv", command: "power.on", skipIf: { feedback: "power.state", equals: "on" }, delayMsAfter: 400 },
        { device: "amp", command: "power.on", delayMsAfter: 200 },
        { device: "tv", command: "input.hdmi2", delayMsAfter: 150 },
        { device: "tv", command: "volume.set", value: "{presentVol}", delayMsAfter: 80 },
        { device: "lights", command: "scene.present", delayMsAfter: 80 },
        { device: "blinds", command: "position.open", delayMsAfter: 80 },
        { device: "cam", command: "power.on", delayMsAfter: 80 },
        { device: "cam", command: "preset.2" },
      ] },
      { id: "all-off", label: "All Off", retries: 1, onFail: { kind: "none" }, steps: [
        { device: "tv", command: "power.off", delayMsAfter: 120 },
        { device: "amp", command: "power.off", delayMsAfter: 120 },
        { device: "cam", command: "power.off", delayMsAfter: 120 },
        { device: "lights", command: "power.off", delayMsAfter: 80 },
        { device: "blinds", command: "position.close" },
      ] },
      { id: "open-home", label: "Open Home", retries: 0, onFail: { kind: "none" }, steps: [] },
      { id: "open-sources", label: "Open Sources", retries: 0, onFail: { kind: "none" }, steps: [] },
      { id: "open-camera", label: "Open Camera", retries: 0, onFail: { kind: "none" }, steps: [] },
      { id: "input-hdmi1", label: "HDMI 1", retries: 1, onFail: { kind: "none" }, steps: [{ device: "tv", command: "input.hdmi1" }] },
      { id: "input-hdmi2", label: "HDMI 2", retries: 1, onFail: { kind: "none" }, steps: [{ device: "tv", command: "input.hdmi2" }] },
      { id: "input-usb", label: "USB", retries: 1, onFail: { kind: "none" }, steps: [{ device: "tv", command: "input.usb" }] },
      { id: "source-aux", label: "Amp Aux", retries: 1, onFail: { kind: "none" }, steps: [{ device: "amp", command: "source.aux" }] },
      { id: "cam-desk", label: "Camera Desk", retries: 1, onFail: { kind: "none" }, steps: [{ device: "cam", command: "preset.1" }] },
      { id: "cam-board", label: "Camera Board", retries: 1, onFail: { kind: "none" }, steps: [{ device: "cam", command: "preset.2" }] },
      { id: "cam-wide", label: "Camera Wide", retries: 1, onFail: { kind: "none" }, steps: [{ device: "cam", command: "preset.3" }] },
      { id: "cam-on", label: "Camera On", retries: 1, onFail: { kind: "none" }, steps: [{ device: "cam", command: "power.on" }] },
      { id: "cam-off", label: "Camera Off", retries: 1, onFail: { kind: "none" }, steps: [{ device: "cam", command: "power.off" }] },
    ],
    variables: [
      { id: "volMin", label: "Volume min", kind: "number", default: 0, min: 0, max: 100, step: 1 },
      { id: "volMax", label: "Volume max", kind: "number", default: 40, min: 0, max: 100, step: 1 },
      { id: "watchVol", label: "Watch volume", kind: "number", default: 22, min: 0, max: 100, step: 1 },
      { id: "presentVol", label: "Present volume", kind: "number", default: 18, min: 0, max: 100, step: 1 },
      { id: "tvPower", label: "Display power", kind: "enum", default: "off", values: ["off", "on"] },
      { id: "ampPower", label: "Amp power", kind: "enum", default: "off", values: ["off", "on"] },
      { id: "camPreset", label: "Camera preset", kind: "enum", default: "1", values: ["1", "2", "3"] },
    ],
    schedules: [{ id: "weekday-off", label: "Weeknight all off", enabled: false, time: "22:00", days: [1, 2, 3, 4, 5], macroId: "all-off" }],
    monitors: [
      { id: "mon-tv-power", label: "Display power", enabled: true, device: "tv", feedback: "power.state", pollMs: 2000, writeVar: "tvPower", mapMode: "raw", map: [] },
      { id: "mon-amp-power", label: "Amp power", enabled: true, device: "amp", feedback: "power.state", pollMs: 2000, writeVar: "ampPower", mapMode: "raw", map: [] },
      { id: "mon-cam-preset", label: "Camera preset", enabled: true, device: "cam", feedback: "preset.current", pollMs: 3000, writeVar: "camPreset", mapMode: "raw", map: [] },
    ],
  };
}

export function emptyRoomConfig(pin = DEFAULT_CONFIG_PIN): RoomConfig {
  const demo = defaultRoomConfig();
  return {
    configVersion: "1.0",
    exportedAt: null,
    sourceRoomId: null,
    room: { ...demo.room, id: "room", name: "New room", panelAccess: "open", panelPin: null, configPin: pin },
    devices: [],
    pages: [{ id: "home", label: "Home", grid: { ...demo.room.grid }, widgets: [] }],
    macros: [],
    variables: [],
    schedules: [],
    monitors: [],
  };
}

export function defaultDeviceState(): Record<string, Record<string, string | number | boolean>> {
  return {
    tv: { "power.state": "off", "volume.level": 18, "input.current": "hdmi1", "mute.state": "off" },
    amp: { "power.state": "off", "volume.level": 30, "source.current": "tv" },
    lights: { "power.state": "on", "level.value": 70, "scene.current": "present" },
    blinds: { "position.level": 40 },
    cam: { "power.state": "off", "preset.current": "1" },
  };
}
