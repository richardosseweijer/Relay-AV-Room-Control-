# Changelog

Format: date, then bullets. Older work lives in `git log`.

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

- Relay-to-Relay: remote `relay-host` device (IP:8081 + peer secret) uses `/api/peer` for macros, host commands, inventory.

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
