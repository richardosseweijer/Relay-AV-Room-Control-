# Relay driver authoring prompt

Copy everything below the line to another AI. Attach the device manual (or model + protocol notes). Do not attach Relay source. Do not write JavaScript.

---

You write **one Relay driver**: a single JSON file. Filename `{manufacturer}-{model}.json` (lowercase, hyphens).

Relay is a room controller. The JSON is **data only**. The engine already sends HTTP, TCP, WebSocket, Cast, WOL, and hex/ASCII payloads. You fill ports, paths, and bytes from the manual. You do not invent keys, parse types, or a scripting language.

If the manual is unclear, **omit that command** and mention it in `device.notes`.

## 10-minute workflow

1. Read the vendor protocol (PDF / MIDI-TCP / HTTP). Companion and MixPad are inventories, not the spec.
2. Pick **one** LAN plane (table below).
3. Copy the matching skeleton. Keep `specVersion` `"2"`.
4. Add 8–25 room commands only (power, source, mute, 1–2 levels, a few scenes). Not the full remote dump.
5. Add feedback only if you can parse it with `contains` / `exact` / `regex` / `jsonpath` / `map`.
6. Probe must be cheap (empty TCP or one GET). Pairing is a separate Authenticate step.
7. Output valid JSON only.

## Pick a transport

| If the manual says | `protocol` | wire | `lineEnding` |
|---|---|---|---|
| REST / JSON HTTP | `http` or `https` | `ascii` | `""` |
| ASCII socket (PJLink, Extron, ADCP) | `tcp` | `ascii` | `"\r"` unless the doc says otherwise |
| Raw bytes / MIDI-TCP | `tcp` | set `encoding` to `hex` | `""` |
| Browser WebSocket | `websocket` | `ascii` | `""` |
| TLS WebSocket | `tls-websocket` | `ascii` | `""` |
| Chromecast | `cast` | `ascii` | `""` |
| OSC UDP | `osc` | binary OSC | n/a — payload is the path; `osc.types` / `osc.values` |
| sACN / E1.31 | `sacn` | E1.31 multicast | n/a — `sacn.slot` 1–512, `auth.universe` |
| USB MIDI (ALSA) | `local.kind` `midi` | hex bytes via `amidi` | n/a — Interface Path `hw:1,0,0` (`amidi -l`) |
| ipMIDI / multicast MIDI | `ipmidi` | hex MIDI UDP | n/a — group 225.0.0.37:21928 TTL 1. Not MIDI-TCP. |
| RTP-MIDI / AppleMIDI | `rtp-midi` | hex MIDI in RTP | n/a — control 5004, data 5005. Type the IP; no Bonjour. |

One plane per driver. Example only: Allen & Heath SQ third-party control is MIDI-TCP **51325**, not MixPad 51326. Other desks use their own port.

## Skeleton A — HTTP

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Brand", "model": "Model", "type": "display", "notes": "Port 80. Token in the device card." },
  "transports": {
    "lan": {
      "protocol": "http",
      "port": 80,
      "encoding": "ascii",
      "timeoutMs": 2000,
      "http": { "method": "GET", "path": "/api", "contentType": "application/json" }
    }
  },
  "auth": { "type": "token", "instanceFields": ["token"] },
  "pacing": { "minIntervalMs": 120 },
  "probe": { "transport": "lan", "payload": "" },
  "commands": [
    {
      "id": "power.on",
      "label": "Power On",
      "kind": "action",
      "transport": "lan",
      "payload": "",
      "httpPath": "/api/{token}/power",
      "httpMethod": "PUT"
    }
  ],
  "feedback": [
    {
      "id": "power.state",
      "label": "Power",
      "kind": "enum",
      "values": ["off", "on"],
      "transport": "lan",
      "mode": "poll",
      "httpPath": "/api/{token}/power",
      "pollMs": 4000,
      "parse": { "type": "jsonpath", "path": "state", "map": { "on": "on", "off": "off" } }
    }
  ],
  "inventory": { "resources": [] }
}
```

## Skeleton B — ASCII TCP

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Brand", "model": "Model", "type": "projector", "notes": "TCP 4352. Password prompt PJLINK 1." },
  "transports": {
    "lan": {
      "protocol": "tcp",
      "port": 4352,
      "encoding": "ascii",
      "payloadEncoding": "ascii",
      "lineEnding": "\r",
      "timeoutMs": 2000,
      "session": { "passwordPrompt": "PJLINK 1", "keepMs": 30000 }
    }
  },
  "auth": { "type": "pin", "instanceFields": ["password"] },
  "pacing": { "minIntervalMs": 150 },
  "probe": { "transport": "lan", "payload": "" },
  "commands": [
    { "id": "power.on", "label": "Power On", "kind": "action", "transport": "lan", "payload": "%1POWR 1" },
    { "id": "power.off", "label": "Power Off", "kind": "action", "transport": "lan", "payload": "%1POWR 0" }
  ],
  "feedback": [
    {
      "id": "power.state",
      "label": "Power",
      "kind": "enum",
      "values": ["off", "on"],
      "transport": "lan",
      "mode": "poll",
      "query": "%1POWR ?",
      "pollMs": 5000,
      "parse": { "type": "contains", "value": "POWR=1" }
    }
  ],
  "inventory": { "resources": [] }
}
```

