export type TransportName = "lan" | "rs232" | "local";
export type LocalKind = "gpio" | "serial" | "i2c" | "spi" | "ir" | "cec" | "midi";
export type InterfaceKind = LocalKind | "gateway";
export type CommandKind = "action" | "toggle" | "range" | "enum";
export type ParseType = "regex" | "jsonpath" | "contains" | "exact" | "map";
export type MidiWatchKind = "cc" | "note" | "noteOff" | "pc" | "clock" | "start" | "stop" | "cont" | "mtc";
export type MidiWatch = {
  kind: MidiWatchKind;
  channel?: number;
  controller?: number;
  feedback: string;
};
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
export type LanProtocol = "tcp" | "udp" | "http" | "https" | "websocket" | "tls-websocket" | "pjlink" | "cast" | "wol" | "osc" | "sacn" | "ipmidi" | "rtp-midi";

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
      multicast?: boolean;
      rtpMidi?: { dataPort?: number };
      path?: string;
      query?: Record<string, string>;
      handshake?: { waitContains?: string; delayMs?: number };
      alsoSend?: { replace: Record<string, string> }[];
      session?: {
        loginPrompt?: string;
        passwordPrompt?: string;
        readyContains?: string;
        waitContains?: string;
        reply?: string;
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
      lineEnding?: string;
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
  midiWatch?: MidiWatch[];
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
  httpPath?: string;
  payload?: string;
  waitContains?: string;
  alsoSend?: string[];
  parsePath?: string;
  idField?: string;
  nameField?: string;
  valueField?: string;
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
  /** Look up SIS/GPIO bytes on the bound gateway profile instead of a fixed payload. */
  gatewayOp?: "digitalOn" | "digitalOff" | "analogOut" | "analogRead";
  /** `device.auth` field that supplies `{line}` (e.g. standbyLine). */
  gatewayLine?: string;
  namespace?: string;
  httpPath?: string;
  httpMethod?: string;
  httpHeaders?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  values?: string[];
  valueMap?: ValueMap;
  requires?: string[];
  wake?: { protocol: "wol" };
  waitContains?: string;
  alsoSend?: string[];
  osc?: { types?: string; values?: string[] };
  sacn?: { slot?: number; value?: string };
  mtcSend?: true | "sysex";
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
  httpMethod?: string;
  httpHeaders?: Record<string, string>;
  pollMs?: number;
  values?: string[];
  min?: number;
  max?: number;
  parse: MatchRule;
};

export type PanelAccess = "open" | "pin";
/** "preview" is the optional 720p RTSP tile (ffmpeg remux). Drop it with the preview files.
 *  "image" is a static image tile (host media under data/media/; /api/media). */
export type WidgetType = "button" | "slider" | "label" | "status" | "schedule" | "preview" | "image";

/** Panel tile label/body text size. Missing = md (current default look). Not used by preview/image. */
export type WidgetTextSize = "sm" | "md" | "lg";
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

/** Status traffic-light rule: first exact equals match wins. */
export type StatusColorWhen = {
  equals: string;
  color: WidgetColor;
  label?: string;
  macroId?: string | null;
};

