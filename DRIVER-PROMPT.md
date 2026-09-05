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
| `tcp` | raw ASCII/hex socket (PJLink, ADCP, Extron, MIDI-TCP, many mixers) |
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

`instanceFields` lists keys stored per device. Built-in labels: `token`, `mac`, `user`, `password`, `pin`. Any other name (example `midiChannel`) is shown as a plain field and stored on `device.auth`.

Pairing must be described in JSON only (paths, ports, success text). After pairing, later commands use `{token}` or `{auth.token}`.

## Commands

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

- `id` is stable, dotted, lowercase: `power.on`, `power.off`, `volume.set`, `input.hdmi1`
- `kind`: `action` | `range` | `enum` | `toggle`
- `range` needs `min`, `max`, `step`, optional `unit`
- `requires` is optional. Example `["power.state=on"]`. Test buttons send `raw` and ignore this
- `wake.protocol = "wol"` on power-on when the device sleeps hard
- Do not hide extra conditions in prose; put them in `requires` or omit them

### Templates the engine actually substitutes

Write the **full** payload yourself. Relay does not add MIDI status bytes, running status, or NRPN framing.

| token | what it becomes |
|---|---|
| `{value}` | string of the mapped command value |
| `{value:hex2}` | that number clamped 0–255 as two lowercase hex chars (`00`–`ff`). No spaces. |
| `{value:nrpn14}` | that number clamped 0–16383 as two 7-bit bytes, four lowercase hex chars (`765c`). Not a full NRPN message. |
| `{midiChannel}` | `device.auth.midiChannel` or `device.auth.channel`, default `1`, clamped 1–16 |
| `{token}` / `{auth.token}` | stored token |
| `{auth.FIELD}` | any other key on `device.auth` |
| `{host}` `{port}` `{id}` | device instance |
| `{varName}` | room variable |

Prefer `{value:hex2}` for one data byte. Use `{value:nrpn14}` only when the device wants 14-bit data bytes and you write the rest of the frame.

Worked NRPN data-entry (MIDI channel 1 hardcoded in the status nibble `B0`):

```json
{
  "id": "lr.mute.on",
  "label": "LR Mute",
  "kind": "action",
  "transport": "lan",
  "payload": "B06300B06244B0067F",
  "payloadEncoding": "hex"
}
```

Same frame with an operator-set channel — you still write `B0`; only replace data you do not know. Relay will not turn `{midiChannel}` into `B0`.

If the channel must appear in the status byte, put the whole nibble in the payload (`B0` … `BF`) and state “MIDI channel 1” in `device.notes`, or list `midiChannel` in `instanceFields` and only use `{midiChannel}` where a decimal 1–16 is legal.

`valueMap.hexBytes` (optional, `kind: "int"` only) writes the mapped integer as zero-padded hex **before** `{value}` substitution. Do not also wrap that in `{value:hex2}`.

### Value maps

Panel 0–100 → device 0–1:

```json
"valueMap": { "kind": "float", "inMin": 0, "inMax": 100, "outMin": 0, "outMax": 1 }
```

`kind`: `float` | `int` | `text`.

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

`parse.type`: `contains` | `exact` | `regex` | `jsonpath` | `map`.

Do not invent `midi`, `nrpn`, or `sysex`.

If the reply is binary **or** `value` / `pattern` looks like hex (`B02601` or `B0 26 01`), Relay also matches against a hex dump of the bytes (lowercase and uppercase, packed and spaced). ASCII/JSON polls are not hex-dumped.

Use a quiet HTTP status plane when the control socket should stay idle.

## Inventory

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

## Probe

Cheap reachability only. Empty TCP connect is enough (`payload: ""`). Must not pop a pairing dialog. Pairing is Authenticate.

## What Relay already does (do not reimplement in JSON)

- WOL from `wake`
- Range mapping via `valueMap`
- The templates in the table above
- Macros, delays, retries, nested macros, variables, schedules, triggers
- Host UI (`relay-host.json` only)
- Serial/GPIO when the operator picks an interface

## Quality bar

- 8–25 commands operators actually use
- Labels: two or three words
- No secrets
- Valid JSON
- Vendor protocol first; Companion / MixPad / HA are inventories, not the spec
- If the only honest encoding needs a live inbound stream, a taper law, or a parse type Relay does not have: omit the command and say so in `device.notes`

## Rules from real modules

- Do not port a full NRPN / action catalog.
- One LAN plane per driver. Example only: Allen & Heath SQ third-party MIDI-TCP is port **51325**, not MixPad 51326. Other mixers use their own documented port.
- `pollMs` ≥ 4000 if a parameter GET is the only probe.
- Do not stuff decimal `{value}` into a hex payload.
- If absolute faders need a taper law you cannot express, ship ±1 dB or omit set.
- Notes install the device (port, MIDI channel, blank scenes) not the protocol essay.

## Task

Manufacturer: {{MANUFACTURER}}
Model: {{MODEL}}
Manual or notes: {{PASTE}}

Write the driver JSON now.