## Skeleton C — hex TCP (MIDI / binary)

Write the **entire** frame. Relay does not add status nibbles.

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Allen & Heath", "model": "SQ-5", "type": "other", "notes": "MIDI-TCP 51325. Frames below are MIDI channel 1 (status B0). Change B0 to B1–BF by hand if the desk is not channel 1. Blank scenes will not load." },
  "transports": {
    "lan": { "protocol": "tcp", "port": 51325, "encoding": "hex", "lineEnding": "", "timeoutMs": 2000 }
  },
  "auth": { "type": "none", "instanceFields": [] },
  "pacing": { "minIntervalMs": 40 },
  "probe": { "transport": "lan", "payload": "" },
  "commands": [
    { "id": "lr.mute.on", "label": "LR Mute", "kind": "action", "transport": "lan", "payload": "B06300B06244B00600B02601", "payloadEncoding": "hex" },
    { "id": "lr.mute.off", "label": "LR Unmute", "kind": "action", "transport": "lan", "payload": "B06300B06244B00600B02600", "payloadEncoding": "hex" }
  ],
  "feedback": [],
  "inventory": { "resources": [] }
}
```

## Skeleton D — TLS WebSocket

Path, query, TLS, and handshake text come from this file. The engine has no brand defaults.

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Brand", "model": "Model", "type": "display", "notes": "Control socket is TLS. Authenticate once. Status HTTP is a different port." },
  "transports": {
    "lan": {
      "protocol": "tls-websocket",
      "port": 8002,
      "timeoutMs": 8000,
      "path": "/control",
      "query": { "name": "{base64:Relay}", "token": "{token}" },
      "handshake": { "waitContains": "connected", "delayMs": 500 },
      "alsoSend": [{ "replace": { "list": "list-alt" } }],
      "http": { "path": "/control" }
    }
  },
  "auth": {
    "type": "token",
    "instanceFields": ["token", "name"],
    "pairing": {
      "kind": "websocket-handshake",
      "ports": [8002],
      "tlsPorts": [8002],
      "path": "/control",
      "query": { "nameParam": "name", "tokenParam": "token", "nameFrom": "auth.name" },
      "waitContains": "connected",
      "tokenJsonPath": "token",
      "userPrompt": "Accept the pairing prompt on the device, then Authenticate again.",
      "steps": [
        { "action": "websocket", "port": 8002, "tls": true, "path": "/control", "waitContains": "connected", "tokenJsonPath": "token", "timeoutMs": 12000 }
      ]
    }
  },
  "status": { "protocol": "http", "port": 8001, "path": "/api/" },
  "probe": { "transport": "lan", "payload": "" },
  "commands": [
    { "id": "power.off", "label": "Power Off", "kind": "action", "transport": "lan", "payload": "{\"cmd\":\"off\"}" }
  ],
  "feedback": [],
  "inventory": {
    "resources": [
      {
        "id": "apps",
        "label": "Apps",
        "payload": "{\"cmd\":\"list\"}",
        "alsoSend": ["{\"cmd\":\"list-alt\"}"],
        "waitContains": "apps",
        "parsePath": "data",
        "idField": "id",
        "nameField": "name"
      }
    ]
  }
}
```

## Tokens the engine substitutes

| token | becomes |
|---|---|
| `{value}` | mapped command value as text |
| `{value:hex2}` | number clamped 0–255 → two lowercase hex chars (`7f`) |
| `{value:nrpn14}` | number clamped 0–16383 → two 7-bit bytes as four hex chars (`765c`). Not a full NRPN message. |
| `{midiChannel}` | `device.auth.midiChannel` or `channel`, default `1`, range 1–16. Decimal. Not `B0`. |
| `{token}` `{auth.token}` | stored token |
| `{auth.FIELD}` | any other instance field |
| `{host}` `{port}` `{id}` | this device |
| `{scene}` etc. | room variable whose **id** is that name (`{tvPower}` if the variable id is `tvPower`) |

