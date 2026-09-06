# Relay architecture

Relay **0.7.2**. Technical overview of the room-control application: process model, data objects, execution path from the operator surface to a device transport, persistence, and the source files that implement each layer.

This document describes the software in this repository. It is not a substitute for manufacturer protocol manuals. Driver syntax is specified separately in [DRIVER-PROMPT.md](DRIVER-PROMPT.md). Legal and operational notices are in [NOTICE](NOTICE), [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md).

---

## 1. Purpose and scope

Relay is a single-process, LAN-hosted controller for audiovisual and related equipment. An integrator describes each product as a JSON driver (ports, payloads, authentication, parse rules). The operator sees only a grid of buttons and sliders bound to those capabilities.

The application is intended to run on a machine that remains on the same private network as the devices (a Windows PC during commissioning, a Raspberry Pi in a finished room). It does not depend on a cloud service for control. Device protocols implemented by third parties are used without affiliation; see NOTICE.

The repository also contains Vite / TanStack Start scaffolding used to boot the HTTP server. Device I/O is only in `src/lib/control/`, `src/components/panel/`, `src/components/config/`, and `src/routes/`.

---

## 2. Process model

One Node.js process serves three surfaces:

| Path | Audience | Function |
|---|---|---|
| `/` | Operator | Control panel. Polls `/api/room` and invokes server functions to run macros, set variables, and send single commands. |
| `/config` | Integrator | PIN-protected editor for room, devices, pages, macros, logic, drivers, interfaces, and the action log. |
| `/api/room` | Both | JSON snapshot of configuration, variables, device state, health, traces, and recent log lines. |

There is no separate device-gateway process. HTTP, TCP, TLS WebSocket, Cast, Wake-on-LAN, and local interfaces are opened from `src/lib/control/engine.ts` inside the same process.

A second browser (wall tablet and desk tablet) may attach to the same origin. Both share one configuration and one variable store.

Default development bind is `0.0.0.0:8081` so other hosts on the LAN can open the panel. Production deployments should treat that bind as a trusted network. See section 8.

```
Operator browser          Integrator browser
        │                         │
        └────────── HTTP ─────────┘
                      │
                      ▼
           Vite + TanStack Start
           (routes + server functions)
                      │
          ┌───────────┴────────────┐
          ▼                        ▼
   store.server.ts            engine.ts
   (memory, disk, clocks)     (transports)
          │                        │
          ▼                        ▼
   data/relay-room.json      LAN / serial / GPIO
   data/relay-secrets.json   PINs and device tokens
   data/drivers/*.json       HDMI-CEC / IR / …
```

---

## 3. Execution path

### 3.1 Start-up

`ensureLoaded()` in `store.server.ts`:

1. Reads `data/relay-room.json` if present and overlays `data/relay-secrets.json`. A missing room file yields an empty room.
2. Loads every `*.json` in `data/drivers/` into the driver library. Empty directories are seeded from bundled drivers.
3. Normalises the configuration (missing arrays, default grid, timezone).
4. Seeds room variables from declared defaults.
5. Starts a periodic timer that evaluates monitors, schedules, and triggers.

### 3.2 Operator action

1. The panel widget identifies a macro, a command, or a variable write.
2. The browser calls a server function in `actions.ts` (`fireMacro`, `fireCommand`, `setVariable`).
3. The handler checks the optional LAN-control policy and, where required, a session token.
4. `engine.ts` resolves the device instance, loads its driver, substitutes payload tokens, applies `valueMap`, and sends on the selected transport.
5. The reply is parsed according to the command or feedback `parse` object. Device state and optional bound variables are updated. A log line is appended.
6. Subsequent `/api/room` polls show the new values. The panel does not open sockets to the television or mixer itself.

### 3.3 Periodic work

Each timer tick:

| Stage | Behaviour |
|---|---|
| Monitors | For each enabled rule whose interval has elapsed, read feedback, optionally parse, write `writeVar`. On failure, optionally write `errorVar`. |
| Schedules | Compare host time (or configured timezone) and weekday with each enabled job. An empty day list means every day. Each job fires at most once per minute stamp. |
| Triggers | Compare a variable to a literal or another variable. Mode `change` fires on an edge; mode `interval` fires while the condition holds. After `delayMs` the condition is re-read before the macro runs. |

