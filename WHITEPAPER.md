# Relay — how it is built

Bird’s-eye view of the room controller: what runs where, how a button press becomes a packet, and which files own which job.

Relay is a local web app. One Node process hosts the configurator, the operator panel, and the device engine. Room data stays on that machine. Drivers are JSON. The engine only implements transports.

This document describes the software as it exists in this repository. It is not a vendor manual for TVs or mixers.

---

## 1. What you are looking at

```
 Phone / tablet / Pi screen
        │  HTTP
        ▼
 ┌────────────────── Vite + TanStack Start ──────────────────┐
 │  /            operator panel (buttons, sliders)            │
 │  /config      PIN-gated editor                             │
 │  /api/room    live snapshot (state, vars, health, log)     │
 │                                                            │
 │  src/lib/control/engine.ts     transports + parse          │
 │  src/lib/control/store.server.ts  memory + disk + clocks   │
 │  data/relay-room.json          saved room                  │
 │  data/drivers/*.json           device recipes              │
 └────────────────────────────────────────────────────────────┘
        │  TCP / HTTP / WS / Cast / serial / GPIO / …
        ▼
   TV, Hue, Chromecast, projector, Pi pins, …
```

Two people use it:

- **Operator** — `/` — presses tiles. Does not edit drivers.
- **Integrator** — `/config` — PIN, devices, pages, macros, schedules, monitors.

The same process serves both. There is no separate “cloud controller.”

---

## 2. Runtime loop

On boot, `store.server.ts` loads `data/relay-room.json` and every JSON in `data/drivers/`. If the room file is missing it seeds a demo. Variables get default values. A timer then runs:

1. **Monitors** — poll selected feedback, write a variable (optional write-on-error).
2. **Schedules** — if clock + weekday match, run a macro once for that minute.
3. **Triggers** — if a variable matches, run a macro (on change or on interval).
4. **Snapshot** — `/api/room` returns config + vars + device state + health + log.

A panel press does **not** talk to the TV itself. It calls a server function (`fireMacro` / `fireCommand` / `setVariable`). The engine looks up the driver JSON, fills `{value}` / `{token}` / `{host}`, sends on the chosen transport, parses the reply, updates state.

Macros are lists of steps: command, delay, set-variable, or nested macro. Failures retry, then the step’s on-fail target.

---

## 3. Objects

| Object | Role |
|---|---|
| **Driver** | How *a model* speaks. Ports, payloads, parse rules, pairing. No room names. |
| **Device** | One instance: driver + IP or interface + tokens. |
| **Variable** | Room memory (`tvPower`, `volume`). Buttons and sliders bind here. |
| **Monitor** | Poll this feedback → write that variable. |
| **Macro** | Ordered steps across devices. |
| **Page / widget** | Grid tile: button, slider, status, label, next-schedule. |
| **Schedule** | Clock + days → macro. |
| **Trigger** | Variable condition → macro. |
| **Interface** | Local COM / GPIO / I2C / IR / CEC path on the host. |
| **Host device** | `relay-host.json` — dim, lock, toast, block, restart, update. |

Drivers live in two layers: **library** (files on disk) and **room** (which files this config uses). Deleting from the room does not have to delete the library file.

---

## 4. Engine rules (what JSON may assume)

Implemented in `engine.ts`. Do not invent extra syntax in a driver.

- Transports: `http`, `https`, `tcp`, `udp`, `websocket`, `tls-websocket`, `cast`, `pjlink`, `wol`, plus local `serial` / `gpio` / `i2c` / `spi` / `ir` / `cec`.
- Encoding: ASCII or hex. Odd-length hex is rejected. Hex replies stay hex, not UTF-8.
- Tokens: `{value}`, `{value:hex2}`, `{value:nrpn14}`, `{token}`, `{auth.FIELD}`, `{host}`, `{port}`, `{id}`, and `{variableId}`.
- `{midiChannel}` is the decimal 1–16 from the device card. Status nibbles (`B0`) are still written by hand.
- Empty TCP probe = “socket opened.” A success needle is only used when the probe sends a payload.
- `valueMap` converts 0–100 panel range to the device range.
- WOL is a wake packet plus optional delay, not a guarantee the set is on.
- Pairing is an explicit Authenticate action. Probe must not spam Allow dialogs.