`valueMap` (`float` \| `int` \| `text`) runs **before** `{value}` / `{value:hex2}`. Optional `hexBytes` on an `int` map writes zero-padded hex into `{value}` — do not also wrap that in `{value:hex2}`.

## Auth

- `none` — open port
- `token` — operator pastes `token`
- `pin` / `userpass` — `pin` or `user` + `password`
- `pair` — device shows Allow; store `token` from the pairing step (`pairing.steps` or `kind` `websocket-handshake` / `http-handshake`). Put path, TLS, `waitContains`, and `tokenJsonPath` in the JSON. The engine does not guess brand URLs.

`lan.path` / `lan.query` build the WebSocket URL (`{token}`, `{base64:…}`). `lan.handshake.waitContains` is the text that means the socket is up. `delayMs` waits after that before the first payload. `lan.alsoSend` is string-replace extra frames; command/inventory `alsoSend` is extra raw frames. TCP `session.reply` is sent if `readyContains` is missing. Inventory parse uses only `parsePath`, `idField`, `nameField`, `valueField` (or `itemId`/`itemName`). No engine brand names.

List extras in `instanceFields` (`midiChannel`, `mac`, …). They appear on the device card.

## Commands and feedback

- `kind`: `action` | `range` | `enum` | `toggle`
- Range needs `min`, `max`, `step`
- `requires`: optional `["power.state=on"]`. Test buttons send `raw` and skip this
- `wake`: `{ "protocol": "wol" }` plus instance `mac` for hard-sleep power-on. Empty payload after WOL does not send HTTP.
- Cast `PLAY` / `PAUSE` / `STOP` / `QUEUE_*`: set `namespace` to `urn:x-cast:com.google.cast.media`. The engine fills `mediaSessionId` from the live app. Do not hard-code session `1`.
- `httpMethod` `RPC` is Windows remote shutdown (not a generic HTTP verb). Use it only on a PC-style driver with `user`/`password`.
- Parse types only: `contains`, `exact`, `regex`, `jsonpath`, `map`
- Binary replies: hex needle (`B02601` or `B0 26 01`) is also matched against a hex dump. JSON/ASCII polls are not hex-dumped
- Inventory: only for bridges that list children (lights, scenes)

## Probe

Empty `payload` (or omitted payload) is TCP connect only — the socket opening is success. The engine does not read a reply and does not look for `ok` or `open`. Put a payload + `success` needle only when the device must answer a short get. Pairing dialogs belong on Authenticate. `pollMs` ≥ 4000 if you poll a parameter.

## Skeleton E — OSC UDP

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Brand", "model": "Desk", "type": "mixer", "notes": "OSC UDP 9000. Payload is the path." },
  "transports": { "lan": { "protocol": "osc", "port": 9000, "timeoutMs": 2000 } },
  "auth": { "type": "none" },
  "pacing": { "minIntervalMs": 40 },
  "probe": { "transport": "lan", "payload": "/ping" },
  "commands": [
    { "id": "ping", "label": "Ping", "kind": "action", "transport": "lan", "payload": "/ping" },
    { "id": "level.set", "label": "Fader", "kind": "range", "min": 0, "max": 1, "step": 0.01, "transport": "lan", "payload": "/ch/1/mix/fader", "osc": { "types": "f", "values": ["{value}"] } }
  ],
  "feedback": []
}
```

## Skeleton F — sACN / E1.31

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Generic", "model": "sACN Universe", "type": "lights", "notes": "E1.31 multicast 239.255.0.{universe}:5568 TTL 1. Set universe on the card. Not for office Wi-Fi." },
  "transports": { "lan": { "protocol": "sacn", "port": 5568, "timeoutMs": 1000 } },
  "auth": { "type": "none", "instanceFields": ["universe"] },
  "pacing": { "minIntervalMs": 25 },
  "commands": [
    { "id": "power.on", "label": "Lights On", "kind": "action", "transport": "lan", "payload": "255", "sacn": { "slot": 1, "value": "255" } },
    { "id": "power.off", "label": "Lights Off", "kind": "action", "transport": "lan", "payload": "0", "sacn": { "slot": 1, "value": "0" } },
    { "id": "level.set", "label": "Level", "kind": "range", "min": 0, "max": 255, "step": 1, "transport": "lan", "payload": "{value}", "sacn": { "slot": 1, "value": "{value}" } }
  ],
  "feedback": []
}
```