Macros invoked from any of these paths use the same runner as a panel press: ordered steps, per-step retry, then the step’s failure action (`retry`, another macro, or a page change).

---

## 4. Domain objects

| Object | Definition |
|---|---|
| Driver | Description of one product family. Contains transports, authentication metadata, probe, pacing, commands, feedback, inventory queries, and pairing. Contains no room-specific addresses. |
| Device instance | Binding of a driver to a host: IP and port, or a local interface id, plus `auth` fields (token, user, password, MIDI channel, baud). |
| Variable | Named room value (`string` or `number`) with optional min/max. Used for highlight, enable-when, sliders, monitors, and triggers. |
| Monitor | Periodic read of one feedback field into one variable. |
| Macro | Ordered list of steps (device command, delay, variable assignment, nested macro). |
| Page | Named grid. Widgets have column, row, width, height, colour, bindings, and enable-when clauses. |
| Widget | `button`, `toggle`, `slider`, `label`, `status`, or `schedule`. |
| Schedule | Clock time and weekday mask that starts a macro. |
| Trigger | Variable predicate that starts a macro. |
| Host interface | Local serial, GPIO, I2C, SPI, IR, or CEC endpoint discovered or entered on the Interfaces tab. |
| Host device | Instance of `relay-host.json`. Commands act on the panel process (dim, lock, toast, block, page, restart, update, variable and macro access). |

Drivers exist in two layers. The **library** is the set of JSON files on disk. The **room** references a subset by filename. Removing a driver from the room configuration does not delete the library file unless the integrator confirms deletion and the file is unused.

---

## 5. Transport engine

All wire formats that drivers may use are implemented in `engine.ts`. A driver must not assume JavaScript, persistent TCP sessions beyond a single command, or tokens that are not listed below.

### 5.1 LAN protocols

`tcp`, `udp`, `http`, `https`, `websocket`, `tls-websocket`, `pjlink`, `cast`, `wol`.

HTTP and HTTPS use the command’s method, path, headers, and body. WebSocket and TLS WebSocket open a short-lived socket, send the payload, and wait for a matching reply or timeout. Cast uses the Google Cast receiver/media namespaces. PJLink uses the documented projector login banner and `%1POWR` class commands. Wake-on-LAN sends a magic packet to the configured MAC address; it does not by itself confirm that the display has left standby.

### 5.2 Local protocols

Serial, GPIO, I2C, SPI, IR, and CEC are dispatched to host binaries (`gpioset`, `i2cset`, `cec-client`, `irsend`, and similar) or to a serial path selected on the device card. These paths exist only on the machine that has the hardware.

### 5.3 Encoding and substitution

Payload encoding is taken from, in order, the command `payloadEncoding`, the transport `payloadEncoding`, then the transport `encoding`. Values `hex` and `ascii` are defined. An odd number of hex digits is rejected. When the transport encoding is `hex`, received buffers are returned as a lowercase hex dump so parse needles such as `b02601` can match.

Substitution tokens recognised in payloads and paths:

| Token | Replacement |
|---|---|
| `{value}` | Command argument after `valueMap`. |
| `{value:hex2}` | Same value as two uppercase hex digits. |
| `{value:nrpn14}` | Same value as four hex digits (14-bit NRPN data bytes only, not a full MIDI message). |
| `{token}` | Device `auth.token`. |
| `{auth.FIELD}` | Named field from `device.auth`. |
| `{host}` `{port}` `{id}` | Instance address and inventory id. |
| `{name}` | Current value of room variable `name`. |
| `{midiChannel}` | Decimal 1–16 from the device card. MIDI status nibbles remain literal in the payload. |

`valueMap` maps the panel’s 0–100 (or declared) range onto the device range and type (`float`, `int`, `text`, `hexBytes`).

### 5.4 Probe, pair, pace

A probe with an empty payload succeeds if the TCP (or HTTP) endpoint accepts a connection. A `success` needle is applied only when the probe sends a payload. Pairing is a separate Authenticate action so that Allow dialogs are not opened by the reachability poll. `pacing.minIntervalMs` is applied between commands to the same device.

---

## 6. Operator and integrator surfaces

