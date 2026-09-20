import type { DriverSpec, RoomConfig } from "./types";

export const DEFAULT_CONFIG_PIN = "1234";
export const HOST_DRIVER = "relay-host.json";
export const relayHostDriver: DriverSpec = {
  specVersion: "2.0",
  device: { manufacturer: "Relay", model: "Host", type: "host", notes: "localhost = this process. Other room: LAN IP + that room’s listen port + that room’s peer secret in Secret (not Token). Restart / update / reboot only from this configurator." },
  transports: { lan: { protocol: "http", port: 8081, timeoutMs: 4000 } },
  auth: { type: "token", instanceFields: ["secret"] },
  pacing: { minIntervalMs: 0, powerOnDelayMs: 0 },
  probe: { transport: "lan", payload: "", success: { type: "contains", value: "" } },
  helpers: { checksum: "none" },
  inventory: {
    resources: [
      { id: "vars", label: "Variables", httpMethod: "GET", httpPath: "/api/vars", itemId: "key", itemName: "name", useCommand: "var.set" },
      { id: "macros", label: "Macros", httpMethod: "GET", httpPath: "/api/room", itemId: "key", itemName: "label", useCommand: "macro.run" },
    ],
  },
  commands: [
    { id: "display.dim", label: "Dim panel", kind: "action", transport: "lan", payload: "dim" },
    { id: "display.wake", label: "Wake panel", kind: "action", transport: "lan", payload: "wake" },
    { id: "display.fullscreen", label: "Panel fullscreen", kind: "action", transport: "lan", payload: "fullscreen" },
    { id: "panel.lock", label: "Lock panel", kind: "action", transport: "lan", payload: "lock" },
    { id: "panel.unlock", label: "Unlock panel", kind: "action", transport: "lan", payload: "unlock" },
    { id: "ui.toast", label: "Show message", kind: "enum", transport: "lan", payload: "{value}", values: [] },
    { id: "ui.block", label: "Block UI", kind: "enum", transport: "lan", payload: "{value}", values: [] },
    { id: "ui.unblock", label: "Unblock UI", kind: "action", transport: "lan", payload: "unblock" },
    { id: "ui.clear", label: "Clear messages", kind: "action", transport: "lan", payload: "clear" },
    { id: "ui.page", label: "Go to page", kind: "enum", transport: "lan", payload: "{value}", values: [] },
    { id: "system.restart", label: "Restart Relay", kind: "action", transport: "lan", payload: "restart" },
    { id: "system.update", label: "Update Relay", kind: "action", transport: "lan", payload: "update" },
    { id: "system.reboot", label: "Reboot machine", kind: "action", transport: "lan", payload: "reboot" },
    { id: "var.get", label: "Read variable", kind: "enum", transport: "lan", payload: "{value}" },
    { id: "var.set", label: "Write variable", kind: "enum", transport: "lan", payload: "{value}" },
    { id: "macro.run", label: "Run macro", kind: "enum", transport: "lan", payload: "{value}" },
    { id: "occupancy.closed", label: "Occupancy closed (0)", kind: "action", transport: "lan", payload: "0" },
    { id: "occupancy.open", label: "Occupancy open (1)", kind: "action", transport: "lan", payload: "1" },
    { id: "occupancy.available", label: "Occupancy open (1)", kind: "action", transport: "lan", payload: "1" },
    { id: "occupancy.in-session", label: "Occupancy in session (2)", kind: "action", transport: "lan", payload: "2" },
    { id: "occupancy.busy", label: "Occupancy in session (2)", kind: "action", transport: "lan", payload: "2" },
    { id: "occupancy.do-not-disturb", label: "Occupancy DND (3)", kind: "action", transport: "lan", payload: "3" },
  ],
  feedback: [
    { id: "system.uptime", label: "OS uptime (s)", kind: "range", transport: "lan", mode: "poll", query: "uptime", pollMs: 5000, parse: { type: "exact" } },
    { id: "relay.uptime", label: "Relay uptime (s)", kind: "range", transport: "lan", mode: "poll", query: "relay-uptime", pollMs: 5000, parse: { type: "exact" } },
    { id: "system.temp", label: "CPU temp °C", kind: "range", transport: "lan", mode: "poll", query: "temp", pollMs: 5000, parse: { type: "exact" } },
    { id: "system.memory", label: "Free RAM MB", kind: "range", transport: "lan", mode: "poll", query: "mem", pollMs: 5000, parse: { type: "exact" } },
    { id: "system.load", label: "Load", kind: "range", transport: "lan", mode: "poll", query: "load", pollMs: 5000, parse: { type: "exact" } },
    { id: "system.version", label: "Version", kind: "string", transport: "lan", mode: "poll", query: "version", pollMs: 30000, parse: { type: "exact" } },
    { id: "system.platform", label: "Platform", kind: "string", transport: "lan", mode: "poll", query: "platform", pollMs: 30000, parse: { type: "exact" } },
    { id: "panel.locked", label: "Panel lock", kind: "toggle", transport: "lan", mode: "poll", query: "lock", pollMs: 2000, parse: { type: "exact" } },
    { id: "display.dimmed", label: "Panel dim", kind: "toggle", transport: "lan", mode: "poll", query: "dim", pollMs: 2000, parse: { type: "exact" } },
    { id: "occupancy.state", label: "Occupancy", kind: "enum", values: ["0", "1", "2", "3"], transport: "lan", mode: "poll", query: "occupancy", pollMs: 4000, parse: { type: "exact" } },
  ],
};
export function hostDriverSeed(): Record<string, DriverSpec> {
  return { [HOST_DRIVER]: relayHostDriver };
}

