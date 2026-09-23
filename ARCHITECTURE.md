# Relay architecture

Relay **0.9.52** (beta). Technical overview of the room-control application: process model, data objects, execution path from the operator surface to a device transport, persistence, and the source files that implement each layer.

This document describes the software in this repository. It is not a substitute for manufacturer protocol manuals. Driver syntax is specified separately in [DRIVER-PROMPT.md](DRIVER-PROMPT.md). Legal and operational notices are in [NOTICE](NOTICE), [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md).

---

## 1. Purpose and scope

Relay is a single-process, LAN-hosted controller for audiovisual and related equipment. An integrator describes each product as a JSON driver (ports, payloads, authentication, parse rules). The operator sees only a grid of buttons and sliders bound to those capabilities.

The application is intended to run on a machine that remains on the same private network as the devices. The locked production host is Ubuntu Server with two NICs (AV-LAN for device I/O, internet NIC for outbound update). Windows and Raspberry Pi still run. Foyer room signage is an optional second process on this PC — communication is [`FOYER-RELAY.md`](FOYER-RELAY.md), not part of this package. Device protocols implemented by third parties are used without affiliation; see NOTICE.

The repository also contains Vite / TanStack Start scaffolding used to boot the HTTP server. Device I/O is only in `src/lib/control/`, `src/components/panel/`, `src/components/config/`, and `src/routes/`.

---

Optional **local HDMI panel kiosk** (`relay-kiosk.service`): cage + Chromium on tty1 opens the AV-LAN panel root URL written to `data/relay-kiosk.env`. Does not change the HTTP listen bind.

**Same-host dual display with Foyer:** prefer **panel via Foyer** — Foyer’s `foyer-kiosk` (sway) owns Welcome and/or Room panel heads; Relay only serves AV-LAN HTTP. Leave `relay-kiosk` disabled/off so two compositors do not fight tty1 / DRM ([`LINUX.md`](LINUX.md) §7a). Relay-only HDMI kiosk remains available when Foyer is not driving a Room panel head ([`LINUX.md`](LINUX.md) §7b–§7c).

## 2. Process model

One Node.js process serves three surfaces:

| Path | Audience | Function |
|---|---|---|
| `/` | Operator | Control panel. Polls `/api/room` and invokes server functions to run macros, set variables, and send single commands. |
| `/config` | Integrator | PIN-protected editor for room, devices, pages, macros, logic, drivers, interfaces, and the action log. |
| `/api/room` | Both | JSON snapshot of configuration, variables, device state, health, traces, and recent log lines. |

There is no separate device-gateway process. Device I/O is opened from `src/lib/control/` inside the same process. Callers import the public façades `engine.ts` and `actions.ts` only. `engine.ts` is slim orchestration (pairing, inventory, monitors, macros, `executeCommand`); wire I/O lives in `engine-wire.ts`, LAN dispatch in `engine-lan.ts`, local/host plane in `engine-host.ts`. LAN allow-list and traces live in `engine-policy.ts`; payload tokens and reply parse live in `engine-payload.ts`. Policy/payload/wire/lan/host leaves must not import `engine.ts`. Panel/config RPCs are split under `actions-*.ts` with `actions.ts` as the barrel and `actions-context.ts` (`loadControl`) shared by those handlers.

A second browser (wall tablet and desk tablet) may attach to the same origin. Both share one configuration and one variable store. Tablets belong on AV-LAN.