### 6.1 Panel (`control-panel.tsx`)

The panel renders the current page grid from the snapshot. Highlight and disable state are derived from variables, latch groups, or device feedback according to the widget binding. Keep-awake and fullscreen controls are shown only while those modes are inactive; they follow the browser Screen Wake Lock and Fullscreen APIs and reappear if the operating system drops the lock or exits fullscreen. A two-second hold on the settings control opens `/config`.

Host commands `ui.toast`, `ui.block`, `ui.unblock`, and `ui.clear` draw overlays on this surface. `display.dim` reduces brightness. `panel.lock` blocks operator input until the panel PIN succeeds. Configurator access remains available.

### 6.2 Configurator (`config-app.tsx`)

Tabs: Room, Security, Drivers, Devices, Interfaces, Pages, Macros, Logic (variables, monitors, schedules, triggers), Log.

Room actions: export, import, clear configuration, restart Vite, update from GitHub, reboot the host. There is no Restore demo. Export requires a configurator session and writes a JSON bundle with PINs and tokens removed. Import preserves existing secrets when the bundle left those fields empty.

---

## 7. Persistence

| Location | Contents |
|---|---|
| `data/relay-room.json` | Layout, IPs, variables, latches. No PINs or tokens. |
| `data/relay-secrets.json` | Config PIN, panel PIN, peer secret, device tokens, paired session secrets. |
| `data/drivers/*.json` | Driver library. |
| `data/relay-update.log` | Output of `scripts/update-relay.mjs`. |
| In-process memory | Device state, health, action log, monitor/schedule/trigger stamps. |

