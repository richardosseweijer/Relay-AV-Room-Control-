import type { DriverSpec } from "./types";

export const extraDrivers: Record<string, DriverSpec> = {
  "google-chromecast.json": {
    specVersion: "1.0",
    device: { manufacturer: "Google", model: "Chromecast", type: "source", notes: "Cast on TCP 8009. Play/Pause use the live media session. Volume 0–100 → 0–1." },
    transports: { lan: { protocol: "cast", port: 8009, timeoutMs: 5000 } },
    auth: { type: "none" },
    pacing: { minIntervalMs: 250 },
    probe: { transport: "lan", payload: "{\"type\":\"GET_STATUS\",\"requestId\":1}", success: { type: "contains", value: "status" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "status.get", label: "Status", kind: "action", transport: "lan", payload: "{\"type\":\"GET_STATUS\",\"requestId\":1}" },
      { id: "power.off", label: "Stop / idle", kind: "action", transport: "lan", payload: "{\"type\":\"STOP\",\"requestId\":2}" },
      { id: "mute.on", label: "Mute", kind: "action", transport: "lan", payload: "{\"type\":\"SET_VOLUME\",\"requestId\":3,\"volume\":{\"muted\":true}}" },
      { id: "mute.off", label: "Unmute", kind: "action", transport: "lan", payload: "{\"type\":\"SET_VOLUME\",\"requestId\":4,\"volume\":{\"muted\":false}}" },
      { id: "volume.set", label: "Volume", kind: "range", min: 0, max: 100, step: 1, transport: "lan", valueMap: { kind: "float", inMin: 0, inMax: 100, outMin: 0, outMax: 1, decimals: 3 }, payload: "{\"type\":\"SET_VOLUME\",\"requestId\":5,\"volume\":{\"level\":{value}}}" },
      { id: "app.youtube", label: "YouTube", kind: "action", transport: "lan", payload: "{\"type\":\"LAUNCH\",\"requestId\":6,\"appId\":\"233637DE\"}" },
      { id: "app.netflix", label: "Netflix", kind: "action", transport: "lan", payload: "{\"type\":\"LAUNCH\",\"requestId\":7,\"appId\":\"CA5E8412\"}" },
      { id: "app.spotify", label: "Spotify", kind: "action", transport: "lan", payload: "{\"type\":\"LAUNCH\",\"requestId\":8,\"appId\":\"CC32E753\"}" },
      { id: "app.backdrop", label: "Backdrop", kind: "action", transport: "lan", payload: "{\"type\":\"LAUNCH\",\"requestId\":9,\"appId\":\"E8C28D3C\"}" },
      { id: "media.play", label: "Play", kind: "action", transport: "lan", namespace: "urn:x-cast:com.google.cast.media", payload: "{\"type\":\"PLAY\",\"mediaSessionId\":1,\"requestId\":10}" },
      { id: "media.pause", label: "Pause", kind: "action", transport: "lan", namespace: "urn:x-cast:com.google.cast.media", payload: "{\"type\":\"PAUSE\",\"mediaSessionId\":1,\"requestId\":11}" },
      { id: "media.stop", label: "Stop", kind: "action", transport: "lan", namespace: "urn:x-cast:com.google.cast.media", payload: "{\"type\":\"STOP\",\"mediaSessionId\":1,\"requestId\":12}" },
      { id: "media.next", label: "Next", kind: "action", transport: "lan", namespace: "urn:x-cast:com.google.cast.media", payload: "{\"type\":\"QUEUE_NEXT\",\"mediaSessionId\":1,\"requestId\":13}" },
      { id: "media.prev", label: "Previous", kind: "action", transport: "lan", namespace: "urn:x-cast:com.google.cast.media", payload: "{\"type\":\"QUEUE_PREV\",\"mediaSessionId\":1,\"requestId\":14}" },
    ],
    feedback: [
      { id: "status.raw", label: "Status", kind: "string", transport: "lan", mode: "poll", query: "{\"type\":\"GET_STATUS\",\"requestId\":1}", pollMs: 8000, parse: { type: "jsonpath", path: "type" } },
      { id: "volume.level", label: "Volume", kind: "range", min: 0, max: 1, transport: "lan", mode: "poll", query: "{\"type\":\"GET_STATUS\",\"requestId\":1}", pollMs: 8000, parse: { type: "jsonpath", path: "status.volume.level" } },
      { id: "app.current", label: "App", kind: "string", transport: "lan", mode: "poll", query: "{\"type\":\"GET_STATUS\",\"requestId\":1}", pollMs: 8000, parse: { type: "jsonpath", path: "status.applications.0.displayName" } },
    ],
  },
  "pjlink-projector.json": {
    specVersion: "1.0",
    device: { manufacturer: "Generic", model: "PJLink Class 1", type: "projector", notes: "TCP 4352. Password in auth.password if PJLINK 1." },
    transports: { lan: { protocol: "pjlink", port: 4352, timeoutMs: 2500 } },
    auth: { type: "password", instanceFields: ["password"] },
    pacing: { minIntervalMs: 200, powerOnDelayMs: 8000 },
    probe: { transport: "lan", payload: "%1POWR ?", success: { type: "contains", value: "POWR" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "%1POWR 1" },
      { id: "power.off", label: "Power Off", kind: "action", transport: "lan", payload: "%1POWR 0" },
      { id: "mute.on", label: "AV Mute", kind: "action", transport: "lan", payload: "%1AVMT 31" },
      { id: "mute.off", label: "AV Mute Off", kind: "action", transport: "lan", payload: "%1AVMT 30" },
      { id: "input.hdmi1", label: "HDMI 1", kind: "action", transport: "lan", payload: "%1INPT 32" },
      { id: "input.hdmi2", label: "HDMI 2", kind: "action", transport: "lan", payload: "%1INPT 33" },
    ],
    feedback: [
      { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "%1POWR ?", pollMs: 4000, parse: { type: "contains", value: "=1" } },
    ],
  },
  "extron-ipl-t-sfi244.json": {
    specVersion: "2",
    device: {
      manufacturer: "Extron",
      model: "IPL T SFI244",
      type: "other",
      notes: "SIS on TCP 23. Factory IP 192.168.254.254. Leave the unit password empty for first tests. COM1/COM2 raw passthrough is TCP 2001/2002 — point the attached device’s own driver at those ports. IR play needs .eir files loaded with IR Learner / Global Configurator (file + function numbers).",
    },
    transports: { lan: { protocol: "tcp", port: 23, timeoutMs: 2500, lineEnding: "\r", session: { keepMs: 15000 } } },
    auth: { type: "password", instanceFields: ["password"] },
    pacing: { minIntervalMs: 80 },
    probe: { transport: "lan", payload: "Q", success: { type: "contains", value: "" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "io.1.on", label: "I/O 1 On", kind: "action", transport: "lan", payload: "1*1]" },
      { id: "io.1.off", label: "I/O 1 Off", kind: "action", transport: "lan", payload: "1*0]" },
      { id: "io.2.on", label: "I/O 2 On", kind: "action", transport: "lan", payload: "2*1]" },
      { id: "io.2.off", label: "I/O 2 Off", kind: "action", transport: "lan", payload: "2*0]" },
      { id: "io.3.on", label: "I/O 3 On", kind: "action", transport: "lan", payload: "3*1]" },
      { id: "io.3.off", label: "I/O 3 Off", kind: "action", transport: "lan", payload: "3*0]" },
      { id: "io.4.on", label: "I/O 4 On", kind: "action", transport: "lan", payload: "4*1]" },
      { id: "io.4.off", label: "I/O 4 Off", kind: "action", transport: "lan", payload: "4*0]" },
      { id: "ir.1", label: "IR 1 play", kind: "action", transport: "lan", payload: "W1*1*1*0IR" },
      { id: "ir.2", label: "IR 2 play", kind: "action", transport: "lan", payload: "W2*1*1*0IR" },
      { id: "ir.3", label: "IR 3 play", kind: "action", transport: "lan", payload: "W3*1*1*0IR" },
      { id: "ir.4", label: "IR 4 play", kind: "action", transport: "lan", payload: "W4*1*1*0IR" },
      { id: "com.1.send", label: "COM1 send", kind: "enum", transport: "lan", payload: "W 1 {value}", values: [] },
      { id: "com.2.send", label: "COM2 send", kind: "enum", transport: "lan", payload: "W 2 {value}", values: [] },
      { id: "system.info", label: "Firmware", kind: "action", transport: "lan", payload: "Q" },
    ],
    feedback: [
      { id: "io.1", label: "I/O 1", kind: "enum", values: ["0", "1"], transport: "lan", mode: "poll", query: "1]", pollMs: 2000, parse: { type: "regex", pattern: "([01])" } },
      { id: "io.2", label: "I/O 2", kind: "enum", values: ["0", "1"], transport: "lan", mode: "poll", query: "2]", pollMs: 2000, parse: { type: "regex", pattern: "([01])" } },
      { id: "io.3", label: "I/O 3", kind: "enum", values: ["0", "1"], transport: "lan", mode: "poll", query: "3]", pollMs: 2000, parse: { type: "regex", pattern: "([01])" } },
      { id: "io.4", label: "I/O 4", kind: "enum", values: ["0", "1"], transport: "lan", mode: "poll", query: "4]", pollMs: 2000, parse: { type: "regex", pattern: "([01])" } },
      { id: "system.version", label: "Version", kind: "string", transport: "lan", mode: "poll", query: "Q", pollMs: 30000, parse: { type: "exact" } },
    ],
  },
  "extron-mps-602.json": {
    specVersion: "2",
    device: {
      manufacturer: "Extron",
      model: "MPS 602",
      type: "switcher",
      notes: "No Ethernet on the switcher. SIS is RS-232 9600 8N1 on the rear captive-screw port (or USB Config). Behind an IPL, bind this device to the IPL COM slot (TCP 2001/2002). Commands do not need a carriage return. Inputs: 1–2 VGA, 3–5 HDMI, 6 DTP. Volume 0–100. 1Z mutes program audio (not mic).",
    },
    transports: {
      lan: { protocol: "tcp", port: 2001, timeoutMs: 2500, session: { keepMs: 15000 } },
      rs232: { baud: 9600, dataBits: 8, parity: "none", stopBits: 1, encoding: "ascii", timeoutMs: 1500 },
    },
    auth: { type: "none" },
    pacing: { minIntervalMs: 80 },
    probe: { transport: "lan", payload: "!", success: { type: "contains", value: "]" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "input.1", label: "VGA 1", kind: "action", transport: "lan", payload: "1!" },
      { id: "input.2", label: "VGA 2", kind: "action", transport: "lan", payload: "2!" },
      { id: "input.3", label: "HDMI 3", kind: "action", transport: "lan", payload: "3!" },
      { id: "input.4", label: "HDMI 4", kind: "action", transport: "lan", payload: "4!" },
      { id: "input.5", label: "HDMI 5", kind: "action", transport: "lan", payload: "5!" },
      { id: "input.6", label: "DTP 6", kind: "action", transport: "lan", payload: "6!" },
      { id: "input.off", label: "Deselect", kind: "action", transport: "lan", payload: "0!" },
      { id: "volume.set", label: "Program volume", kind: "range", min: 0, max: 100, step: 1, transport: "lan", payload: "{value}V" },
      { id: "volume.up", label: "Volume up", kind: "action", transport: "lan", payload: "+V" },
      { id: "volume.down", label: "Volume down", kind: "action", transport: "lan", payload: "-V" },
      { id: "mute.on", label: "Mute program", kind: "action", transport: "lan", payload: "1Z" },
      { id: "mute.off", label: "Unmute program", kind: "action", transport: "lan", payload: "0Z" },
      { id: "video.mute.on", label: "Video mute", kind: "action", transport: "lan", payload: "1B" },
      { id: "video.mute.off", label: "Video unmute", kind: "action", transport: "lan", payload: "0B" },
      { id: "auto.off", label: "Auto-switch off", kind: "action", transport: "lan", payload: "E 0AUSW}" },
      { id: "auto.high", label: "Auto-switch highest", kind: "action", transport: "lan", payload: "E 1AUSW}" },
      { id: "auto.low", label: "Auto-switch lowest", kind: "action", transport: "lan", payload: "E 2AUSW}" },
      { id: "system.info", label: "Info", kind: "action", transport: "lan", payload: "I" },
    ],
    feedback: [
      { id: "input.current", label: "Input", kind: "string", transport: "lan", mode: "poll", query: "!", pollMs: 3000, parse: { type: "regex", pattern: "In(\\d+)" } },
      { id: "input.source", label: "Input source", kind: "string", transport: "lan", mode: "poll", query: "!", pollMs: 3000, parse: { type: "regex", pattern: "In(\\d+)", map: { "0": "off", "1": "VGA 1", "2": "VGA 2", "3": "HDMI 3", "4": "HDMI 4", "5": "HDMI 5", "6": "DTP 6" } } },
      { id: "volume.level", label: "Volume", kind: "range", min: 0, max: 100, transport: "lan", mode: "poll", query: "V", pollMs: 4000, parse: { type: "regex", pattern: "(\\d+)" } },
      { id: "mute.state", label: "Mute", kind: "enum", values: ["0", "1"], transport: "lan", mode: "poll", query: "Z", pollMs: 4000, parse: { type: "regex", pattern: "([01])" } },
    ],
  },
  "wake-on-lan.json": {
    specVersion: "2",
    device: { manufacturer: "Generic", model: "PC (WOL + LAN shutdown)", type: "other", notes: "Wake: MAC. Shutdown: user/password for Windows RPC (samba-common-bin on Linux) or HTTP GET auth.path on Port." },
    transports: { lan: { protocol: "http", port: 9, timeoutMs: 4000 } },
    auth: { type: "none", instanceFields: ["mac", "user", "password", "path"] },
    pacing: { minIntervalMs: 200, powerOnDelayMs: 0 },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.on", label: "Wake", kind: "action", transport: "lan", wake: { protocol: "wol" }, payload: "" },
      { id: "power.off", label: "Shutdown", kind: "action", transport: "lan", httpMethod: "RPC", payload: "" },
      { id: "power.http", label: "HTTP shutdown", kind: "action", transport: "lan", httpMethod: "GET", httpPath: "{auth.path}", payload: "" },
    ],
    feedback: [],
  },
  "pi-gpio.json": {
    specVersion: "1.0",
    device: { manufacturer: "Raspberry Pi", model: "GPIO line", type: "other", notes: "Line number in Port. Chip gpiochip0." },
    transports: { local: { kind: "gpio", chip: "gpiochip0", timeoutMs: 1500 } },
    auth: { type: "none", instanceFields: ["pin"] },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.on", label: "High", kind: "action", transport: "rs232", payload: "1" },
      { id: "power.off", label: "Low", kind: "action", transport: "rs232", payload: "0" },
    ],
    feedback: [],
  },
  "local-serial.json": {
    specVersion: "1.0",
    device: { manufacturer: "Generic", model: "Serial / COM", type: "other", notes: "Set Interface to COM1 / /dev/ttyUSB0." },
    transports: {
      local: { kind: "serial", path: "COM3", baud: 9600, timeoutMs: 1500 },
      rs232: { baud: 9600, dataBits: 8, parity: "none", stopBits: 1, lineEnding: "\r", timeoutMs: 1500 },
    },
    auth: { type: "none" },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.on", label: "On", kind: "action", transport: "rs232", payload: "POWR1" },
      { id: "power.off", label: "Off", kind: "action", transport: "rs232", payload: "POWR0" },
    ],
    feedback: [],
  },
  "pi-i2c.json": {
    specVersion: "1.0",
    device: { manufacturer: "Raspberry Pi", model: "I2C device", type: "other", notes: "Needs i2cset. Address in auth.address." },
    transports: { local: { kind: "i2c", bus: 1, address: "0x3c", timeoutMs: 1500 } },
    auth: { type: "none", instanceFields: ["address"] },
    helpers: { checksum: "none" },
    commands: [{ id: "power.on", label: "Write 0x01", kind: "action", transport: "rs232", payload: "0x00 0x01" }],
    feedback: [],
  },
  "denon-dn-500av.json": {
    specVersion: "2",
    device: {
      manufacturer: "Denon",
      model: "DN-500AV",
      type: "amplifier",
      notes: "Telnet 23 or RS-232 9600 8N1. Same AVR ASCII as consumer Denon. Source names follow the unit labels (HDMI is assigned to BD/SAT/CBL/etc in the 500AV menu). Volume 00–98.",
    },
    transports: {
      lan: { protocol: "tcp", port: 23, encoding: "ascii", lineEnding: "\r", timeoutMs: 2000 },
      rs232: { baud: 9600, dataBits: 8, parity: "none", stopBits: 1, encoding: "ascii", lineEnding: "\r", timeoutMs: 2000 },
    },
    auth: { type: "none", instanceFields: [] },
    pacing: { minIntervalMs: 200, powerOnDelayMs: 2000 },
    probe: { transport: "lan", payload: "", success: { type: "contains", value: "" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "PWON" },
      { id: "power.off", label: "Standby", kind: "action", transport: "lan", payload: "PWSTANDBY" },
      { id: "volume.up", label: "Volume Up", kind: "action", transport: "lan", payload: "MVUP" },
      { id: "volume.down", label: "Volume Down", kind: "action", transport: "lan", payload: "MVDOWN" },
      { id: "volume.set", label: "Volume", kind: "range", min: 0, max: 98, step: 1, transport: "lan", payload: "MV{value}" },
      { id: "mute.on", label: "Mute", kind: "action", transport: "lan", payload: "MUON" },
      { id: "mute.off", label: "Unmute", kind: "action", transport: "lan", payload: "MUOFF" },
      { id: "input.bd", label: "Blu-ray", kind: "action", transport: "lan", payload: "SIBD" },
      { id: "input.dvd", label: "DVD", kind: "action", transport: "lan", payload: "SIDVD" },
      { id: "input.sat", label: "SAT / CBL", kind: "action", transport: "lan", payload: "SISAT/CBL" },
      { id: "input.game", label: "Game", kind: "action", transport: "lan", payload: "SIGAME" },
      { id: "input.aux1", label: "AUX 1", kind: "action", transport: "lan", payload: "SIAUX1" },
      { id: "input.aux2", label: "AUX 2", kind: "action", transport: "lan", payload: "SIAUX2" },
      { id: "input.cd", label: "CD", kind: "action", transport: "lan", payload: "SICD" },
      { id: "input.tuner", label: "Tuner", kind: "action", transport: "lan", payload: "SITUNER" },
      { id: "input.net", label: "Network", kind: "action", transport: "lan", payload: "SINET" },
      { id: "input.usb", label: "USB", kind: "action", transport: "lan", payload: "SIUSB" },
      { id: "surround.stereo", label: "Stereo", kind: "action", transport: "lan", payload: "MSSTEREO" },
      { id: "surround.movie", label: "Movie", kind: "action", transport: "lan", payload: "MSMOVIE" },
    ],
    feedback: [
      { id: "power.state", label: "Power", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "PW?", pollMs: 4000, parse: { type: "contains", value: "PWON", map: { PWON: "on", PWSTANDBY: "off" } } },
      { id: "volume.level", label: "Volume", kind: "range", min: 0, max: 98, transport: "lan", mode: "poll", query: "MV?", pollMs: 4000, parse: { type: "regex", pattern: "MV([0-9]{2})" } },
      { id: "mute.state", label: "Mute", kind: "enum", values: ["off", "on"], transport: "lan", mode: "poll", query: "MU?", pollMs: 5000, parse: { type: "contains", value: "MUON", map: { MUON: "on", MUOFF: "off" } } },
      { id: "input.current", label: "Input", kind: "string", transport: "lan", mode: "poll", query: "SI?", pollMs: 5000, parse: { type: "regex", pattern: "SI([^\\r]+)" } },
    ],
  },
  "extron-xpa-1002.json": {
    specVersion: "2",
    device: {
      manufacturer: "Extron",
      model: "XPA 1002",
      type: "amplifier",
      notes: "No LAN. Bind Interface to IPL Flex I/O (TCP 23). Standby is digital out. Volume needs gateway analogOut (SFI244 has none).",
    },
    transports: { lan: { protocol: "tcp", port: 23, timeoutMs: 2500, lineEnding: "\r", session: { keepMs: 15000 } } },
    auth: { type: "none", instanceFields: ["standbyLine", "volumeLine"] },
    pacing: { minIntervalMs: 80 },
    probe: { transport: "lan", payload: "Q", success: { type: "contains", value: "" } },
    helpers: { checksum: "none" },
    commands: [
      { id: "power.standby", label: "Standby", kind: "action", transport: "lan", payload: "", gatewayOp: "digitalOn", gatewayLine: "standbyLine" },
      { id: "power.on", label: "Power On", kind: "action", transport: "lan", payload: "", gatewayOp: "digitalOff", gatewayLine: "standbyLine" },
      { id: "volume.set", label: "Volume", kind: "range", min: 0, max: 100, step: 1, transport: "lan", payload: "", gatewayOp: "analogOut", gatewayLine: "volumeLine", valueMap: { kind: "float", inMin: 0, inMax: 100, outMin: 0, outMax: 10, decimals: 2 } },
    ],
    feedback: [],
  },
  "samsung-qe77s95d.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Samsung",
    "model": "QE77S95DATXXN",
    "type": "display",
    "notes": "2024 S95D: Authenticate on wss 8002 only (8001 will not show Allow). Enable Power On with Mobile / IP Remote. Use the wired MAC if on Ethernet. WOL waits 10s. Sync inventory for apps."
  },
  "transports": {
    "lan": {
      "protocol": "tls-websocket",
      "port": 8002,
      "timeoutMs": 8000,
      "path": "/api/v2/channels/samsung.remote.control",
      "query": {
        "name": "{base64:Relay}",
        "token": "{token}"
      },
      "handshake": {
        "waitContains": "ms.channel.connect",
        "delayMs": 500
      },
      "alsoSend": [
        { "replace": { "ed.installedApp.get": "ed.edenApp.get" } }
      ],
      "http": {
        "path": "/api/v2/channels/samsung.remote.control"
      }
    }
  },
  "auth": {
    "type": "token",
    "instanceFields": [
      "token",
      "name",
      "mac"
    ],
    "pairing": {
      "kind": "websocket-handshake",
      "ports": [
        8002
      ],
      "tlsPorts": [
        8002
      ],
      "path": "/api/v2/channels/samsung.remote.control",
      "discoverPath": "/api/v2/",
      "query": {
        "nameParam": "name",
        "tokenParam": "token",
        "nameFrom": "auth.name"
      },
      "waitContains": "ms.channel.connect",
      "commandAck": "none",
      "tokenJsonPath": "token",
      "userPrompt": "Accept Allow on the TV (8002 only). Save the token. Keep port 8002.",
      "steps": [
        {
          "action": "websocket",
          "port": 8002,
          "tls": true,
          "path": "/api/v2/channels/samsung.remote.control",
          "waitContains": "ms.channel.connect",
          "tokenJsonPath": "token",
          "timeoutMs": 12000
        }
      ]
    }
  },
  "status": {
    "protocol": "http",
    "port": 8001,
    "path": "/api/v2/"
  },
  "pacing": {
    "minIntervalMs": 250,
    "powerOnDelayMs": 10000
  },
  "probe": {
    "transport": "lan",
    "payload": "",
    "success": {
      "type": "contains",
      "value": "ms.channel"
    }
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "power.on",
      "label": "Power On",
      "kind": "action",
      "transport": "lan",
      "wake": {
        "protocol": "wol"
      },
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWERON\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "power.off",
      "label": "Power Off",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.up",
      "label": "Volume up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLUP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.down",
      "label": "Volume down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLDOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "mute.toggle",
      "label": "Mute toggle",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.source",
      "label": "Source list",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_SOURCE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi",
      "label": "HDMI",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.up",
      "label": "Up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_UP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.down",
      "label": "Down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_DOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.left",
      "label": "Left",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_LEFT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.right",
      "label": "Right",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RIGHT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.enter",
      "label": "Enter",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_ENTER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.back",
      "label": "Back",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RETURN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.home",
      "label": "Home",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HOME\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.play",
      "label": "Play",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PLAY\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.pause",
      "label": "Pause",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PAUSE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "app.launch",
      "label": "App launch",
      "kind": "enum",
      "transport": "lan",
      "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.apps.launch\",\"to\":\"host\",\"data\":{\"appId\":\"{value}\",\"action_type\":\"DEEP_LINK\"}}}"
    },
    {
      "id": "app.native",
      "label": "App native",
      "kind": "enum",
      "transport": "lan",
      "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.apps.launch\",\"to\":\"host\",\"data\":{\"appId\":\"{value}\",\"action_type\":\"NATIVE_LAUNCH\"}}}"
    }
  ],
  "feedback": [
    {
      "id": "power.state",
      "label": "Power",
      "kind": "enum",
      "values": [
        "off",
        "on"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 5000,
      "parse": {
        "type": "jsonpath",
        "path": "device.PowerState"
      }
    },
    {
      "id": "device.name",
      "label": "Device name",
      "kind": "string",
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 30000,
      "parse": {
        "type": "jsonpath",
        "path": "device.name"
      }
    }
  ],
  "inventory": {
    "resources": [
      {
        "id": "apps",
        "label": "Apps",
        "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.installedApp.get\",\"to\":\"host\",\"data\":\"\"}}",
        "alsoSend": [
          "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.edenApp.get\",\"to\":\"host\",\"data\":\"\"}}"
        ],
        "waitContains": "ed.installedApp.get|ed.edenApp.get",
        "parsePath": "data.data",
        "idField": "appId",
        "nameField": "name",
        "useCommand": "app.launch"
      }
    ]
  }
} as unknown as DriverSpec,
  "home-assistant.json": {
  "specVersion": "2",
  "device": {
    "manufacturer": "Home Assistant",
    "model": "Core",
    "type": "other",
    "notes": "Local REST on TCP 8123. Create a long-lived access token (HA Profile \u2192 Security) and paste it in the token field. Set entity to one entity_id (sensor.office_pir) to poll that state into a monitor. Inventory lists all entities. homeassistant.turn_on/off works for lights, switches, scenes, covers."
  },
  "transports": {
    "lan": {
      "protocol": "http",
      "port": 8123,
      "timeoutMs": 4000,
      "http": {
        "method": "GET",
        "path": "/api/",
        "contentType": "application/json",
        "headers": {
          "Authorization": "Bearer {token}"
        }
      }
    }
  },
  "auth": {
    "type": "token",
    "instanceFields": [
      "token",
      "entity"
    ],
    "pairing": {
      "kind": "none",
      "ports": [
        8123
      ],
      "discoverPath": "/api/",
      "userPrompt": "HA Profile \u2192 Security \u2192 Long-lived access tokens. Paste the token, save, then Probe."
    }
  },
  "pacing": {
    "minIntervalMs": 150
  },
  "probe": {
    "transport": "lan",
    "payload": ""
  },
  "helpers": {
    "checksum": "none"
  },
  "inventory": {
    "resources": [
      {
        "id": "entities",
        "label": "Entities",
        "httpMethod": "GET",
        "httpPath": "/api/states",
        "idField": "entity_id",
        "nameField": "attributes.friendly_name",
        "valueField": "state",
        "useCommand": "item.on"
      }
    ]
  },
  "commands": [
    {
      "id": "entity.on",
      "label": "Turn on",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/api/services/homeassistant/turn_on",
      "payload": "{\"entity_id\":\"{auth.entity}\"}"
    },
    {
      "id": "entity.off",
      "label": "Turn off",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/api/services/homeassistant/turn_off",
      "payload": "{\"entity_id\":\"{auth.entity}\"}"
    },
    {
      "id": "entity.toggle",
      "label": "Toggle",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/api/services/homeassistant/toggle",
      "payload": "{\"entity_id\":\"{auth.entity}\"}"
    },
    {
      "id": "item.on",
      "label": "Item on",
      "kind": "enum",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/api/services/homeassistant/turn_on",
      "payload": "{\"entity_id\":\"{value}\"}"
    },
    {
      "id": "item.off",
      "label": "Item off",
      "kind": "enum",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/api/services/homeassistant/turn_off",
      "payload": "{\"entity_id\":\"{value}\"}"
    }
  ],
  "feedback": [
    {
      "id": "entity.state",
      "label": "State",
      "kind": "string",
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "GET",
      "httpPath": "/api/states/{auth.entity}",
      "query": "",
      "pollMs": 2000,
      "parse": {
        "type": "jsonpath",
        "path": "state"
      }
    },
    {
      "id": "entity.name",
      "label": "Name",
      "kind": "string",
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "GET",
      "httpPath": "/api/states/{auth.entity}",
      "query": "",
      "pollMs": 10000,
      "parse": {
        "type": "jsonpath",
        "path": "attributes.friendly_name"
      }
    },
    {
      "id": "entity.brightness",
      "label": "Brightness",
      "kind": "range",
      "min": 0,
      "max": 255,
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "GET",
      "httpPath": "/api/states/{auth.entity}",
      "query": "",
      "pollMs": 3000,
      "parse": {
        "type": "jsonpath",
        "path": "attributes.brightness"
      }
    }
  ]
} as unknown as DriverSpec,
  "sonos-s1-s2.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Sonos",
    "model": "S1 / S2 player",
    "type": "amplifier",
    "manualUrl": "https://support.sonos.com/",
    "notes": "Put the player's LAN IPv4 in the device card (not a hostname). Port 1400. For a grouped room, use the group coordinator's IP; Play/Pause/Next sent to a member are ignored or 500. Play needs something in the queue (error 701 if idle). SOAP on this LAN, no login."
  },
  "transports": {
    "lan": {
      "protocol": "http",
      "port": 1400,
      "timeoutMs": 4000,
      "http": {
        "method": "POST",
        "path": "/MediaRenderer/AVTransport/Control",
        "contentType": "text/xml; charset=utf-8",
        "headers": {
          "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo\""
        }
      }
    }
  },
  "auth": {
    "type": "none"
  },
  "pacing": {
    "minIntervalMs": 100
  },
  "probe": {
    "transport": "lan",
    "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetTransportInfo xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:GetTransportInfo></s:Body></s:Envelope>",
    "success": {
      "type": "contains",
      "value": "CurrentTransportState"
    }
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "media.play",
      "label": "Play",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Play\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play></s:Body></s:Envelope>"
    },
    {
      "id": "media.pause",
      "label": "Pause",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Pause\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Pause xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Pause></s:Body></s:Envelope>"
    },
    {
      "id": "media.stop",
      "label": "Stop",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Stop\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Stop></s:Body></s:Envelope>"
    },
    {
      "id": "media.previous",
      "label": "Previous",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Previous\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Previous xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Previous></s:Body></s:Envelope>"
    },
    {
      "id": "media.next",
      "label": "Next",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#Next\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Next xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Next></s:Body></s:Envelope>"
    },
    {
      "id": "volume.set",
      "label": "Volume",
      "kind": "range",
      "min": 0,
      "max": 100,
      "step": 1,
      "unit": "%",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetVolume xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{value}</DesiredVolume></u:SetVolume></s:Body></s:Envelope>"
    },
    {
      "id": "mute.on",
      "label": "Mute",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetMute\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>1</DesiredMute></u:SetMute></s:Body></s:Envelope>"
    },
    {
      "id": "mute.off",
      "label": "Unmute",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetMute\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>0</DesiredMute></u:SetMute></s:Body></s:Envelope>"
    }
  ],
  "feedback": [
    {
      "id": "playback.state",
      "label": "Playback state",
      "kind": "enum",
      "values": [
        "PLAYING",
        "PAUSED_PLAYBACK",
        "STOPPED",
        "TRANSITIONING",
        "NO_MEDIA_PRESENT"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetTransportInfo xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:GetTransportInfo></s:Body></s:Envelope>",
      "pollMs": 4000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentTransportState>([^<]+)"
      }
    },
    {
      "id": "volume.level",
      "label": "Volume",
      "kind": "range",
      "min": 0,
      "max": 100,
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetVolume xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume></s:Body></s:Envelope>",
      "pollMs": 4000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentVolume>([^<]+)"
      }
    },
    {
      "id": "mute.state",
      "label": "Mute",
      "kind": "enum",
      "values": [
        "0",
        "1"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPAction": "\"urn:schemas-upnp-org:service:RenderingControl:1#GetMute\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute></s:Body></s:Envelope>",
      "pollMs": 4000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentMute>([^<]+)"
      }
    }
  ]
} as unknown as DriverSpec,
  "sonos-zoneplayer.json": {
  "specVersion": "2",
  "device": {
    "manufacturer": "Sonos",
    "model": "ZonePlayer",
    "type": "amplifier",
    "notes": "Local UPnP on TCP 1400. No cloud, no pairing. Point the device IP at the group coordinator (the speaker that shows the group name). Volume 0\u2013100."
  },
  "transports": {
    "lan": {
      "protocol": "http",
      "port": 1400,
      "timeoutMs": 4000,
      "http": {
        "method": "POST",
        "path": "/MediaRenderer/AVTransport/Control",
        "contentType": "text/xml; charset=\"utf-8\""
      }
    }
  },
  "auth": {
    "type": "none"
  },
  "pacing": {
    "minIntervalMs": 120
  },
  "probe": {
    "transport": "lan",
    "payload": ""
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "transport.play",
      "label": "Play",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#Play\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID><Speed>1</Speed></u:Play></s:Body></s:Envelope>"
    },
    {
      "id": "transport.pause",
      "label": "Pause",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#Pause\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Pause xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Pause></s:Body></s:Envelope>"
    },
    {
      "id": "transport.stop",
      "label": "Stop",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#Stop\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Stop xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Stop></s:Body></s:Envelope>"
    },
    {
      "id": "transport.next",
      "label": "Next",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#Next\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Next xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Next></s:Body></s:Envelope>"
    },
    {
      "id": "transport.prev",
      "label": "Previous",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#Previous\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:Previous xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:Previous></s:Body></s:Envelope>"
    },
    {
      "id": "volume.set",
      "label": "Volume",
      "kind": "range",
      "min": 0,
      "max": 100,
      "step": 1,
      "unit": "%",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume\""
      },
      "valueMap": {
        "kind": "int",
        "inMin": 0,
        "inMax": 100,
        "outMin": 0,
        "outMax": 100
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetVolume xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>{value}</DesiredVolume></u:SetVolume></s:Body></s:Envelope>"
    },
    {
      "id": "mute.on",
      "label": "Mute",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetMute\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>1</DesiredMute></u:SetMute></s:Body></s:Envelope>"
    },
    {
      "id": "mute.off",
      "label": "Unmute",
      "kind": "action",
      "transport": "lan",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:RenderingControl:1#SetMute\""
      },
      "payload": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:SetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>0</DesiredMute></u:SetMute></s:Body></s:Envelope>"
    }
  ],
  "feedback": [
    {
      "id": "transport.state",
      "label": "Transport",
      "kind": "enum",
      "values": [
        "playing",
        "paused",
        "stopped"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/AVTransport/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetTransportInfo xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"><InstanceID>0</InstanceID></u:GetTransportInfo></s:Body></s:Envelope>",
      "pollMs": 2000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentTransportState>([^<]+)",
        "map": {
          "PLAYING": "playing",
          "PAUSED_PLAYBACK": "paused",
          "STOPPED": "stopped",
          "TRANSITIONING": "playing"
        }
      }
    },
    {
      "id": "volume.level",
      "label": "Volume",
      "kind": "range",
      "min": 0,
      "max": 100,
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetVolume xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume></s:Body></s:Envelope>",
      "pollMs": 3000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentVolume>(\\d+)"
      }
    },
    {
      "id": "mute.state",
      "label": "Mute",
      "kind": "enum",
      "values": [
        "off",
        "on"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpMethod": "POST",
      "httpPath": "/MediaRenderer/RenderingControl/Control",
      "httpHeaders": {
        "SOAPACTION": "\"urn:schemas-upnp-org:service:RenderingControl:1#GetMute\""
      },
      "query": "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:GetMute xmlns:u=\"urn:schemas-upnp-org:service:RenderingControl:1\"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute></s:Body></s:Envelope>",
      "pollMs": 3000,
      "parse": {
        "type": "regex",
        "pattern": "<CurrentMute>(\\d+)",
        "map": {
          "0": "off",
          "1": "on"
        }
      }
    }
  ]
} as unknown as DriverSpec,
  "samsung-tizen.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Samsung",
    "model": "Tizen TV",
    "type": "display",
    "notes": "Generic Tizen IP remote. Keys and Allow are wss://TV:8002 (samsung.remote.control). HTTP :8001/api/v2/ is status only. Authenticate on 8002, Accept Allow, save the token, keep port 8002. This driver then tries 8001 for older sets that still pair there; 2024+ (S95D class) often ignore 8001. Enable Power On with Mobile / IP Remote. Cold power-on needs WOL + MAC (wired MAC if on Ethernet). Sync inventory for apps; bind App launch, or App native if that fails. KEY_NETFLIX is the hardware key only."
  },
  "transports": {
    "lan": {
      "protocol": "tls-websocket",
      "port": 8002,
      "timeoutMs": 8000,
      "path": "/api/v2/channels/samsung.remote.control",
      "query": {
        "name": "{base64:Relay}",
        "token": "{token}"
      },
      "handshake": {
        "waitContains": "ms.channel.connect",
        "delayMs": 500
      },
      "alsoSend": [
        {
          "replace": {
            "ed.installedApp.get": "ed.edenApp.get"
          }
        }
      ],
      "http": {
        "path": "/api/v2/channels/samsung.remote.control"
      }
    }
  },
  "auth": {
    "type": "token",
    "instanceFields": [
      "token",
      "name",
      "mac"
    ],
    "pairing": {
      "kind": "websocket-handshake",
      "ports": [
        8002,
        8001
      ],
      "tlsPorts": [
        8002
      ],
      "path": "/api/v2/channels/samsung.remote.control",
      "discoverPath": "/api/v2/",
      "query": {
        "nameParam": "name",
        "tokenParam": "token",
        "nameFrom": "auth.name"
      },
      "waitContains": "ms.channel.connect",
      "commandAck": "none",
      "tokenJsonPath": "token",
      "userPrompt": "Accept Allow on the TV (8002). Save the token and keep port 8002. If no popup, enable IP Remote and try again. Older Tizen may pair on 8001 next.",
      "steps": [
        {
          "action": "websocket",
          "port": 8002,
          "tls": true,
          "path": "/api/v2/channels/samsung.remote.control",
          "waitContains": "ms.channel.connect",
          "tokenJsonPath": "token",
          "timeoutMs": 12000
        },
        {
          "action": "websocket",
          "port": 8001,
          "path": "/api/v2/channels/samsung.remote.control",
          "waitContains": "ms.channel.connect",
          "tokenJsonPath": "token",
          "nextPort": 8002,
          "timeoutMs": 12000
        }
      ]
    }
  },
  "status": {
    "protocol": "http",
    "port": 8001,
    "path": "/api/v2/"
  },
  "pacing": {
    "minIntervalMs": 250,
    "powerOnDelayMs": 8000
  },
  "probe": {
    "transport": "lan",
    "payload": "",
    "success": {
      "type": "contains",
      "value": "ms.channel"
    }
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "power.on",
      "label": "Power On",
      "kind": "action",
      "transport": "lan",
      "wake": {
        "protocol": "wol"
      },
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWERON\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "power.off",
      "label": "Power Off",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "power.toggle",
      "label": "Power toggle",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.up",
      "label": "Volume up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLUP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.down",
      "label": "Volume down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLDOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "mute.on",
      "label": "Mute",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "mute.off",
      "label": "Unmute",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "ch.up",
      "label": "Channel up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_CHUP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "ch.down",
      "label": "Channel down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_CHDOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi",
      "label": "HDMI",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi1",
      "label": "HDMI 1",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI1\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi2",
      "label": "HDMI 2",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI2\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi3",
      "label": "HDMI 3",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI3\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.source",
      "label": "Source list",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_SOURCE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.tv",
      "label": "Live TV",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_TV\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.up",
      "label": "Up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_UP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.down",
      "label": "Down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_DOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.left",
      "label": "Left",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_LEFT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.right",
      "label": "Right",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RIGHT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.enter",
      "label": "Enter",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_ENTER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.return",
      "label": "Back",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RETURN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.exit",
      "label": "Exit",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_EXIT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.home",
      "label": "Home / Smart Hub",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HOME\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.menu",
      "label": "Menu",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MENU\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.tools",
      "label": "Tools",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_TOOLS\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.info",
      "label": "Info",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_INFO\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.guide",
      "label": "Guide",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_GUIDE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.play",
      "label": "Play",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PLAY\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.pause",
      "label": "Pause",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PAUSE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.stop",
      "label": "Stop",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_STOP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.ff",
      "label": "Fast forward",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_FF\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.rew",
      "label": "Rewind",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_REWIND\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "color.red",
      "label": "Red",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RED\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "color.green",
      "label": "Green",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_GREEN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "color.yellow",
      "label": "Yellow",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_YELLOW\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "color.blue",
      "label": "Blue",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_BLUE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.0",
      "label": "0",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_0\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.1",
      "label": "1",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_1\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.2",
      "label": "2",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_2\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.3",
      "label": "3",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_3\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.4",
      "label": "4",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_4\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.5",
      "label": "5",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_5\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.6",
      "label": "6",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_6\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.7",
      "label": "7",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_7\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.8",
      "label": "8",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_8\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "digit.9",
      "label": "9",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_9\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "app.list",
      "label": "Apps",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_CONTENTS\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "app.netflix",
      "label": "Netflix key",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_NETFLIX\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "app.launch",
      "label": "App launch",
      "kind": "enum",
      "transport": "lan",
      "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.apps.launch\",\"to\":\"host\",\"data\":{\"appId\":\"{value}\",\"action_type\":\"DEEP_LINK\"}}}"
    },
    {
      "id": "app.native",
      "label": "App native",
      "kind": "enum",
      "transport": "lan",
      "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.apps.launch\",\"to\":\"host\",\"data\":{\"appId\":\"{value}\",\"action_type\":\"NATIVE_LAUNCH\"}}}"
    }
  ],
  "feedback": [
    {
      "id": "power.state",
      "label": "Power",
      "kind": "enum",
      "values": [
        "off",
        "on"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 8000,
      "parse": {
        "type": "jsonpath",
        "path": "device.PowerState",
        "map": {
          "on": "on",
          "ON": "on",
          "standby": "off",
          "Standby": "off",
          "off": "off"
        }
      }
    },
    {
      "id": "device.name",
      "label": "Device name",
      "kind": "string",
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 30000,
      "parse": {
        "type": "jsonpath",
        "path": "device.name"
      }
    }
  ],
  "inventory": {
    "resources": [
      {
        "id": "apps",
        "label": "Apps",
        "payload": "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.installedApp.get\",\"to\":\"host\",\"data\":\"\"}}",
        "alsoSend": [
          "{\"method\":\"ms.channel.emit\",\"params\":{\"event\":\"ed.edenApp.get\",\"to\":\"host\",\"data\":\"\"}}"
        ],
        "waitContains": "ed.installedApp.get|ed.edenApp.get",
        "parsePath": "data.data",
        "idField": "appId",
        "nameField": "name",
        "useCommand": "app.launch"
      }
    ]
  }
} as unknown as DriverSpec,
  "Driver-voor-christiaans-kut-TV.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Samsung",
    "model": "Driver voor christiaans kut TV",
    "type": "display",
    "notes": "Christian's QE77S95D, honest controls. Authenticate on wss 8002 only. KEY_POWER is a toggle (no separate on/off, no WOL). App inventory / launch omitted \u2014 not working on this set. Enable IP Remote on the TV."
  },
  "transports": {
    "lan": {
      "protocol": "tls-websocket",
      "port": 8002,
      "timeoutMs": 8000,
      "path": "/api/v2/channels/samsung.remote.control",
      "query": {
        "name": "{base64:Relay}",
        "token": "{token}"
      },
      "handshake": {
        "waitContains": "ms.channel.connect",
        "delayMs": 500
      },
      "alsoSend": [
        {
          "replace": {
            "ed.installedApp.get": "ed.edenApp.get"
          }
        }
      ],
      "http": {
        "path": "/api/v2/channels/samsung.remote.control"
      }
    }
  },
  "auth": {
    "type": "token",
    "instanceFields": [
      "token",
      "name",
      "mac"
    ],
    "pairing": {
      "kind": "websocket-handshake",
      "ports": [
        8002
      ],
      "tlsPorts": [
        8002
      ],
      "path": "/api/v2/channels/samsung.remote.control",
      "discoverPath": "/api/v2/",
      "query": {
        "nameParam": "name",
        "tokenParam": "token",
        "nameFrom": "auth.name"
      },
      "waitContains": "ms.channel.connect",
      "commandAck": "none",
      "tokenJsonPath": "token",
      "userPrompt": "Accept Allow on the TV (8002 only). Save the token. Keep port 8002.",
      "steps": [
        {
          "action": "websocket",
          "port": 8002,
          "tls": true,
          "path": "/api/v2/channels/samsung.remote.control",
          "waitContains": "ms.channel.connect",
          "tokenJsonPath": "token",
          "timeoutMs": 12000
        }
      ]
    }
  },
  "status": {
    "protocol": "http",
    "port": 8001,
    "path": "/api/v2/"
  },
  "pacing": {
    "minIntervalMs": 250,
    "powerOnDelayMs": 10000
  },
  "probe": {
    "transport": "lan",
    "payload": "",
    "success": {
      "type": "contains",
      "value": "ms.channel"
    }
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "power.toggle",
      "label": "Power toggle",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_POWER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.up",
      "label": "Volume up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLUP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "volume.down",
      "label": "Volume down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_VOLDOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "mute.toggle",
      "label": "Mute toggle",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_MUTE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.source",
      "label": "Source list",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_SOURCE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "input.hdmi",
      "label": "HDMI",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HDMI\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.up",
      "label": "Up",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_UP\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.down",
      "label": "Down",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_DOWN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.left",
      "label": "Left",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_LEFT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.right",
      "label": "Right",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RIGHT\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.enter",
      "label": "Enter",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_ENTER\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.back",
      "label": "Back",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_RETURN\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "nav.home",
      "label": "Home",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_HOME\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.play",
      "label": "Play",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PLAY\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    },
    {
      "id": "media.pause",
      "label": "Pause",
      "kind": "action",
      "transport": "lan",
      "payload": "{\"method\":\"ms.remote.control\",\"params\":{\"Cmd\":\"Click\",\"DataOfCmd\":\"KEY_PAUSE\",\"Option\":\"false\",\"TypeOfRemote\":\"SendRemoteKey\"}}"
    }
  ],
  "feedback": [
    {
      "id": "power.state",
      "label": "Power",
      "kind": "enum",
      "values": [
        "off",
        "on"
      ],
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 5000,
      "parse": {
        "type": "jsonpath",
        "path": "device.PowerState"
      }
    },
    {
      "id": "device.name",
      "label": "Device name",
      "kind": "string",
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/v2/",
      "pollMs": 30000,
      "parse": {
        "type": "jsonpath",
        "path": "device.name"
      }
    }
  ]
} as unknown as DriverSpec,
  "osc-udp.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Generic",
    "model": "OSC UDP",
    "type": "mixer",
    "notes": "OSC over UDP. Host is the receiver. Port default 9000. Command payload is the OSC path. Optional osc.types (s/i/f/b) and osc.values with {value}/{auth.*}."
  },
  "transports": {
    "lan": {
      "protocol": "osc",
      "port": 9000,
      "timeoutMs": 2000
    }
  },
  "auth": {
    "type": "none"
  },
  "pacing": {
    "minIntervalMs": 40
  },
  "probe": {
    "transport": "lan",
    "payload": "/ping"
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "ping",
      "label": "Ping",
      "kind": "action",
      "transport": "lan",
      "payload": "/ping"
    },
    {
      "id": "level.set",
      "label": "Fader",
      "kind": "range",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "transport": "lan",
      "payload": "/ch/1/mix/fader",
      "osc": {
        "types": "f",
        "values": [
          "{value}"
        ]
      }
    },
    {
      "id": "mute.on",
      "label": "Mute on",
      "kind": "action",
      "transport": "lan",
      "payload": "/ch/1/mix/on",
      "osc": {
        "types": "i",
        "values": [
          "1"
        ]
      }
    },
    {
      "id": "mute.off",
      "label": "Mute off",
      "kind": "action",
      "transport": "lan",
      "payload": "/ch/1/mix/on",
      "osc": {
        "types": "i",
        "values": [
          "0"
        ]
      }
    }
  ],
  "feedback": []
} as unknown as DriverSpec,
  "sacn-universe.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Generic",
    "model": "sACN Universe",
    "type": "lights",
    "notes": "E1.31 multicast 239.255.0.{universe}:5568 TTL 1. Set universe on the card (1\u201363999). Slot 1 is the first DMX address. Do not run sACN on office Wi-Fi."
  },
  "transports": {
    "lan": {
      "protocol": "sacn",
      "port": 5568,
      "timeoutMs": 1000
    }
  },
  "auth": {
    "type": "none",
    "instanceFields": [
      "universe"
    ]
  },
  "pacing": {
    "minIntervalMs": 25
  },
  "probe": {
    "transport": "lan",
    "payload": ""
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "power.on",
      "label": "Lights On",
      "kind": "action",
      "transport": "lan",
      "payload": "255",
      "sacn": {
        "slot": 1,
        "value": "255"
      }
    },
    {
      "id": "power.off",
      "label": "Lights Off",
      "kind": "action",
      "transport": "lan",
      "payload": "0",
      "sacn": {
        "slot": 1,
        "value": "0"
      }
    },
    {
      "id": "level.set",
      "label": "Level",
      "kind": "range",
      "min": 0,
      "max": 255,
      "step": 1,
      "transport": "lan",
      "payload": "{value}",
      "sacn": {
        "slot": 1,
        "value": "{value}"
      }
    }
  ],
  "feedback": []
} as unknown as DriverSpec,
  "usb-midi.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Generic",
    "model": "USB MIDI",
    "type": "mixer",
    "notes": "ALSA amidi on Linux only. Add a MIDI interface and set Path to hw:1,0,0 (amidi -l). Status nibbles are channel 1 (90 / 80 / B0). {midiChannel} is decimal 1\u201316 for ASCII; do not stuff it into hex. No Windows / WinMM."
  },
  "transports": {
    "local": {
      "kind": "midi",
      "path": "hw:1,0,0",
      "timeoutMs": 1500
    }
  },
  "auth": {
    "type": "none",
    "instanceFields": [
      "midiChannel"
    ]
  },
  "pacing": {
    "minIntervalMs": 20
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "note.on",
      "label": "Note On C4",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "local",
      "payload": "90 3C {value:hex2}"
    },
    {
      "id": "note.off",
      "label": "Note Off C4",
      "kind": "action",
      "transport": "local",
      "payload": "80 3C 00"
    },
    {
      "id": "level.set",
      "label": "CC7 Volume",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "local",
      "payload": "B0 07 {value:hex2}"
    },
    {
      "id": "mtc.set",
      "label": "MTC locate",
      "kind": "action",
      "transport": "local",
      "payload": "{value}",
      "mtcSend": true
    }
  ],
  "midiWatch": [
    { "kind": "cc", "channel": 1, "controller": 7, "feedback": "level.value" },
    { "kind": "mtc", "feedback": "mtc.time" }
  ],
  "feedback": [
    {
      "id": "level.value",
      "label": "CC7",
      "kind": "range",
      "min": 0,
      "max": 127,
      "transport": "local",
      "mode": "push",
      "parse": { "type": "exact" }
    },
    {
      "id": "mtc.time",
      "label": "MTC",
      "kind": "string",
      "transport": "local",
      "mode": "push",
      "parse": { "type": "exact" }
    }
  ]
} as unknown as DriverSpec,
  "ipmidi.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Generic",
    "model": "ipMIDI",
    "type": "mixer",
    "notes": "Raw MIDI bytes over UDP multicast 225.0.0.37:21928 TTL 1 (ipMIDI-style). Host on the card is unused unless lan.multicast is false. Status nibbles are channel 1 (90 / 80 / B0). Not MIDI-TCP and not Apple RTP-MIDI."
  },
  "transports": {
    "lan": {
      "protocol": "ipmidi",
      "port": 21928,
      "encoding": "hex",
      "timeoutMs": 1000
    }
  },
  "auth": {
    "type": "none",
    "instanceFields": [
      "midiChannel"
    ]
  },
  "pacing": {
    "minIntervalMs": 20
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "note.on",
      "label": "Note On C4",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "lan",
      "payload": "90 3C {value:hex2}"
    },
    {
      "id": "note.off",
      "label": "Note Off C4",
      "kind": "action",
      "transport": "lan",
      "payload": "80 3C 00"
    },
    {
      "id": "level.set",
      "label": "CC7 Volume",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "lan",
      "payload": "B0 07 {value:hex2}"
    },
    {
      "id": "mtc.set",
      "label": "MTC locate",
      "kind": "action",
      "transport": "lan",
      "payload": "{value}",
      "mtcSend": true
    }
  ],
  "midiWatch": [
    { "kind": "cc", "channel": 1, "controller": 7, "feedback": "level.value" },
    { "kind": "mtc", "feedback": "mtc.time" }
  ],
  "feedback": [
    {
      "id": "level.value",
      "label": "CC7",
      "kind": "range",
      "min": 0,
      "max": 127,
      "transport": "lan",
      "mode": "push",
      "parse": { "type": "exact" }
    },
    {
      "id": "mtc.time",
      "label": "MTC",
      "kind": "string",
      "transport": "lan",
      "mode": "push",
      "parse": { "type": "exact" }
    }
  ]
} as unknown as DriverSpec,
  "rtp-midi.json": {
  "specVersion": "2.0",
  "device": {
    "manufacturer": "Generic",
    "model": "RTP-MIDI",
    "type": "mixer",
    "notes": "AppleMIDI session on the card IP, control port 5004, data port 5005. Enable Network MIDI on the desk and type the IPv4 \u2014 no Bonjour. Hex MIDI, channel-1 status nibbles. Not MIDI-TCP and not ipMIDI multicast. Session dies if the desk sleeps."
  },
  "transports": {
    "lan": {
      "protocol": "rtp-midi",
      "port": 5004,
      "encoding": "hex",
      "timeoutMs": 2000,
      "session": {
        "keepMs": 60000
      }
    }
  },
  "auth": {
    "type": "none",
    "instanceFields": [
      "midiChannel"
    ]
  },
  "pacing": {
    "minIntervalMs": 20
  },
  "helpers": {
    "checksum": "none"
  },
  "commands": [
    {
      "id": "note.on",
      "label": "Note On C4",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "lan",
      "payload": "90 3C {value:hex2}"
    },
    {
      "id": "note.off",
      "label": "Note Off C4",
      "kind": "action",
      "transport": "lan",
      "payload": "80 3C 00"
    },
    {
      "id": "level.set",
      "label": "CC7 Volume",
      "kind": "range",
      "min": 0,
      "max": 127,
      "step": 1,
      "transport": "lan",
      "payload": "B0 07 {value:hex2}"
    },
    {
      "id": "mtc.set",
      "label": "MTC locate",
      "kind": "action",
      "transport": "lan",
      "payload": "{value}",
      "mtcSend": true
    }
  ],
  "midiWatch": [
    { "kind": "cc", "channel": 1, "controller": 7, "feedback": "level.value" },
    { "kind": "mtc", "feedback": "mtc.time" }
  ],
  "feedback": [
    {
      "id": "level.value",
      "label": "CC7",
      "kind": "range",
      "min": 0,
      "max": 127,
      "transport": "lan",
      "mode": "push",
      "parse": { "type": "exact" }
    },
    {
      "id": "mtc.time",
      "label": "MTC",
      "kind": "string",
      "transport": "lan",
      "mode": "push",
      "parse": { "type": "exact" }
    }
  ]
} as unknown as DriverSpec,
};