HTTP listen is the **AV-LAN IPv4** only (dev `:8080`, production `:8081`) — never `0.0.0.0`. Resolution: `RELAY_LISTEN_HOST` if set; else AV pick → IPv4; AV unset/invalid → **auto-map first scanned NIC** (physical before docker/veth/bridges; persist into room config); mapped/saved iface without IPv4 → refuse + wait/retry at boot; no scanned NICs → `127.0.0.1` + warning. Outbound / NIC2 None or down does not change AV listen. ufw still limits clients to the AV CIDR. Optional file HTTPS on the venue NIC is **B1** (shipped); HMAC peer over that HTTPS is **B3**; per-device `nicFace` bind is **B4**. Phase B software checkpoint is **B5** (`v0.9.45`). **Let’s Encrypt / ACME / DNS-01 is PARKED** (not the product path). **Shipped C1–C3:** in-box Generate venue CA + leaf + Networks UI / CA download / regenerate lifecycle; **C4** docs checkpoint at `v0.9.46`. See section 8 and [`SECURITY.md` Venue TLS inventory](SECURITY.md#venue-tls-inventory-c0).

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
   (memory, disk, clocks)     (orchestration façade)
          │                   ├── engine-wire.ts   (TCP / pace / encode)
          │                   ├── engine-lan.ts    (LAN protocols)
          │                   ├── engine-host.ts   (local / host plane)
          │                   ├── engine-policy.ts (RFC1918, scrub, traces)
          │                   └── engine-payload.ts (tokens, parse)
          │
          │              actions.ts (RPC barrel)
          │                   ├── actions-auth / config / runtime / host
          │                   └── actions-context.ts (loadControl)
          ▼                        ▼
   data/relay-room.json      LAN / serial / GPIO
   data/relay-secrets.json   PINs and device tokens
   data/library/*.json        Stock driver specs (search / Add)
   data/drivers/*.json        This room’s working-set copies
```

---

## 3. Execution path

### 3.1 Start-up

`ensureLoaded()` in `store.server.ts`:

1. Reads `data/relay-room.json` if present and overlays `data/relay-secrets.json`. A missing room file yields an empty room.
2. Loads `data/library/index.json` for Drivers-tab search. Loads `data/drivers/*.json` into the room working set. An empty room folder is seeded with `relay-host.json` only. Add copies one library spec into the room folder; Remove unlinks that copy.
3. Normalises the configuration (missing arrays, default grid, timezone).
4. Seeds room variables from declared defaults.
5. Starts a periodic timer that evaluates monitors, schedules, and triggers.

### 3.2 Operator action

1. The panel widget identifies a macro, a command, or a variable write.
2. The browser calls a server function re-exported from `actions.ts` (`fireMacro`, `fireCommand`, `setVariable` live in `actions-runtime.ts`).
3. The handler checks the optional LAN-control policy and, where required, a session token (`validToken` / `mint` via `loadControl()` → `session.server.ts`).
4. `executeCommand` in `engine.ts` resolves the device instance and loads its driver. `engine-payload.ts` substitutes payload tokens and applies `valueMap`. Dispatch then goes to `sendLan` (`engine-lan.ts`), `sendLocal` / host commands (`engine-host.ts`), with TCP/pace helpers in `engine-wire.ts`.
5. The reply is parsed in `engine-payload.ts` according to the command or feedback `parse` object. Device state and optional bound variables are updated. A log line is appended.
6. Subsequent `/api/room` polls show the new values. The panel does not open sockets to the television or mixer itself.

### 3.3 Periodic work

Each timer tick:

| Stage | Behaviour |
|---|---|
| Monitors | For each enabled rule whose interval has elapsed, read feedback, optionally parse, write `writeVar`. On failure, optionally write `errorVar`. |
| Schedules | Compare host time (or configured timezone) and weekday with each enabled job. An empty day list **skips** the job. Each job fires at most once per minute stamp. |
| Triggers | Primary predicate plus optional `whenTrue` / `whenFalse` extra clauses. Mode `change` fires on an edge; mode `interval` may re-fire. After `delaySec` the condition is re-read before the macro runs. |

Macros invoked from any of these paths use the same runner as a panel press: ordered steps, per-step retry, then the step’s failure action (`retry`, another macro, or a page change).

---

## 4. Domain objects

| Object | Definition |
|---|---|
| Driver | Description of one product family. Contains transports, authentication metadata, probe, pacing, commands, feedback, inventory queries, and pairing. Contains no room-specific addresses. |
| Device instance | Binding of a driver to a host: IP and port, or a local interface id, plus `auth` fields (token, user, password, MIDI channel, baud). |
| Variable | Named room value (`string` or `number`) with optional min/max. Used for highlight, enable-when, sliders, monitors, and triggers. |
| Macro | Ordered list of steps (device command, delay, variable assignment, nested macro). Id `none` is a hidden no-op; new buttons bind to it. |
| Monitor | Periodic read of one feedback field. Always writes `MON_<label>`; optional extra `writeVar` / `errorVar`. |
| Page | Named grid. Widgets have column, row, width, height, colour, bindings, and enable-when clauses. |
| Widget | `button`, `slider`, `label`, `status`, `schedule`, or `preview`. Icons sit on the right, sized from tile height. |
| Schedule | Clock time and weekday mask that starts a macro. |
| Trigger | Primary predicate plus optional `whenTrue` / `whenFalse` extra clauses that start a macro. |
| Host interface | Local serial, GPIO, I2C, SPI, IR, CEC, or a gateway box (e.g. IPL T SFI244) that maps slots to TCP ports. |
| Host device | Instance of `relay-host.json`. Commands act on the panel process (dim, lock, toast, block, page, restart, update, variable and macro access). |

Drivers exist in two layers. The **library** is the set of JSON files on disk. The **room** references a subset by filename. Removing a driver from the room configuration does not delete the library file unless the integrator confirms deletion and the file is unused.

---

## 5. Transport engine

Callers import `src/lib/control/engine.ts`. That façade orchestrates pairing, inventory fetch, monitors, macros, and `executeCommand`. Transport leaves own the sockets. A driver must not assume JavaScript, persistent TCP sessions beyond a single command (KNOWN_ISSUES #4), or tokens that are not listed below.

| Module | Owns |
|---|---|
| `engine.ts` | Orchestration façade: pairing, inventory, monitors, macros, `executeCommand`. Re-exports selected leaf APIs. |
| `engine-wire.ts` | Wire encode/decode (`encodeWire`), TCP connect-write-close / session write, pacing (`paceDevice`), TCP pool. |
| `engine-lan.ts` | `sendLan`, `sendHttp`, and LAN protocol adapters (UDP, WS, Cast, PJLink, WOL, OSC, sACN, MIDI variants). |
| `engine-host.ts` | `sendLocal`, `applyHost`, host feedback, `listHostInterfaces` (serial / GPIO / local tools). |
| `engine-policy.ts` | RFC1918 (plus optional loopback) host allow, `scrubSecret` (via `isSecretKey`), traces (`__relayTraces__`), `sleep`. Re-exported from the barrel. |
| `engine-payload.ts` | `{value}` / `{auth.*}` substitution, `valueMap`, `requires` guard, simulated state, `parseFeedback`, inventory JSON parse. Not re-exported. |

### 5.1 LAN protocols

`tcp`, `udp`, `http`, `https`, `websocket`, `tls-websocket`, `pjlink`, `cast`, `wol`, `osc`, `sacn`, `ipmidi`, `rtp-midi`.

HTTP and HTTPS use the command’s method, path, headers, and body. `httpMethod` `RPC` runs Windows remote shutdown (`shutdown /s /m` on Windows, `net rpc shutdown` on Linux). WebSocket and TLS WebSocket open a short-lived socket, send the payload, and wait for a matching reply or timeout. Cast keeps a TLS session: receiver GET_STATUS, CONNECT to the app transport, media GET_STATUS, then PLAY/PAUSE/STOP with the live `mediaSessionId`. PJLink uses the documented projector login banner and `%1POWR` class commands. Wake-on-LAN sends a magic packet to the configured MAC (ports 7 and 9); it does not confirm the target left standby. Empty WOL commands do not follow with HTTP. OSC encodes the payload as a UDP path plus optional `osc.types` / `osc.values`. sACN is E1.31 multicast `239.255.0.{universe}:5568` TTL 1. ipMIDI is raw MIDI hex on UDP multicast `225.0.0.37:21928` TTL 1. RTP-MIDI is a unicast AppleMIDI session (control 5004, data 5005); no Bonjour.

### 5.2 Local protocols

Serial, GPIO, I2C, SPI, IR, CEC, and USB MIDI are dispatched to host binaries (`gpioset`, `i2cset`, `cec-client`, `irsend`, `amidi`, and similar) or to a serial path selected on the device card. These paths exist only on the machine that has the hardware.

### 5.3 Encoding and substitution

Payload encoding is taken from, in order, the command `payloadEncoding`, the transport `payloadEncoding`, then the transport `encoding`. Values `hex` and `ascii` are defined. An odd number of hex digits is rejected. When the transport encoding is `hex`, received buffers are returned as a lowercase hex dump so parse needles such as `b02601` can match. Encoding of the wire bytes is in `engine-wire.ts` (`encodeWire`). Token substitution is `renderPayload` in `engine-payload.ts`.

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

### 6.2 Configurator (`src/components/config/`)

Shell: `config-app.tsx` (PIN, Save all, toast, `draft`, tab bar). Tabs: Room, Security, Drivers, Devices, Interfaces, Macros, Logic, Pages, Log. Logic sub-tabs: variables, monitors, schedules, triggers. Trigger panes (`trigger-pane.tsx`): If / and / on-change-or-interval / one macro. Occupancy is the baked var `0`–`3` (closed / open / in session / DND); there is no Room-tab occupancy dropdown. **Save all** keeps live occupancy (it does not write `draft.room.occupancy`). Foyer GET still reads the string `occupancy` field.

Room actions: export (browser download, secrets stripped), import, clear configuration, restart Vite, update from GitHub, reboot the host. **Apply AV-LAN IPv4** (Linux / nmcli, config PIN): static or DHCP on the AV pick only → strip gateway + never-default → persist `room.network` → restart Relay to re-bind listen (never `0.0.0.0`). Room tab shows `package.json` version plus `git rev-parse --short HEAD`. There is no Restore demo. Clear configuration leaves occupancy and one `relay-host.json` device on localhost. Export requires a configurator session. Import preserves existing secrets when the bundle left those fields empty.

---

## 7. Persistence

| Location | Contents |
|---|---|
| `data/relay-room.json` | Layout, IPs, variables, latches. No PINs or tokens. |
| `data/relay-secrets.json` | Config PIN, panel PIN, peer secret, device tokens, paired session secrets. |
| `data/library/*.json` | Stock driver library (git). `index.json` is search cards only. |
| `data/drivers/*.json` | This room’s working-set copies (not git). |
| `data/relay-update.log` | Output of `scripts/update-relay.mjs`. |
| In-process memory | Device state, health, action log, monitor/schedule/trigger stamps. |

Save all calls `persistNow()`. Secrets and room JSON are written through a journal (`*.transaction`) then atomic rename (`scripts/write-atomic.mjs`). If the second file fails, the previous pair is left intact and persist returns failure. A kill during apply is recovered from the journal on the next boot.

`system.update` (Room tab) requires a Git checkout. It fetches `origin` with `--force --tags`, builds and readiness-checks a detached worktree, then `git checkout -B main <sha>` and swaps `node_modules` / `.vercel`. A failed stage leaves the running checkout untouched. Nitro writes `.vercel/output`, not `dist/`. Log: `data/relay-update.log`.

---

## 8. Access control

| Control | Effect |
|---|---|
| Configurator PIN | First login may use `1234`, then a stronger PIN is required. Editor writes need a config session. |
| Panel pairing | Open panel reuses one stored panel session. Panel PIN asks once; that browser stays trusted until Forget. |
| Open LAN control | Off by default. When on, `fireMacro` / `fireCommand` / `setVariable` accept calls with no token. |
| Peer HMAC | `x-relay-ts` + `x-relay-auth` (64 lowercase hex). Replay cache keys the digest for 90s. Peer secret only — not the PIN. Host restart/update/reboot use that same first check. |
| Export / import / update / reboot / ping | Configurator session required. |

Do not publish port 8081 to venue/WAN. No IP forward/bridge between AV and venue NICs. **Wire split:** cleartext HTTP on AV-LAN only; optional file HTTPS on venue (B1) + HMAC peer over that HTTPS (B3) + per-device `nicFace` bind (B4). Venue **peers** use **strict TLS verify** against a trusted peer CA (`peerTrustedCaPath`; fail-closed if missing). Third-party **device** HTTPS / tls-websocket use per-device CA or sha256 pin (`deviceTrustedCaPath` / `tlsFingerprintSha256`; venue fail-closed if missing). Soft `rejectUnauthorized: false` is not a venue happy path (AV Cast exception only). Manual `scripts/samsung-pair.mjs` is fail-closed on 8002 unless `--ca` / `--fingerprint` (or `--insecure` discover). LE/ACME/FQDN **parked**. B5 / C4 / peer TLS `v0.9.47` / device TLS `v0.9.48` / samsung-pair `v0.9.49`. Generate / venue TLS / peer or device CA failures must not make AV depend on venue certs.

---

## 9. Source files

### 9.1 Control plane

| File | Responsibility |
|---|---|
| `src/lib/control/types.ts` | TypeScript types for drivers, room configuration, widgets, snapshots, and logs. |
| `src/lib/control/engine.ts` | Orchestration façade. Pairing, inventory, monitors, macros, `executeCommand`. Callers import this file. |
| `src/lib/control/engine-wire.ts` | TCP / pace / wire encode-decode. |
| `src/lib/control/engine-lan.ts` | LAN protocol dispatch (`sendLan`, `sendHttp`). |
| `src/lib/control/engine-host.ts` | Local interfaces and host commands (`sendLocal`, `applyHost`). |
| `src/lib/control/engine-policy.ts` | RFC1918 host allow, secret scrub (`scrubSecret` ↔ `isSecretKey`), traces, sleep. |
| `src/lib/control/engine-payload.ts` | Payload tokens, `valueMap`, requires-guard, simulated state, parse, inventory JSON parse. |
| `src/lib/control/store.server.ts` | Process memory, file load/save, snapshot assembly, monitor/schedule/trigger timer. |
| `src/lib/control/actions.ts` | Barrel of TanStack server functions used by the panel and configurator. |
| `src/lib/control/actions-auth.ts` | PIN verify, session revoke. |
| `src/lib/control/actions-config.ts` | Editor load/save/import/clear/driver library. |
| `src/lib/control/actions-runtime.ts` | `fireMacro` / `fireCommand` / `setVariable` and related runtime RPCs. |
| `src/lib/control/actions-host.ts` | Host restart/update/reboot, Apply AV-LAN IP (nmcli), NIC/port list, debug. |
| `src/lib/control/nics.ts` | NIC list, AV/outbound pick helpers, outbound None (A1), re-exports listen host. |
| `scripts/http-listen-host.mjs` | Pure AV → HTTP listen host (A2). Never returns `0.0.0.0`. |
| `scripts/control-base-url.mjs` | Advertised panel / Foyer Relay base URL from live AV IPv4 (same auto-map as listen); soft-fail if no NICs / no IPv4. |
| `scripts/https-venue-listen.mjs` | B1 optional HTTPS listen on outbound/venue IPv4 (file PEMs; soft-skip). |
| `src/lib/control/peer-venue.ts` | B3 HMAC peer AV HTTP vs venue HTTPS planner (`peerFace`) + strict trusted peer CA. |
| `src/lib/control/device-face.ts` | B4 per-device `nicFace` bind planner (AV vs venue; cleartext gate). |
| `src/lib/control/actions-context.ts` | Shared `loadControl()` → `session.server`. |
| `src/lib/control/vars.ts` | Variable seeding, clamping, template substitution, enable-when evaluation. |
| `src/lib/control/schema.ts` | Driver validation and orphan bindings. |
| `src/lib/control/peer-auth.ts` | HMAC sign/verify, replay cache, loopback GET. |
| `src/lib/control/peer-payload.ts` | Occupancy field (Foyer strings), baked `occupancy` var `0`–`3`, `GET /api/peer` body. |
| `src/lib/control/foyer-peer.ts` | Loopback poll of Foyer session into `foyer.*` vars. See [`FOYER-RELAY.md`](FOYER-RELAY.md). |
| `src/lib/control/pins.ts` | Weak PIN list. |
| `src/lib/control/schedule.ts` | Next enabled schedule occurrence for the schedule widget. |
| `src/lib/control/defaults.ts` | Empty room (Relay host) and last-resort `relay-host.json`. |
| `scripts/driver-check.mjs` | Offline driver JSON check (static; optional TCP probe with `--host`). |

### 9.2 User interface and routes

| File | Responsibility |
|---|---|
| `src/components/panel/control-panel.tsx` | Operator grid, overlays, wake lock, fullscreen. |
| `src/components/panel/preview-tile.tsx` | Optional 720p RTSP preview (`<video>` + MSE). |
| `src/lib/control/preview-grab.ts` | Preview URL allowlist + ffmpeg H.264 remux to fMP4. |
| `src/routes/api/preview.ts` | `GET /api/preview?widget=` streams fMP4 (panel/config session). |
| `src/components/panel/widget-face.tsx` | Visual treatment of tiles. |
| `src/components/config/config-app.tsx` | Configurator shell: PIN, Save all, draft, tab switch. |
| `src/components/config/*-tab.tsx` | One file per tab (room, security, devices, interfaces, macros, logic, drivers, log). |
| `src/components/config/trigger-pane.tsx` | Logic → Triggers panes. Engine still evaluates leftover false-path / hold fields if an old room has them. |
| `src/components/config/pages-editor.tsx` | Panel page grid editor. |
| `src/components/config/tag-bar.tsx` | Tag chips for macros and logic. |
| `src/components/config/config-ui.ts` | Shared field chrome. |
| `src/components/ui/button.tsx` | Shared button styles. |
| `src/routes/index.tsx` | Route `/`. |
| `src/routes/config.tsx` | Route `/config`. |
| `src/routes/api/room.ts` | Snapshot HTTP handler. |
| `src/routes/api/peer.ts` | Occupancy GET for Foyer; HMAC POST macros for Relay-to-Relay. Foyer wire: [`FOYER-RELAY.md`](FOYER-RELAY.md). |
| `src/routes/api/ping.ts` | Reachability helper used by the device card. |
| `src/routes/api/vars.ts` | Variable listing used by the host inventory path. |
| `src/routes/__root.tsx` | HTML shell, fonts, application metadata. |
| `src/styles.css` | Panel and editor styling. |
| `src/router.tsx` | TanStack router entry. |

### 9.3 Installation and documentation

| File | Responsibility |
|---|---|
| `scripts/update-relay.mjs` | Git pull, dependency install, relaunch. |
| `LINUX.md` | Debian / Raspberry Pi packages, dual-NIC checklist, B1 PEM drop + Generate / Networks UI / lifecycle notes, systemd unit, update procedure. |
| `SECURITY.md` | Dual-NIC trust model + [Venue TLS inventory (C0)](SECURITY.md#venue-tls-inventory-c0) (Shipped C0–C4 vs PARKED LE vs residuals). |
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
| `data/library/` | Stock driver specs and `index.json`. |
| `data/drivers/` | This room’s working-set copies. |

### 9.5 Remaining template code

The Vite config still ships an environment plugin, a PWA plugin, and a PGLite bootstrap hook. The PGLite hook **skips** when `migrations/` is empty or missing. Those modules start Vite. They do not send device commands.

Better Auth, app-data, multiplayer, and the preview-host bridge have been removed. `src/routes/__root.tsx` no longer mounts a preview bridge.

### 9.6 Driver check

A driver JSON can be checked without opening the configurator:

```
npm run driver:check -- data/library/samsung-qe50q65t.json
npm run driver:check -- data/library/file.json --host 10.0.0.20 --command power.on --feedback power.state
```

Static mode validates manufacturer/model, command ids, parse types, and substitution tokens. With `--host` it opens a TCP connection to the advertised port. Full command execution remains in the running application.

---

## 10. Extension procedures

**Additional product.** Produce a JSON file named `{manufacturer}-{model}.json` using DRIVER-PROMPT.md. Load it on the Drivers tab, create a device instance, complete Authenticate if the driver declares pairing, confirm Probe, then bind macros and monitors only to the commands required in that room.

**Additional operator control.** Add a widget on the Pages tab and point it at an existing macro or variable. Use a latch group when several buttons represent a single exclusive mode.

**Additional room behaviour without a new driver.** Compose macros, variables, monitors, and triggers. Use `relay-host.json` for panel-side effects.

**Engine change versus driver change.** A capability needed by many products (hex receive, Wake-on-LAN, inter-command pacing) belongs in the engine and must be reflected in DRIVER-PROMPT.md: pacing/wire in `engine-wire.ts`, LAN transports in `engine-lan.ts`, local/host in `engine-host.ts`, substitution tokens and parse types in `engine-payload.ts`. A quirk of one model belongs only in that model’s JSON.

---

## 11. Constraints

- One Relay process owns one room configuration. Multiple operator browsers may attach to that process.
- TCP commands open, write, and close. The engine does not keep a MIDI or proprietary session open between calls.
- Serial, GPIO, I2C, IR, and CEC require the corresponding hardware and host packages on the machine that runs Relay.
- Fullscreen and wake lock depend on the browser. Some mobile browsers only hide chrome when the panel is installed as a home-screen application.
- Demonstration configuration and default PIN `1234` are unsuitable for a production room until changed.
- The implementation is AI-generated and has not been independently audited. Liability terms are stated in README.md.
