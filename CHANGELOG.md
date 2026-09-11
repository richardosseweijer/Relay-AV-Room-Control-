# Changelog

Format: date, then bullets. Older work lives in `git log`.

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