/** Catch-all when no colorWhen row matches. Required color; label/macro optional. */
export type StatusDefault = {
  color: WidgetColor;
  label?: string;
  macroId?: string | null;
};

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
  /** Opt-in portrait cell. Missing = hidden on the portrait face. */
  portrait?: { x: number; y: number; w: number; h: number };
  label: string;
  color: WidgetColor;
  highlight?: WidgetHighlight;
  latchGroup?: string | null;
  icon?: string;
  confirm?: boolean;
  enableWhen?: EnableWhen | null;
  /** Status only: ordered color/label/macro rules (exact string equals). */
  colorWhen?: StatusColorWhen[];
  /** Status only: catch-all when no colorWhen row matches. */
  statusDefault?: StatusDefault | null;
  min?: number | string;
  max?: number | string;
  /** Optional. Slider: missing = auto (upright when the tile is taller than wide). */
  sliderDir?: "horizontal" | "vertical";
  /** Optional. Only used by type "preview". */
  streamUrl?: string;
  /** Optional. Preview RTSP: auto tries UDP then TCP. */
  previewTransport?: "auto" | "udp" | "tcp";
  /** Optional. Seconds behind live (copy remux). Default 1.2. Match I-frame interval. */
  previewDelay?: number | string;
  /** Optional. How the picture fills the tile. */
  previewFit?: "contain" | "cover";
  /** Optional. Only used by type "image". Usually /api/media/<id> from host upload. */
  imageSrc?: string;
  /** Optional. Image only: how the picture fills the tile. Do not overload previewFit. */
  imageFit?: "contain" | "cover";
  /** Optional. Image only: draw flush without WidgetShell button chrome. Default false. */
  imageBorderless?: boolean;
  /** Optional. Button/slider/label/status/schedule text size. Missing = md. Ignored for preview/image. */
  textSize?: WidgetTextSize;
  bind: WidgetBind;
};

export type MacroStep = {
  device?: string;
  command?: string;
  value?: string | number;
  setVar?: string | null;
  macroId?: string | null;
  interfaceId?: string | null;
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
  tag?: string | null;
};

export type Schedule = {
  id: string;
  label: string;
  enabled: boolean;
  time: string;
  days: number[];
  macroId: string;
  tag?: string | null;
};

export type TriggerCompare = "eq" | "neq" | "gt" | "lt";
export type TriggerMode = "change" | "interval";

export type TriggerClause = {
  variable: string;
  compare: TriggerCompare;
  equals: string;
};

export type VariableTrigger = {
  id: string;
  label: string;
  enabled: boolean;
  variable: string;
  compare: TriggerCompare;
  equals: string;
  whenTrue?: TriggerClause[];
  whenFalse?: TriggerClause[];
  mode: TriggerMode;
  intervalSec?: number;
  delaySec?: number;
  holdSec?: number;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  macroId: string;
  falseMacroId?: string;
  tag?: string | null;
};

export type MonitorRule = {
  id: string;
  label: string;
  enabled: boolean;
  device: string;
  feedback: string;
  interfaceId?: string | null;
  query?: string;
  parsePattern?: string;
  pollMs: number;
  writeVar: string | null;
  errorVar?: string | null;
  errorValue?: string;
  mapMode: "raw" | "map";
  map: { from: string; to: string }[];
  tag?: string | null;
};

export type Page = {
  id: string;
  label: string;
  grid: { cols: number; rows: number };
  /** Portrait face. Missing = use landscape (old rooms). */
  portraitGrid?: { cols: number; rows: number };
  widgets: Widget[];
};

export type HostInterface = {
  id: string;
  label: string;
  kind: InterfaceKind;
  path?: string;
  chip?: string;
  line?: number;
  baud?: number;
  bus?: number;
  address?: string;
  speed?: number;
  vendor?: string;
  host?: string;
  controlPort?: number;
  slot?: string;
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
  /**
   * B3 narrow peer face for relay-host remotes (HMAC transport).
   * unset = auto (host on outbound subnet → venue HTTPS; else AV HTTP).
   * "outbound" = venue HTTPS + outbound bind; "av" = AV HTTP.
   * Distinct from nicFace (B4): peerFace has auto and switches scheme; nicFace is bind-only.
   */
  peerFace?: "av" | "outbound" | null;
  /**
   * Trusted peer CA for venue HTTPS (strict TLS verify). Path to the remote room’s
   * Download CA PEM (or this room’s data/tls/venue/ca.cert.pem for same-install loops).
   * Required when peerFace resolves to venue; fail-closed if missing. Also auth.peerTrustedCaPath.
   */
  peerTrustedCaPath?: string | null;
  /**
   * Optional inline CA PEM paste (same trust as peerTrustedCaPath). Prefer path in room JSON.
   * Also auth.peerTrustedCaPem. Env fallback: RELAY_PEER_TRUSTED_CA.
   */
  peerTrustedCaPem?: string | null;
  /**
   * B4 per-device NIC face for general device I/O bind (localAddress).
   * unset / "av" = AV-LAN bind (default, back-compat). "outbound" = venue/NIC2 bind.
   * Soft-fails when outbound None / no IPv4. No auto. Does not replace peerFace for HMAC peers.
   */
  nicFace?: "av" | "outbound" | null;
  /**
   * Trusted CA for third-party device HTTPS / tls-websocket (strict TLS).
   * Path to a PEM (device CA or leaf-as-trust-anchor). Required on nicFace=outbound
   * for HTTPS/TLS-WS when no tlsFingerprintSha256. Also auth.deviceTrustedCaPath.
   */
  deviceTrustedCaPath?: string | null;
  /**
   * Optional inline device CA/leaf PEM paste (same trust as deviceTrustedCaPath).
   * Prefer path in room JSON. Also auth.deviceTrustedCaPem.
   */
  deviceTrustedCaPem?: string | null;
  /**
   * Optional SHA-256 certificate pin (colon-hex or bare hex). Explicit trust for
   * self-signed device leaves when no CA PEM. Also auth.tlsFingerprintSha256.
   */
  tlsFingerprintSha256?: string | null;
};

