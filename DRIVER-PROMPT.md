# Relay driver authoring prompt

Copy everything below the line to another AI. Attach the device manual or paste model + protocol notes. Do not attach Relay source.

---

You are writing a **Relay room-controller driver**. Output **one JSON file only** (no markdown fence unless asked). Filename: `{manufacturer}-{model}.json` in lowercase, hyphens, `.json` suffix.

Relay talks to devices through **transports**. The JSON must describe every command, poll, pairing step, and value conversion. Do not invent engine features. If the manual is unclear, omit that command and mention it in `device.notes`.

## File shape

```json
{
  "specVersion": "2",
  "device": {
    "manufacturer": "Brand",
    "model": "Exact model",
    "type": "display | projector | amplifier | lights | camera | switcher | host | other",
    "notes": "Short operator notes: ports, pairing, quirks."
  },
  "transports": {
    "lan": {
      "protocol": "http | https | tcp | websocket | tls-websocket | cast",
      "port": 80,
      "encoding": "ascii",
      "payloadEncoding": "ascii",
      "lineEnding": "\r",
      "timeoutMs": 2000,
      "http": { "method": "GET", "path": "/api", "contentType": "application/json" }
    }
  },
  "auth": {
    "type": "none | token | pin | userpass | pair",
    "instanceFields": ["token"],
    "pairing": {
      "discoverPath": "/api/v2/",
      "prompt": "Accept Allow on the device"
    }
  },
  "pacing": { "minIntervalMs": 120, "powerOnDelayMs": 0 },
  "probe": { "transport": "lan", "payload": "", "success": { "type": "contains", "value": "ok" } },
  "commands": [],
  "feedback": [],
  "inventory": []
}
```

`specVersion` must be `"2"`. `rs232` and `local` may be added next to `lan` but LAN is enough for v1.

## Transports

Use **one primary LAN protocol** that the manual specifies.

| protocol | when |
|---|---|
| `http` / `https` | REST or simple GET/POST |
| `tcp` | raw ASCII/hex socket (PJLink, ADCP, Extron, many mixers) |
| `websocket` | unencrypted WS |
| `tls-websocket` | Samsung 8002 and similar |
| `cast` | Chromecast / Google Cast TLS protobuf |

Optional LAN fields:

- `session`: `{ "login": "payload", "passwordPrompt": "text", "keepMs": 30000 }` for devices that greet then wait for a password
- `payloadEncoding`: `"ascii"` (default) or `"hex"` (binary protocols)
- `lineEnding`: `"\r"`, `"\n"`, `"\r\n"`, or `""`
- `wake`: on a command, `{ "protocol": "wol" }` plus the instance MAC

Optional `rs232`: `{ "baud": 9600, "dataBits": 8, "parity": "none", "stopBits": 1, "encoding": "ascii", "lineEnding": "\r" }`

Optional `local.kind`: `serial | gpio | i2c | spi | ir | cec`

## Auth and pairing

`auth.type`:

- `none` — open port
- `token` — operator pastes a token; field id `token`
- `pin` / `userpass` — instance fields `pin` or `user` + `password`
- `pair` — device shows Allow; Relay stores `token` from the response

`instanceFields` lists keys stored per device (shown in the device card): `token`, `mac`, `user`, `password`, `pin`, `baud`, …

Pairing must be described in JSON only (paths, ports, success text). After pairing, later commands use `{token}` in URLs or headers.

## Commands

Each command:

```json
{
  "id": "power.on",
  "label": "Power On",
  "kind": "action",
  "transport": "lan",
  "payload": "",
  "httpPath": "/api/power",
  "httpMethod": "POST",
  "requires": [],
  "valueMap": null,
  "ack": { "success": { "type": "contains", "value": "OK" } }
}
```

Rules:

- `id` is stable, dotted, lowercase: `power.on`, `power.off`, `volume.set`, `input.hdmi1`, `media.pause`
- `kind`: `action` | `range` | `enum` | `toggle`
- `range` needs `min`, `max`, `step`, optional `unit`
- Templates in payload / path: `{value}`, `{value:hex2}`, `{value:nrpn14}`, `{midiChannel}`, `{token}`, `{host}`, `{port}`, `{id}`, `{auth.field}`, and `{varName}`
- `{midiChannel}` comes from the device instance field `midiChannel` (default 1). List `midiChannel` in `instanceFields` if the operator must set it.
- `{value:nrpn14}` is 14-bit MIDI (two hex bytes) from the numeric value after `valueMap`.
- `valueMap.hexBytes` formats an `int` map as zero-padded hex.
- `requires` is optional. Example `["power.state=on"]`. Test buttons send `raw` and ignore this
- `wake.protocol = "wol"` on power-on when the device sleeps hard
- Do not hide extra conditions in prose; put them in `requires` or omit them