Authoring details: [DRIVER-PROMPT.md](DRIVER-PROMPT.md).

---

## 5. Persistence and safety

- Room: `data/relay-room.json` (and a PGLite row if the template DB is present).
- Drivers: `data/drivers/*.json`.
- Update log: `data/relay-update.log`.
- Config PIN and panel PIN are stored in the room file (plaintext; disclosed in PRIVACY.md).
- Export strips PINs and tokens. Import keeps this host’s secrets when the file left them blank.
- Panel and LAN control can run without a token if “external control” is left on. Treat the bind address as a trusted LAN.
- `system.update` (Room tab) is `git pull --ff-only` + `npm install` + restart. Zip checkouts cannot use it.

---

## 6. File map

### Product (read these first)

| File | Job |
|---|---|
| `src/lib/control/types.ts` | All room / driver / widget types. |
| `src/lib/control/engine.ts` | Transports, render payload, parse, WOL, host commands, update/restart. |
| `src/lib/control/store.server.ts` | Load/save room, driver files, monitors, schedules, triggers, snapshot. |
| `src/lib/control/actions.ts` | Server functions the UI calls (save, fire, pair, export/import, update). |
| `src/lib/control/vars.ts` | Template `{name}`, clamp, enable-when, seed defaults. |
| `src/lib/control/schema.ts` | Driver validation, pairing steps, orphan-binding check. |
| `src/lib/control/schedule.ts` | Next enabled schedule for the panel tile. |
| `src/lib/control/defaults.ts` | Demo room + bundled drivers (Samsung, Hue, Cast, host, …). |
| `src/lib/control/extra-drivers.ts` | More bundled JSON kept out of the demo seed. |
| `src/components/panel/control-panel.tsx` | Operator UI. |
| `src/components/panel/widget-face.tsx` | Tile chrome and colours. |
| `src/components/config/config-app.tsx` | Integrator UI (all config tabs). |
| `src/routes/index.tsx` | `/` |
| `src/routes/config.tsx` | `/config` |
| `src/routes/api/room.ts` | Live snapshot GET. |
| `src/routes/api/ping.ts` | Reachability helper. |
| `src/styles.css` | Panel look. |

### Host and install

| File | Job |
|---|---|
| `scripts/update-relay.mjs` | Git pull, npm install, relaunch (or systemd restart). |
| `LINUX.md` | Pi / Debian install, packages, systemd, update. |
| `WINDOWS.md` | Windows install and update. |
| `DRIVER-PROMPT.md` | Prompt to hand another AI so it can write a driver JSON. |
| `README.md` | Short start + disclaimer. |
| `LICENSE` / `NOTICE` / `PRIVACY.md` / `SECURITY.md` | Legal and ops notes. |

### Data on a live box

| Path | Job |
|---|---|
| `data/relay-room.json` | Last saved room. |
| `data/drivers/` | Library copies of driver JSON. |
| `public/drivers/` | Optional copies served as static files. |

### Scaffold you can ignore

The repo started as an app-builder Vite template. These are not part of room control:

- `src/lib/auth/*`, `src/lib/app-data/*`, `src/lib/multiplayer/*`
- most of `scripts/*` except `update-relay.mjs`
- `server/middleware/grok-pwa.ts`, preview-host-bridge, PGLite auth migrations

They boot the dev server. They do not drive devices.

---

## 7. Typical change paths

**New device model**  
Write `{maker}-{model}.json` from DRIVER-PROMPT.md → Drivers tab upload → add Device → Authenticate if needed → Probe → bind macros.

**New operator tile**  
Pages tab: empty cell → widget → type + macro or variable. Highlight from a variable or a latch group.

**New behaviour without a new driver**  
Macro + variable + optional monitor or trigger. Host commands cover dim / lock / toast / block.

**Engine vs driver**  
If every brand would need the same new wire feature (hex RX, WOL, pacing), change `engine.ts` and the prompt. If only one model is odd, change that JSON.

---

## 8. Limits

- One process per room (or two panels on the same process).
- No live MIDI session; hex TCP is fire-and-forget.
- RS-232 / GPIO need the hardware on *this* host.
- Fullscreen and wake-lock are browser APIs. iOS Safari only hides chrome as a home-screen app.
- Code is AI-generated and not independently audited. See README.
