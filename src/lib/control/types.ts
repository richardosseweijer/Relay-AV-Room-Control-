export type TransportName = "lan" | "rs232" | "local";
export type LocalKind = "gpio" | "serial" | "i2c" | "spi" | "ir" | "cec";
export type CommandKind = "action" | "toggle" | "range" | "enum";
export type ParseType = "regex" | "jsonpath" | "contains" | "exact" | "map";
export type FeedbackKind = "enum" | "range" | "toggle" | "string" | "text";
export type FeedbackMode = "poll" | "push";
export type ChecksumKind = "none" | "sum8" | "xor8" | "pjlink";
export type PairingStep = {
  action: "http-get" | "http-post" | "websocket" | "prompt";
  port?: number;
  tls?: boolean;
  path?: string;
  body?: string;
  waitContains?: string;
  tokenJsonPath?: string;
  nextPort?: number;
  timeoutMs?: number;
};
export type DriverPairing = {
  kind: "none" | "websocket-handshake" | "http-probe" | "http-handshake";
  ports?: number[];
  path?: string;
  query?: {
    nameParam?: string;
    tokenParam?: string;
    nameFrom?: "auth.name" | "room";
  };
  tlsPorts?: number[];
  waitContains?: string;
  commandAck?: "none" | "message";
  tokenJsonPath?: string;
  userPrompt?: string;
  discoverPath?: string;
  steps?: PairingStep[];
};
export type AuthType = "none" | "password" | "token" | "header" | "pin" | "userpass" | "pair";
export type LanProtocol = "tcp" | "udp" | "http" | "https" | "websocket" | "tls-websocket" | "pjlink" | "cast" | "wol";

export type MatchRule = {
  type: ParseType;
  value?: string;
  pattern?: string;
  path?: string;
  map?: Record<string, string>;
};

export type DriverSpec = {
  specVersion: string;
  device: {
    manufacturer: string;
    model: string;
    type: string;
    manualUrl?: string;
    notes?: string;
  };
  transports: {
    lan?: {
      protocol: LanProtocol;
      port: number;
      encoding?: "ascii" | "hex" | "utf8";
      payloadEncoding?: "ascii" | "hex";
      lineEnding?: string;
      timeoutMs?: number;
      session?: {
        loginPrompt?: string;
        passwordPrompt?: string;
        readyContains?: string;
        usernameFrom?: string;
        passwordFrom?: string;
        keepMs?: number;
      };
      http?: {
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        contentType?: string;
      };
    };
    rs232?: {
      baud: number;
      dataBits: number;
      parity: string;
      stopBits: number;
      encoding?: string;
      lineEnding?: string;
      timeoutMs?: number;
    };
    local?: {
      kind: LocalKind;
      path?: string;
      chip?: string;
      line?: number;
      pin?: number;
      baud?: number;
      dataBits?: number;
      parity?: string;
      stopBits?: number;
      bus?: number;
      address?: string;
      speed?: number;
      timeoutMs?: number;
    };
  };
  auth?: {
    type: AuthType;
    instanceFields?: string[];
    pairing?: DriverPairing;
  };
  session?: {
    connect?: string[];
    keepalive?: { payload?: string | null; intervalMs?: number };
    disconnect?: string[];
  };
  pacing?: { minIntervalMs?: number; powerOnDelayMs?: number };
  probe?: { transport: TransportName; payload?: string; success?: MatchRule };
  helpers?: { checksum?: ChecksumKind };
  inventory?: { resources: InventoryResource[] };
  commands: DriverCommand[];
  feedback: DriverFeedback[];
  status?: {
    protocol: "http" | "https";
    port: number;
    path: string;
  };
};

export type InventoryItem = { id: string; name: string; value?: string | number; group?: string; kind?: string };
export type DeviceInventory = Record<string, InventoryItem[]>;

export type InventoryResource = {
  id: string;
  label: string;
  httpMethod?: string;
  httpPath: string;
  itemId?: "key" | "field";
  itemName?: string;
  useCommand?: string;
};

export type ValueKind = "float" | "int" | "text";
export type ValueMap = {
  kind: ValueKind;
  inMin?: number;
  inMax?: number;
  outMin?: number;
  outMax?: number;
  decimals?: number;
  hexBytes?: number;
};

export type DriverCommand = {
  id: string;
  label: string;
  kind: CommandKind;
  transport: TransportName;
  payload: string;
  payloadEncoding?: "ascii" | "hex";
  namespace?: string;
  httpPath?: string;
  httpMethod?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  values?: string[];
  valueMap?: ValueMap;
  requires?: string[];
  wake?: { protocol: "wol" };
  ack?: { success?: MatchRule; nak?: MatchRule };
};

export type DriverFeedback = {
  id: string;
  label: string;
  kind: FeedbackKind;
  transport: TransportName;
  mode: FeedbackMode;
  query?: string;
  httpPath?: string;
  pollMs?: number;
  values?: string[];
  min?: number;
  max?: number;
  parse: MatchRule;
};

export type PanelAccess = "open" | "pin";
export type WidgetType = "button" | "toggle" | "slider" | "label" | "status" | "schedule";
export type BindKind = "command" | "feedback" | "macro" | "gotoPage" | "range" | "variable";
export type FailKind = "macro" | "gotoPage" | "none";
export type WidgetColor = "steel" | "sage" | "clay" | "fog" | "ink" | "ocean" | "pine" | "rust" | "sand" | "slate" | "rose";
export type WidgetHighlight = "auto" | "latch" | "off";