### Value maps (ranges)

When the device wants 0–1 float and the panel is 0–100:

```json
"kind": "range",
"min": 0,
"max": 100,
"valueMap": { "kind": "float", "inMin": 0, "inMax": 100, "outMin": 0, "outMax": 1 }
```

`kind` of map: `float` | `int` | `text`. Use `text` for raw strings.

## Feedback (polls)

```json
{
  "id": "power.state",
  "label": "Power",
  "kind": "enum",
  "values": ["off", "on"],
  "transport": "lan",
  "mode": "poll",
  "query": "",
  "httpPath": "/api/v2/",
  "pollMs": 4000,
  "parse": { "type": "jsonpath", "path": "device.PowerState", "map": { "on": "on", "off": "off" } }
}
```

`parse.type`:

- `contains` — `{ "type": "contains", "value": "ON" }`
- `exact`
- `regex` — `{ "type": "regex", "pattern": "OK([0-9A-Fa-f]+)", "map": { "00": "off", "01": "on" } }`
- `jsonpath` — dotted path into JSON (`device.PowerState`)
- `map` — lookup table on the raw body

Use a **status plane** (HTTP GET) for power/app when the control plane is a socket that should stay quiet.

`kind`: `enum` | `range` | `text`. Monitors write the parsed string into a room variable.

## Inventory

For bridges that list child objects (lights, scenes, inputs):

```json
{
  "id": "lights",
  "label": "Lights",
  "resource": "lights",
  "query": "/api/{token}/lights",
  "parse": { "type": "jsonpath", "path": "" },
  "command": "light.on"
}
```

Keep groups short. Ids must be the ids the device API expects.

## Probe

`probe` is a cheap reachability check (HTTP GET or short TCP payload). It must not pop a pairing dialog in a loop. Pairing is a separate Authenticate action.

## What Relay already does (do not reimplement in JSON)

- WOL packet from `wake`
- 0–100 panel range → device range via `valueMap`
- `{value}` / `{token}` substitution
- Macro delays, retries, nested macros
- Variables, schedules, triggers
- Host UI (dim, lock, toast, block) — that is `relay-host.json`, not this file
- Serial/GPIO routing when the operator picks an interface

## What you must put in JSON

- Exact payload / path / method
- Port and protocol
- Pairing URL and where the token appears
- How to parse power, volume, input, mute
- Hex vs ASCII
- Any login banner for TCP sessions

## Quality bar

- Prefer 8–25 commands operators actually use, not the full remote dump
- Labels are two or three words: `Power On`, `HDMI 2`, `Volume`
- No secrets in the file
- Valid JSON
- If both HTTP status and a control socket exist, poll HTTP and send keys on the socket

## Task

Manufacturer: {{MANUFACTURER}}
Model: {{MODEL}}
Manual or notes: {{PASTE}}

Write the driver JSON now.

## Rules from real modules (Companion, vendor PDFs, captures)

Work from the vendor protocol first. Companion is an action inventory, not the spec.

- Room set: 8–25 commands. Do not port a full NRPN catalog.
- One LAN plane. Example: Allen & Heath SQ 3rd-party control is MIDI-TCP **51325**, not MixPad 51326.
- Probe must be cheap. Empty TCP connect is enough. Do not dump mixer state on connect. `pollMs` ≥ 4000 if you must GET a parameter.
- Parse `contains` / `exact` / `regex` also match a hex dump of the reply. Prefer documented hex in `value` when `payloadEncoding` is `hex`.
- Do not invent parse types (`midi`, `nrpn`, `sysex`) or engine keys.
- Do not stuff decimal `{value}` into a hex payload. Use `{value:hex2}`, `{value:nrpn14}`, or `valueMap.hexBytes`.
- If absolute faders need a taper law you cannot express, ship ±1 dB or omit set.
- If a feature needs a live inbound MIDI stream, omit it and say so in `device.notes`.
- Labels for a room: `Scene 1`, `LR Mute`, not console jargon.