export type Macro = {
  id: string;
  label: string;
  retries: number;
  onFail: { kind: FailKind; id?: string };
  steps: MacroStep[];
  tag?: string | null;
};

export const NONE_MACRO_ID = "none";

export function noneMacro(): Macro {
  return { id: NONE_MACRO_ID, label: "None", retries: 0, onFail: { kind: "none" }, steps: [] };
}

export type Occupancy = "available" | "in-session" | "busy" | "do-not-disturb" | "closed";

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
    peerSecret?: string;
    peerMacroIds?: string[];
    externalControl?: boolean;
    panelAcceptsConfigPin?: boolean;
    theme: "dark" | "peach" | "green" | "office";
    idleDimSeconds: number;
    keepAwake?: boolean;
    panelFullscreen?: boolean;
    /** Local HDMI panel kiosk (cage). Not the in-browser fullscreen prompt. */
    panelHdmiEnabled?: boolean;
    panelHdmiOutputIndex?: number | null;
    panelHdmiOutputName?: string | null;
    grid: { cols: number; rows: number };
    avLanNicIndex?: number | null;
    avLanNicName?: string | null;
    outboundNicIndex?: number | null;
    outboundNicName?: string | null;
    /** B1 venue HTTPS PEM paths (optional; env RELAY_TLS_* wins). */
    tlsCertPath?: string | null;
    tlsKeyPath?: string | null;
    occupancy?: Occupancy;
    foyerPeerUrl?: string | null;
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
  tags?: {
    macros?: string[];
    variables?: string[];
    monitors?: string[];
    schedules?: string[];
    triggers?: string[];
  };
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

export type DriverIndex = {
  filename: string;
  manufacturer: string;
  model: string;
  type: string;
  notes?: string;
};

export function indexDriver(filename: string, spec: Pick<DriverSpec, "device">): DriverIndex {
  return {
    filename,
    manufacturer: spec.device?.manufacturer ?? "",
    model: spec.device?.model ?? "",
    type: spec.device?.type ?? "",
    notes: spec.device?.notes || undefined,
  };
}

export type RoomSnapshot = {
  config: RoomConfig;
  drivers: Record<string, DriverSpec>;
  library: Record<string, DriverIndex>;
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
  version?: string;
  process?: HostProcessStatus;
};

export type HostProcessStatus = {
  pid: number;
  uptimeSec: number;
  osUptimeSec: number;
  rssMb: number;
  heapMb: number;
  heapTotalMb: number;
  load: number;
  sockets: { ws: number; tcp: number; cast: number };
  log: number;
  runningMacro: string | null;
  lastError: string | null;
  healthFail: number;
  monitors: number;
};

export type CommandResult = {
  ok: boolean;
  message: string;
  pairedToken?: string;
  pairedPort?: number;
};