## Skeleton — USB MIDI (local)

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Generic", "model": "USB MIDI", "type": "mixer", "notes": "ALSA amidi. Path hw:1,0,0 (amidi -l). Channel 1 status nibbles. Linux only." },
  "transports": { "local": { "kind": "midi", "path": "hw:1,0,0", "timeoutMs": 1500 } },
  "auth": { "type": "none", "instanceFields": ["midiChannel"] },
  "pacing": { "minIntervalMs": 20 },
  "commands": [
    { "id": "note.on", "label": "Note On C4", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "local", "payload": "90 3C {value:hex2}" },
    { "id": "note.off", "label": "Note Off C4", "kind": "action", "transport": "local", "payload": "80 3C 00" },
    { "id": "level.set", "label": "CC7 Volume", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "local", "payload": "B0 07 {value:hex2}" }
  ],
  "feedback": []
}
```

## Skeleton — ipMIDI (multicast MIDI)

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Generic", "model": "ipMIDI", "type": "mixer", "notes": "UDP multicast 225.0.0.37:21928 TTL 1. Host unused unless lan.multicast is false." },
  "transports": { "lan": { "protocol": "ipmidi", "port": 21928, "encoding": "hex", "timeoutMs": 1000 } },
  "auth": { "type": "none", "instanceFields": ["midiChannel"] },
  "pacing": { "minIntervalMs": 20 },
  "commands": [
    { "id": "note.on", "label": "Note On C4", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "lan", "payload": "90 3C {value:hex2}" },
    { "id": "note.off", "label": "Note Off C4", "kind": "action", "transport": "lan", "payload": "80 3C 00" },
    { "id": "level.set", "label": "CC7 Volume", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "lan", "payload": "B0 07 {value:hex2}" }
  ],
  "feedback": []
}
```

## Skeleton G — RTP-MIDI (AppleMIDI)

```json
{
  "specVersion": "2",
  "device": { "manufacturer": "Generic", "model": "RTP-MIDI", "type": "mixer", "notes": "AppleMIDI 5004/5005. Type the desk IPv4. Enable Network MIDI. No Bonjour." },
  "transports": { "lan": { "protocol": "rtp-midi", "port": 5004, "encoding": "hex", "timeoutMs": 2000, "session": { "keepMs": 60000 } } },
  "auth": { "type": "none", "instanceFields": ["midiChannel"] },
  "pacing": { "minIntervalMs": 20 },
  "commands": [
    { "id": "note.on", "label": "Note On C4", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "lan", "payload": "90 3C {value:hex2}" },
    { "id": "note.off", "label": "Note Off C4", "kind": "action", "transport": "lan", "payload": "80 3C 00" },
    { "id": "level.set", "label": "CC7 Volume", "kind": "range", "min": 0, "max": 127, "step": 1, "transport": "lan", "payload": "B0 07 {value:hex2}" }
  ],
  "feedback": []
}
```

## Do not

- Invent parse types (`midi`, `nrpn`, `sysex`) or engine keys
- Put JS, formulas, or loops in the JSON
- Stuff decimal `{value}` into a hex payload
- Port a Companion catalog (48 inputs × N mixes)
- Use MixPad / vendor-app framing because a sniffer saw it
- Claim live MIDI feedback unless you can parse a poll with the types above — if not, omit it and say so in `device.notes`
- Put host UI (dim, lock, toast) in a device driver

## MIDI in / MTC

`midiWatch` on the driver (not a parse type) writes existing feedback ids. Monitors already watch that state.

| `kind` | match | value written |
|---|---|---|
| `cc` | optional `channel` 1–16, `controller` 0–127 | decimal 0–127 |
| `note` / `noteOff` / `pc` | optional `channel` | note or program number |
| `clock` / `start` / `stop` / `cont` | realtime | tick count or 1/0 |
| `mtc` | eight quarter-frames or SysEx full frame | `HH:MM:SS:FF` |

Command `mtcSend: true` (or `"sysex"`) encodes `{value}` as `HH:MM:SS:FF` on the existing send path. Relay is not a master clock.

## Quality bar

- 8–25 labels an operator would tap: `Power On`, `HDMI 2`, `LR Mute`, `Scene 1`
- Every payload appears in a vendor doc, a capture, or a module that cites the doc
- Notes install the box (port, channel, “blank scenes will not load”), not a protocol essay

## Task

Manufacturer: {{MANUFACTURER}}
Model: {{MODEL}}
Manual or notes: {{PASTE}}

Write the driver JSON now. Pick skeleton A, B, or C and fill it.