Save all calls `persistNow()`. If either JSON file cannot be written, the save returns failure and the dirty flag stays set (issue #18: the two files are still separate renames).

`system.update` (Room tab) requires a Git checkout. It runs `git pull --ff-only` and `npm install`, then relaunches Vite or, under systemd (`INVOCATION_ID` set), `systemctl restart relay`.

---

## 8. Access control

| Control | Effect |
|---|---|
| Configurator PIN | First login may use `1234`, then a stronger PIN is required. Editor writes need a config session. |
| Panel pairing | Open panel reuses one stored panel session. Panel PIN asks once; that browser stays trusted until Forget. |
| Open LAN control | Off by default. When on, `fireMacro` / `fireCommand` / `setVariable` accept calls with no token. |
| Peer HMAC | `x-relay-ts` + `x-relay-auth` (64 lowercase hex). Replay cache keys the digest for 90s. Peer secret only — not the PIN. Host restart/update/reboot use that same first check. |
| Export / import / update / reboot / ping | Configurator session required. |

Do not publish port 8081 to the public internet. HTTP only (issue #15).

---

## 9. Source files

### 9.1 Control plane

| File | Responsibility |
|---|---|
| `src/lib/control/types.ts` | TypeScript types for drivers, room configuration, widgets, snapshots, and logs. |
| `src/lib/control/engine.ts` | Transports, payload rendering, parse, inventory, pairing, host commands, process restart and update. |
| `src/lib/control/store.server.ts` | Process memory, file load/save, snapshot assembly, monitor/schedule/trigger timer. |
| `src/lib/control/actions.ts` | TanStack server functions used by the panel and configurator. |
| `src/lib/control/vars.ts` | Variable seeding, clamping, template substitution, enable-when evaluation. |
| `src/lib/control/schema.ts` | Driver validation and orphan bindings. |
| `src/lib/control/peer-auth.ts` | HMAC sign/verify and replay cache. |
| `src/lib/control/pins.ts` | Weak PIN list. |
| `src/lib/control/schedule.ts` | Next enabled schedule occurrence for the schedule widget. |
| `src/lib/control/defaults.ts` | Demonstration room and primary bundled drivers. |
| `src/lib/control/extra-drivers.ts` | Additional bundled drivers not required by the demonstration room. |
| `src/lib/control/client.ts` | Browser helper to load `/api/room`. |
| `src/lib/control/harness.ts` | Static driver inspection and optional live probe/command/feedback. |
| `scripts/driver-check.mjs` | Command-line entry for the harness. |

### 9.2 User interface and routes

| File | Responsibility |
|---|---|
| `src/components/panel/control-panel.tsx` | Operator grid, overlays, wake lock, fullscreen. |
| `src/components/panel/widget-face.tsx` | Visual treatment of tiles. |
| `src/components/config/config-app.tsx` | Integrator editor. |
| `src/components/ui/button.tsx` | Shared button styles. |
| `src/routes/index.tsx` | Route `/`. |
| `src/routes/config.tsx` | Route `/config`. |
| `src/routes/api/room.ts` | Snapshot HTTP handler. |
| `src/routes/api/peer.ts` | Relay-to-Relay HMAC API. |
| `src/routes/api/ping.ts` | Reachability helper used by the device card. |
| `src/routes/api/vars.ts` | Variable listing used by the host inventory path. |
| `src/routes/__root.tsx` | HTML shell, fonts, application metadata. |
| `src/styles.css` | Panel and editor styling. |
| `src/router.tsx` | TanStack router entry. |

### 9.3 Installation and documentation

| File | Responsibility |
|---|---|
| `scripts/update-relay.mjs` | Git pull, dependency install, relaunch. |
| `LINUX.md` | Debian / Raspberry Pi packages, systemd unit, update procedure. |
| `WINDOWS.md` | Windows install and update procedure. |
| `DRIVER-PROMPT.md` | Instructions for generating a driver JSON without this source tree. |
| `CHANGELOG.md` | Notable changes. |
| `KNOWN_ISSUES.md` | Current limitations. |
| `ARCHITECTURE.md` | Process model, data path, source map. |
| `README.md` | Orientation and disclaimer. |
| `LICENSE`, `NOTICE`, `PRIVACY.md`, `SECURITY.md` | Licence, attributions, data handling, and stated security properties. |

### 9.4 On-disk data after install

| Path | Responsibility |
|---|---|
| `data/relay-room.json` | Layout, IPs, variables. No PINs or pairing tokens. |
| `data/relay-secrets.json` | Config PIN, panel PIN, peer secret, device tokens, paired sessions. |
| `data/drivers/` | Library of driver files. |
| `public/drivers/` | Optional static copies of a subset of drivers. |

### 9.5 Remaining template code

The development server still loads PGLite bootstrap, an environment plugin, and a PWA plugin. Those modules start Vite. They do not send device commands.

Better Auth, app-data, multiplayer, and the preview-host bridge have been removed. `src/routes/__root.tsx` no longer mounts a preview bridge.

### 9.6 Driver harness

A driver JSON can be checked without opening the configurator:

```
npm run driver:check -- data/drivers/samsung-qe50q65t.json
npm run driver:check -- data/drivers/file.json --host 10.0.0.20 --command power.on --feedback power.state
```

Static mode validates manufacturer/model, command ids, parse types, and substitution tokens. With `--host` it opens a TCP connection to the advertised port. Full command execution remains in the running application.

---

## 10. Extension procedures

**Additional product.** Produce a JSON file named `{manufacturer}-{model}.json` using DRIVER-PROMPT.md. Load it on the Drivers tab, create a device instance, complete Authenticate if the driver declares pairing, confirm Probe, then bind macros and monitors only to the commands required in that room.

**Additional operator control.** Add a widget on the Pages tab and point it at an existing macro or variable. Use a latch group when several buttons represent a single exclusive mode.

**Additional room behaviour without a new driver.** Compose macros, variables, monitors, and triggers. Use `relay-host.json` for panel-side effects.

**Engine change versus driver change.** A capability needed by many products (hex receive, Wake-on-LAN, inter-command pacing) belongs in `engine.ts` and must be reflected in DRIVER-PROMPT.md. A quirk of one model belongs only in that model’s JSON.

---

## 11. Constraints

- One Relay process owns one room configuration. Multiple operator browsers may attach to that process.
- TCP commands open, write, and close. The engine does not keep a MIDI or proprietary session open between calls.
- Serial, GPIO, I2C, IR, and CEC require the corresponding hardware and host packages on the machine that runs Relay.
- Fullscreen and wake lock depend on the browser. Some mobile browsers only hide chrome when the panel is installed as a home-screen application.
- Demonstration configuration and default PIN `1234` are unsuitable for a production room until changed.
- The implementation is AI-generated and has not been independently audited. Liability terms are stated in README.md.