export function workingSetNames(devices: { driver?: string }[] | undefined, roomFiles: string[] = []): string[] {
  const names = new Set<string>([HOST_DRIVER]);
  for (const row of devices ?? []) {
    const base = String(row.driver || "").split(/[/\\]/).pop() || "";
    if (base.toLowerCase().endsWith(".json") && base !== "index.json") names.add(base);
  }
  for (const file of roomFiles) {
    const base = String(file).split(/[/\\]/).pop() || "";
    if (base.toLowerCase().endsWith(".json") && base !== "index.json") names.add(base);
  }
  return [...names];
}

export function emptyRoomConfig(pin = DEFAULT_CONFIG_PIN): RoomConfig {
  return {
    configVersion: "1.0",
    exportedAt: null,
    sourceRoomId: null,
    room: {
      id: "room",
      name: "New room",
      panelAccess: "pin",
      panelPin: pin,
      configPin: pin,
      externalControl: false,
      panelAcceptsConfigPin: false,
      theme: "dark",
      idleDimSeconds: 90,
      keepAwake: true,
      panelFullscreen: false,
      grid: { cols: 6, rows: 8 },
      avLanNicIndex: null,
      avLanNicName: null,
      outboundNicIndex: null,
      outboundNicName: null,
      occupancy: "available",
      foyerPeerUrl: "http://127.0.0.1:8080",
      network: { mode: "dhcp", address: "10.0.10.10", prefix: 24, gateway: "10.0.10.1", dns: "10.0.10.1", ntp: "", timezone: "system", hostname: "relay-room" },
    },
    devices: [
      { id: "host", name: "Relay", driver: "relay-host.json", transport: "lan", host: "localhost", auth: {}, enabledFeatures: [], simulate: false },
    ],
    pages: [{ id: "home", label: "Home", grid: { cols: 6, rows: 8 }, portraitGrid: { cols: 4, rows: 10 }, widgets: [] }],
    macros: [],
    variables: [{ id: "occupancy", label: "Occupancy", kind: "enum", default: "1", values: ["0", "1", "2", "3"] }],
    schedules: [],
    monitors: [],
    triggers: [],
    interfaces: [],
    tags: {},
  };
}

export function defaultDeviceState(): Record<string, Record<string, string | number | boolean>> {
  return {};
}