export type CompareOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";

export type EnableClause = {
  variable?: string | null;
  device?: string;
  feedback?: string;
  op?: CompareOp;
  equals: string;
};

export type EnableWhen = EnableClause & { all?: EnableClause[] };

export type WidgetBind = {
  kind: BindKind;
  id?: string;
  device?: string;
  command?: string;
  feedback?: string;
  value?: string | number;
  gotoPage?: string | null;
  variable?: string | null;
};

export type Widget = {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: WidgetColor;
  highlight?: WidgetHighlight;
  latchGroup?: string | null;
  icon?: string;
  confirm?: boolean;
  enableWhen?: EnableWhen | null;
  min?: number | string;
  max?: number | string;
  bind: WidgetBind;
};

export type MacroStep = {
  device?: string;
  command?: string;
  value?: string | number;
  setVar?: string | null;
  macroId?: string | null;
  skipIf?: { feedback: string; equals: string };
  raw?: boolean;
  delayMsAfter?: number;
};

export type RoomVariable = {
  id: string;
  label: string;
  kind: "number" | "enum" | "text";
  default: string | number;
  min?: number;
  max?: number;
  step?: number;
  values?: string[];
  pushDevice?: string | null;
  pushCommand?: string | null;
};

export type Schedule = {
  id: string;
  label: string;
  enabled: boolean;
  time: string;
  days: number[];
  macroId: string;
};

export type TriggerCompare = "eq" | "neq" | "gt" | "lt";
export type TriggerMode = "change" | "interval";

export type VariableTrigger = {
  id: string;
  label: string;
  enabled: boolean;
  variable: string;
  compare: TriggerCompare;
  equals: string;
  mode: TriggerMode;
  intervalSec?: number;
  delaySec?: number;
  holdSec?: number;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  macroId: string;
};

export type MonitorRule = {
  id: string;
  label: string;
  enabled: boolean;
  device: string;
  feedback: string;
  pollMs: number;
  writeVar: string | null;
  errorVar?: string | null;
  errorValue?: string;
  mapMode: "raw" | "map";
  map: { from: string; to: string }[];
};

export type Page = {
  id: string;
  label: string;
  grid: { cols: number; rows: number };
  widgets: Widget[];
};

export type HostInterface = {
  id: string;
  label: string;
  kind: LocalKind;
  path?: string;
  chip?: string;
  line?: number;
  baud?: number;
  bus?: number;
  address?: string;
  speed?: number;
};

export type DeviceInstance = {
  id: string;
  name: string;
  driver: string;
  transport: TransportName;
  host: string;
  port?: number;
  interface?: string;
  interfaceId?: string | null;
  baud?: number;
  bus?: number;
  address?: string;
  speed?: number;
  auth: Record<string, string>;
  enabledFeatures: string[];
  simulate: boolean;
  inventory?: DeviceInventory;
};

export type Macro = {
  id: string;
  label: string;
  retries: number;
  onFail: { kind: FailKind; id?: string };
  steps: MacroStep[];
};

export type RoomConfig = {
  configVersion: string;
  exportedAt: string | null;
  sourceRoomId: string | null;
  room: {
    id: string;
    name: string;
    panelAccess: PanelAccess;
    panelPin: string | null;
    configPin: string;
    externalControl?: boolean;
    theme: "dark" | "pastel";
    idleDimSeconds: number;
    keepAwake?: boolean;
    panelFullscreen?: boolean;
    grid: { cols: number; rows: number };
    network: {
      mode: "dhcp" | "static";
      address: string;
      prefix: number;
      gateway: string;
      dns: string;
      ntp: string;
      timezone: string;
      hostname: string;
    };
  };
  devices: DeviceInstance[];
  interfaces?: HostInterface[];
  pages: Page[];
  macros: Macro[];
  variables: RoomVariable[];
  schedules: Schedule[];
  monitors: MonitorRule[];
  triggers?: VariableTrigger[];
};

export type DeviceStateMap = Record<string, Record<string, string | number | boolean>>;

export type DeviceHealth = Record<string, { ok: boolean; message: string }>;

export type LogKind = "command" | "macro" | "monitor" | "auth" | "error" | "system";

export type LogEntry = {
  id: string;
  at: number;
  kind: LogKind;
  ok: boolean;
  title: string;
  detail: string;
};

export type MonitorStatus = {
  at: number;
  ok: boolean;
  value: string;
  message: string;
};

export type TraceLine = {
  at: number;
  dir: "tx" | "rx" | "note";
  text: string;
};

export type HostUi = {
  dim: boolean;
  locked: boolean;
  toast: string | null;
  toastAt?: number;
  block: string | null;
  pageId: string | null;
  pageAt?: number;
  fullscreenAt?: number;
};

export type RoomSnapshot = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  library: Record<string, DriverSpec>;
  state: DeviceStateMap;
  vars: Record<string, string | number>;
  health: DeviceHealth;
  log: LogEntry[];
  traces: Record<string, TraceLine[]>;
  monitorStatus: Record<string, MonitorStatus>;
  latches: Record<string, string>;
  lastError: string | null;
  runningMacro: string | null;
  activeScene: string | null;
  host?: HostUi;
};

export type CommandResult = {
  ok: boolean;
  message: string;
  pairedToken?: string;
  pairedPort?: number;
};
