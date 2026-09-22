# Changelog

Format: date, then bullets. Older work lives in `git log`.

## 0.9.38 — 2026-09-22

- Tag `v0.9.38`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Control plane Track B: engine split into wire/LAN/host leaves (#62–#64); slim orchestration façade (#65). No behaviour change.

## 0.9.37 — 2026-09-22

- Tag `v0.9.37`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Control plane Track A: shared `loadControl()` (#59); `actions` split into auth/config/runtime/host modules with a barrel façade (#60). No behaviour change.

## 0.9.36 — 2026-09-22

- Tag `v0.9.36`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Security hardening pass (backend foot-guns): expired config sessions rejected on `/api/ping`; durable weak-PIN force-change; unlock routes share `mint()`; `scrubSecret` aligned with `isSecretKey`; `/api/room` uses shared `validToken`; corrupt secrets JSON fails closed; `/api/vars` requires peer HMAC when a key is set; timing-safe plaintext PIN compare on the legacy path.

## 0.9.35 — 2026-09-22

- Tag `v0.9.35`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: Biamp Nexia PM (NTP Telnet :23). Mic 1–4, line 1–6, out 1–6, preset recall. Tag blocks MicIn / LineIn / LineOut in Nexia.
- Library: Nexia PM expanded — 4 mic + 12 stereo-line (six RCA pairs) + 6 out, all NTP GETD/SET (gain, level, mute, phantom, invert, gang, output FS). Preset recall 1001–1040. System GET IP/MAC/DEVID. Line count was 6 (hardware is 12). Destructive CLEAR/RESET/IP SET omitted. Re-apply the driver from the library on rooms that already have a Nexia copy.

## 0.9.34 — 2026-09-20

- Tag `v0.9.34`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: Mitsubishi UD8900U PJLink Class 1 (TCP 4352). Inputs Computer 1/2, Video, S-Video, HDMI, DVI, SDI. Default password `admin`.

## 0.9.33 — 2026-09-20

- Tag `v0.9.33`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider: drag on the whole tile again (capsule was the only hit target). Fill meets the knob centre, not the far edge. Pointer-only — no touch handlers fighting Chrome.

## 0.9.32 — 2026-09-20

- Tag `v0.9.32`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- MPS 602 library: Mic volume (`16*{n}G`, 0–60 dB), mute/unmute mic (`1M` / `0M`), plus poll `16G` / `M`. Program `{n}V` / `Z` unchanged. Re-apply the driver from the library on rooms that already have an MPS copy.

## 0.9.31 — 2026-09-20

- Tag `v0.9.31`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider knob is the same size as the bar. 0 / max are when the knob edges meet the capsule ends.

## 0.9.30 — 2026-09-20

- Tag `v0.9.30`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider Direction default Auto: upright when the tile is taller than wide. Horizontal / Upright still lock.

## 0.9.29 — 2026-09-20

- Tag `v0.9.29`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Capsule slider: fill via flex (no `%` calc), knob not clipped by `overflow`, touch handlers for Android Chrome.

## 0.9.28 — 2026-09-20

- Tag `v0.9.28`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider is a capsule bar: widget-colour fill, dark remainder, white knob. Inset on the tile; knob stays inside the pill at 0 and max. Upright is the same capsule stood on end.

## 0.9.27 — 2026-09-20

- Tag `v0.9.27`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider is a thin bar + small dot, with a hairline that travels across the tile. Travel stays inset (~22px) so 0 and max are not on the edge.

## 0.9.26 — 2026-09-20

- Tag `v0.9.26`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Landscape panel uses the full window width (dropped `max-w-3xl` gutters).

## 0.9.25 — 2026-09-20

- Tag `v0.9.25`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider tiles: filled track in the widget colour, round knob. Pages inspector **Direction**: Horizontal or Upright (mixer fader). Old rooms stay horizontal.

## 0.9.24 — 2026-09-20

- Tag `v0.9.24`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview label chip hugs the text (it was stretching the full tile height).

## 0.9.23 — 2026-09-20

- Tag `v0.9.23`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Hide scrollbars (still scroll with wheel / trackpad / touch).

## 0.9.22 — 2026-09-20

- Tag `v0.9.22`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Pages inspector: Preview fields sit in a Stream box at the top of the side panel (sticky, scrollable). Header shows `Configurator · 0.9.22` so a stale Config tab is obvious.

## 0.9.21 — 2026-09-20

- Tag `v0.9.21`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview tile settings: RTSP transport (auto / UDP / TCP), behind-live seconds (default 1.2, match I-frame interval), fit vs fill. Still copy remux. Old rooms keep the previous defaults.

## 0.9.20 — 2026-09-20

- Tag `v0.9.20`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Panel face follows the window (`innerHeight > innerWidth`), not CSS `orientation` — iPad was showing the landscape page in portrait and the reverse.

## 0.9.19 — 2026-09-20

- Tag `v0.9.19`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: restart ffmpeg when the picture stalls (no first frame in 15 s, or no progress for 5 s) or the decoder errors. Changing ZowieBox stream settings used to leave the old RTSP session running (black / stuck).

## 0.9.18 — 2026-09-20

- Tag `v0.9.18`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview black screen on ZowieBox Main Profile / I-frame 30: tile was seeking 120 ms behind live (mid-GOP). Catch-up is now 1.2 s behind, and only if more than 2.5 s late. SourceBuffer codec is read from `avcC`. SPS/PPS repeated on keyframes (`dump_extra`). Copy remux kept.

## 0.9.17 — 2026-09-20

- Tag `v0.9.17`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: drop the 0.9.16 `libx264` ultrafast encode. Back to `-c:v copy` plus the 0.9.15 probe/muxdelay/120 ms tile buffer.

## 0.9.16 — 2026-09-20

- Tag `v0.9.16`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: if `libx264` is present, remux is now `ultrafast` / `zerolatency` / GOP 10 (~0.3 s at 30 fps) at 1.2 Mbps. Copy if that encoder is missing. Tile keeps ~80 ms. Still four streams max. i3 + LAN has the CPU; this is the remaining delay that copy could not cut.

## 0.9.15 — 2026-09-20

- Tag `v0.9.15`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview latency: smaller ffmpeg probe (`32 KiB` / `0.5 s`), `muxdelay 0`, flush each packet. Tile keeps ~120 ms of MSE buffer instead of 2 s. Copy remux still waits on the next keyframe (GOP), no extra encode.

## 0.9.14 — 2026-09-20

- Tag `v0.9.14`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: drop `-localaddr` unless that ffmpeg lists it, drop `separate_moof` / `reset_timestamps` / `-nostdin` (those were `ffmpeg flags` on the Pi). Tile lists steps: url, ffmpeg version, encoder host:port open/closed, each UDP/TCP try with the rejected option name.

## 0.9.13 — 2026-09-20

- Tag `v0.9.13`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: bound ZowieBox uses `rtsp://IP:554/sub/av` (the box’s own URL), not :8554. ffmpeg drops `prefer_tcp` / `allowed_media_types` (those printed `ffmpeg flags` on the Pi). Tries UDP then TCP with `-rtsp_transport` only.

## 0.9.12 — 2026-09-20

- Tag `v0.9.12`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: RTSP uses `prefer_tcp` (UDP fallback) instead of TCP-only — VLC-ok streams on `:554` that do not interleave RTP over TCP were showing `no signal`. Tile SourceBuffer codec is High-profile first so Main/High H.264 paints. Routed RFC1918 no longer pins the wrong NIC for 4s.

## 0.9.11 — 2026-09-20

- Tag `v0.9.11`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Each UI page has a landscape grid and an optional portrait grid. Same widgets (bind, label, preview URL). Portrait cell is `widget.portrait`; missing = hidden on that face. Old rooms without `portraitGrid` still show landscape on a phone. Pages editor: Landscape / Portrait toggle, Copy from landscape.

## 0.9.10 — 2026-09-17

- Tag `v0.9.10`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: `zowietek-zowiebox.json` (HTTP :80 ZowieAPI). Encoder control, internet publish 0–3, record USB/SD/NAS, tally, HDMI output presets, digital zoom, PTZ on an attached camera. Local RTSP is not toggled. Encode bitrate POST omitted (it replaces the whole venc blob).
- Optional Preview widget: host `ffmpeg` remuxes RTSP (ZowieBox `rtsp://IP:8554/sub/av`, 720p H.264, `-c:v copy`) to fMP4 for a panel `<video>` tile. No extra npm. Missing ffmpeg shows `ffmpeg?`. Cap four streams. Drop the files listed at the top of `src/lib/control/preview-grab.ts` to remove it. No ffmpeg timeout flag (those differ by version and yielded 0 bytes). Wait for the first remux byte before HTTP 200. Tile shows the API error (e.g. `Bad stream URL`) instead of a blank `no signal`. ffmpeg binds AV-LAN (`-localaddr`) when the dest is on that subnet, else the other adapter. Tile is any grid size; `object-contain` keeps stream aspect ratio.

## 0.9.9 — 2026-09-14

- Tag `v0.9.9`. Same Foyer pair (`v0.2.2`). Occupancy GET strings unchanged.
- Trigger panes rebuilt: If / and / on-change-or-interval / one macro. Same engine.
- Room tab occupancy dropdown removed (it overwrote live occupancy on Save). Occupancy var is `0` closed, `1` open, `2` in session, `3` DND. Foyer GET still reads string `occupancy`.
- `FOYER-RELAY.md` identical with Foyer. Architecture lists trigger panes and occupancy `0`–`3`.



## 0.9.8 — 2026-09-14

- Tag `v0.9.8`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Phase 0 tidy: remove dead `resetDemo`. Empty / wipe room is Relay host on localhost only (no conference demo, no fake TV/amp state). Empty `data/drivers/` seeds `relay-host.json` only. Drop joke driver. Write `home-assistant.json` to disk.
- Stock drivers live in `data/library/` (`index.json` for search). `data/drivers/` is this room’s working set. Add copies one spec in; Remove unlinks that copy. Library update does not rewrite room files.
- Deleted `extra-drivers.ts` and the compiled demo specs in `defaults.ts`. Stock is JSON in `data/library/` only. `defaults.ts` keeps empty-room config and last-resort `relayHostDriver`.
- Boot working set is devices + host + JSON already in `data/drivers/`. Old `relay-room.json` catalog blobs are not copied back from the library. Add keys through `safeDriverName`. Empty-folder host seed prefers `data/library/relay-host.json`.
- Removed unused server fns (`testDevice`, `exportBundle`, `issuePanelSession`, `checkPanelSession`), unused `probeDevice`, dead helpers (`isUserMacro`, `isFoyerVar`, `stopMidiWatchers`, `isLoopbackRequest`), and stub `client.ts`. Probe button still uses `pingDevice`.


## 0.9.7 — 2026-09-14

- Tag `v0.9.7`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Engine: `allowedLanHost`, `scrubSecret`, traces, `sleep` in `engine-policy.ts`. Payload tokens, `valueMap`, parse, and inventory JSON parse in `engine-payload.ts`. `engine.ts` remains the barrel (`sendLan`, TCP sessions, monitors, macros). Callers still import `engine.ts`.
- Protocol adapter tests pin `sendLan` / `statusPlane` / `readMonitorValue` by function, not by the next neighbor.

## 0.9.6 — 2026-09-13

- Tag `v0.9.6`.
- Pair Foyer `v0.2.2`.
- Panel: park the portrait 2-column reflow. The room page uses the authored grid on phone and tablet. Equal row tracks so empty cells stay empty and same-span buttons share height.
- Peer GET: unsigned only from TCP loopback (not Host/XFF). Unsigned body is occupancy + `host.locked`. HMAC GET still the full snapshot. Calendar poll unchanged.
- Stop tracking sandbox dumps that `.gitignore` already listed: `artifacts/` (stale engine, tarball, Imagine JPEG), `attachments/`, `.grok/`. Drop App Builder `screenshots/app-builder-*`.

## 0.9.5 — 2026-09-13

- Tag `v0.9.5`.
- Drop unused `occupancyVarId`, `harness.ts`, `src/lib/db.ts` / `migrations/` / `db:migrate`, stale `public/drivers/`, executed agent roadmaps (`CONFIG-SPLIT`, `DRIVER-PAGE`, `PASTEL-THEME`).
- Security copy/generate toasts name Foyer Setup. Wire unchanged: [`FOYER-RELAY.md`](FOYER-RELAY.md).

## 0.9.4 — 2026-09-13

- Tag `v0.9.4`.
- Relay reads Foyer’s current (or next) calendar session over loopback `GET http://127.0.0.1:8080/api/peer` into baked vars `foyer.kind` / `foyer.title` / `foyer.start` / `foyer.end`. Poll every 4 s. Non-loopback Foyer URLs fail closed.
- Occupancy GET on loopback is unsigned so Foyer Auto follows the Room tab / Occupancy commands even if the pasted peer secrets differ. HMAC still required for POST macros. Foyer occupancy poll is still Foyer → Relay (no occupancy POST).

## 0.9.3 — 2026-09-13

- Tag `v0.9.3`.
- Occupancy is first-class (`room.occupancy`) plus a baked list var `occupancy` (`available` / `in-session` / `busy` / `do-not-disturb` / `closed`). Foyer HMAC GET `/api/peer` reads `occupancy` only. Room names do not need to match. No occupancy-variable picker. Foyer is not a Relay device this pass.

## 0.9.2 — 2026-09-13

- Tag `v0.9.2`.
- MPS 602: tagged SIS is ESC…CR (`ESC 0LS CR`, `ESC nAUSW CR`), not the literals `E 0LS}` / `E 0AUSW}`. TCP timeout 8s. Regex accepts `Sig1 0…` and `Sig 1*0*…`.

## 0.9.1 — 2026-09-13

- Tag `v0.9.1`.
- Room tab: **Networks** and **Occupancy / Foyer** cards. Refresh NICs. Peer-secret help names Foyer on loopback.

## 0.9.0 — 2026-09-13

- Tag `v0.9.0`. Versions are three-part from here (`major.minor.patch`). No fourth ticker.
- Room tab: **AV-LAN** and **LAN (internet)** NIC pickers (Foyer `f6abb8e` list: Node A–Z, 0-based, em dash). Same NIC allowed.
- Device sockets bind AV-LAN `localAddress`. GitHub update refuses if the outbound NIC has no IPv4.
- Occupancy (`available` / `in-session` / `busy` / `closed`) plus host `occupancy.*`. `GET /api/peer` emits `v:1`, `room:{id,name}`, `occupancy`, and vars.
- Foyer is optional. No Foyer poller. HMAC stays loopback.

## 0.8.3.5 — 2026-09-13

- Tag `v0.8.3.5`.
- MPS 602: poll SIS `E 0LS}` into `signal.1`…`signal.6` (VGA/HDMI/DTP sync present).

## 0.8.3.4 — 2026-09-12

- Tag `v0.8.3.4`.
- LAN adapters: OSC UDP, sACN (E1.31 multicast), ipMIDI (multicast MIDI), RTP-MIDI (AppleMIDI). USB MIDI is `local.kind` `midi` via `amidi`.
- Library drivers: `osc-udp.json`, `sacn-universe.json`, `usb-midi.json`, `ipmidi.json`, `rtp-midi.json`.
- MIDI in / MTC: `midiWatch` on the driver writes existing feedback ids. Send-only first.

## 0.8.3.3 — 2026-09-11

- Tag `v0.8.3.3`.
- PIN fields stay masked (`type=password`) and request a numeric keypad (`inputMode=numeric`, digits only). Closes #33; supersedes #35.
- Library driver `Driver-voor-christiaans-kut-TV.json`: QE77S95D with power toggle only (no WOL on/off, no app inventory).

## 0.8.3.2 — 2026-09-11

- Tag `v0.8.3.2`.
- Library driver `samsung-tizen.json` (generic Tizen IP remote). Q65T and S95D stay as model copies.

## 0.8.3.1 — 2026-09-11

- Tag `v0.8.3.1`.
- Poll uses `driver.status` only (no feedback `httpPath` GET on port 8001). Sonos/HA monitors go through `sendLan`.
- HTTP path and headers fill `{token}` / `{auth.*}`. Pairing name/token win over `lan.query`.
- Cast `GET_STATUS` returns JSON matching driver parse. Engine no longer peeks `PowerState` / `displayName`.
- Hue feedback: GET `/api/{auth.token}/groups/0`. WOL missing-MAC copy is generic.

## 0.8.3.0 — 2026-09-11

- Tag `v0.8.3.0`.
- LAN I/O split: generic `ws.ts`, `cast.ts`, `pjlink.ts`, `wol.ts`. Websocket path/query/handshake/alsoSend come from driver JSON. Unknown protocol fails closed.
- Sony ADCP `NOKEY` retry is `session.reply` on the driver.

## 0.8.2.10 — 2026-09-11

- Tag `v0.8.2.10`.
- Generic WebSocket: handshake and extra frames live in driver JSON (`lan.handshake`, command/inventory `alsoSend`). Engine no longer special-cases Samsung keys or port 8002.
- `driver-check`: websocket path + handshake; pairing steps; inventory parse fields.
- Seed S95D, Home Assistant, Sonos S1/S2, and ZonePlayer in extra-drivers. ZonePlayer SOAPAction uses `httpHeaders`. Public Samsung/Chromecast copies match `data/drivers`.

## 0.8.2.9 — 2026-09-11

- Tag `v0.8.2.9`.
- Samsung inventory: emit `ed.installedApp.get` and `ed.edenApp.get`; wait for either.

## 0.8.2.8 — 2026-09-11

- Tag `v0.8.2.8`.
- Samsung inventory: wait clock after emit, resend twice, 64-bit WS length; `data:{}` on app-list emit.

## 0.8.2.7 — 2026-09-11

- Tag `v0.8.2.7`.
- Samsung inventory wait: fresh 8002 socket, WS pong, binary frames, honest timeout (not a fake token).

## 0.8.2.6 — 2026-09-11

- Tag `v0.8.2.6`.
- Samsung inventory: reuse live 8002 session, parse appId/name, report item count.
- Light themes: button text stays darker than the fill (no page-color ink on chips).

## 0.8.2.5 — 2026-09-11

- Tag `v0.8.2.5`.
- Themes: Dark, Peach picnic, Outdoors, Modern office. Pastel removed. Muted light backgrounds.

## 0.8.2.4 — 2026-09-11

- Tag `v0.8.2.4`.
- Samsung inventory: parse the JSON that contains the wait event, not the first `{` (app list).
- S95D: pair on 8002 only; WOL delay 10s.

## 0.8.2.3 — 2026-09-11

- Tag `v0.8.2.3`.
- Pastel: lighter shaded-garden (mauve page, green sage/pine, sky steel/ocean). Still not cream.

## 0.8.2.2 — 2026-09-11

- Tag `v0.8.2.2`.
- Extron XPA 1002 driver: gateway I/O templates (`digitalOn`/`digitalOff`; `analogOut` later). Bind Flex I/O, set standbyLine.
- Pastel theme: dusk rose (dark canvas, blush text). Dark theme unchanged.

## 0.8.2.1 — 2026-09-11

- Tag `v0.8.2.1`.
- Drivers tab: search, type chips, sort (brand/model). Library list Add / In room. Snapshot library is index-only (not full JSON).

## 0.8.2 (beta) — 2026-09-11

- Tag `v0.8.2`. Still beta; not production-certified.
- Configurator tabs live in separate files (`src/components/config/*-tab.tsx`). Shell still owns PIN, Save all, draft, and refresh.
- Samsung Q65T and S95D: Authenticate tries **8002 WSS first**. HTTP `:8001/api/v2/` is status-only. Installed-app inventory + App launch / App native.
- Kept LAN sockets no longer grow an unbounded `data` buffer while monitors keep the session alive.
- Config Log tab: one host-status line above the event list. Monitor value changes are logged (including `MON_*`).
- Update from GitHub ignores dirty Nitro/`.vercel` artifacts. Sonos UPnP keeps `SOAPAction` case and polls the feedback path.

## 0.8.1 (beta) — 2026-09-11

- Tag `v0.8.1`. Still beta; not production-certified.
- Config tags for macros / logic (filter chips, drag onto a chip to file, drag chips to reorder). Old `folder` values still load as tags.
- Interface cards fold and drag-reorder. Logic tab sits between Macros and Pages.

## 0.8.0 (beta) — 2026-09-10

- Tag `v0.8.0`. Still beta; not production-certified.
- In-app update checker binds the staged preview with `PORT`/`NITRO_PORT` so it does not collide with the live room on 8081.
- Portrait: two-column flow; full-width only for sliders, schedules, and widgets that already span the authored row; labels stay captions.
- Gateway interfaces (IPL T SFI244), MPS 602 SIS (`input.source`), generic PC WOL + RPC/HTTP shutdown.
- Triggers with extra true/false checks; monitor auto-vars `MON_*`; 500 ms gateway polls.
- Panel access default remains **pin**. **Open on LAN** skips the panel PIN and mints a shared panel session; that is not `externalControl`. New buttons are 1×1 bound to hidden None.
- Chromecast Play/Pause use the live media session and app transport. Button icons pin to the right.
- Room tab shows package version + git SHA. In-app updates are staged and readiness-checked before activation.
- PIN validation/redaction (PR #22). Empty number fields no longer force 0.
- Room and secrets persistence uses a durable paired transaction and matching `.good` files. A corrupt journal is moved aside; the last-good pair is kept.
- HTTP command, monitor, and peer response bodies stay under their timeout and size limit.
- Delayed trigger edges reserve their execution before waiting, preventing duplicate macro runs.
- Server startup loads persisted state and starts automation before the first API request.
- In-app updates build and probe an isolated worktree; failed activation restores and restarts the previous release.
- Added a Sonos S1/S2 LAN driver for transport, mute, volume, and playback-state control over the player HTTP endpoint.
- Added a Samsung QE77S95D driver validated against the TV's Tizen discovery endpoint and secure remote-control port.
- Docs (SECURITY, KNOWN_ISSUES, README, LINUX): panelAccess vs externalControl; firewall as an install step; closed stale tracker issues #17 #19 #20 #21.

## 2026-09-08 — gateway interfaces and Pi update

- Interfaces: `kind: gateway` (first profile: Extron IPL T SFI244). Device bind fills LAN host/port from the slot map (COM1→2001, COM2→2002, IR/I/O on SIS 23).
- Driver `extron-ipl-t-sfi244.json` (SIS I/O, IR play, COM send).
- Sony VPL-FHZ120L waits for ADCP `NOKEY` before commands.
- In-app update: `npm ci --include=dev` so systemd `NODE_ENV=production` still installs Vite. Clears leftover `.vercel/` before `git pull --ff-only origin main`; `npm run build` (Nitro `.vercel/output`, no `dist.next` swap).

## 2026-09-07 — control-plane hardening

- Atomic persist: secrets then room, fsync + rename. Failed second write restores the previous secrets file.
- Panel does not accept the config PIN unless `panelAcceptsConfigPin` is on (default off). Forget clears the tablet token on the next room poll. Expired sessions are dropped from memory and secrets.
- HMAC tests: good sig, replay, uppercase, empty key, skew, wrong path. Open-LAN policy and `system.*` admin gates covered. Change-triggers fire once per edge. Empty schedule days stay skipped.
- Local transports (GPIO / I2C / IR / CEC / SPI) use allowlisted argv. No raw `payload.split`. TCP stays connect-write-close (issue #4).
- Docs aligned with the above. Not audited. Not production-certified.

## 0.7.3 — 2026-09-07

- Configurator PIN is asked once. Sessions stay in memory across secret reload.
- Update: `git pull --ff-only && npm ci && vite build --outDir dist.next`. Failed builds leave `dist/` alone.
- Under systemd, restart is `process.exit(1)` (`Restart=always`). Unit: `StartLimitBurst=5`, `TimeoutStartSec=120`, `ExecStartPre` checks `dist/`.
- `/api/room` rate-limit keyed by session token (loopback not limited). Panel poll 4s.
- Persist: secrets first, `fsync`, corrupt room file renamed `.bad`, last-good `.good`.
- Schedules: busy lock, stamp after success, persist immediately, log `skipped empty days`.
- PGLite not started on `vite preview` / production / systemd.

## 0.7.2 — 2026-09-06

- Panel/config PIN pages use `/api/panel-unlock` and `/api/config-unlock` so client bundles do not import `node:crypto`.
- Unlock re-reads `data/relay-secrets.json` so a reset PIN is live without a process restart.
- Security: peer secret is visible, with Copy and Generate. Relay-host devices use Secret (other room’s peer secret), not Token.
- Vite HMR error overlay disabled so a hot-reload fault does not freeze a tablet.
- Peers can only fire Security allow-listed macros.

- Removed unauthenticated `getSnapshot` / `getRoomState` server functions. Panel uses `/api/room`.
- `system.restart` and `update-relay.mjs` spawn `vite preview` when already in preview, or `systemctl restart relay` under systemd.
- Peers can only fire Security allow-listed macros (no host commands).
- `/api/room` rate-limit uses the socket address. `X-Forwarded-For` only if `RELAY_TRUST_PROXY=1`.
- Empty schedule days never fire. PINs documented as hashed.

- Panel and configurator PIN screens no longer wait on `/api/room`.
- Unlock is `POST /api/panel-unlock` and `POST /api/config-unlock` (scrypt + 5-try lockout).
- First PIN change writes both config and room PINs. Set them apart on Security if the tablet must not open `/config`.
- PINs stored as scrypt. Host restart/update/reboot need a config session and a second PIN. Peers cannot run them.
- `/api/room` rate-limited; unauthenticated calls lose IPs, drivers, and logs.
- Device connects limited to RFC1918 (localhost only for the host driver).
- `npm run start` is vite preview. systemd unit uses that. Secrets path: `RELAY_SECRETS_FILE`.
- Room and secrets files are gitignored. A clone has no used room.

## 0.7.1 — 2026-09-06

- HMAC signatures must be 64 lowercase hex chars; replay cache uses the digest.
- Peer host restart/update/reboot uses the first HMAC only (no second PIN check).
- Save all fails the request if the room or secrets file cannot be written.
- Change-triggers queue at most once per edge.
- Security tab: peer secret, paired tablets until Forget, weak PIN wall (`1234` must be changed).
- Open LAN control **off** by default. HMAC uses the peer secret only; `/api/ping` needs a config session.
- Panel reuses a stored token (no mint on every refresh). `/api/room` hides `peerSecret`.
- Triggers re-check after delay and stamp only on success.
- Kiosk grid fits the screen; dim is an overlay; config scroll clipped under the header.
- Restore demo button removed. Clear config remains.

## 0.7.0 — 2026-09-06

- Relay-to-Relay: remote `relay-host` device (IP:8081 + peer secret) uses `/api/peer` for allow-listed macros only.

Beta. Engine freeze intended; drivers and docs may still move.

- Interface tab: scan on open; path text field; Pi UART entries in the port list.
- Grok/Vercel publish is not a supported host. Run on a PC or Pi with writable `data/`.
- Docs: single Windows guide.

## 2026-09

- Driver spec v2 tokens: `{value}`, `{value:hex2}`, `{value:nrpn14}`, `{auth.*}`, `{host}`, `{port}`, `{id}`.
- TCP hex TX/RX, empty probe = connect, `payloadEncoding` fallback, `minIntervalMs`.
- Host driver: dim, lock, toast, block, vars, nested macros, soft restart.
- Panel keep-awake, fullscreen, schedule widget; systemd boot notes.
- Samsung WOL + token pair; Chromecast volume `0–1`; monitors write-on-error.
- `/dev/serial0` in interface scan; Denon DN-500AV driver.
- Docs: LINUX.md, WINDOWS.md, DRIVER-PROMPT.md, NOTICE, disclaimer in README.
