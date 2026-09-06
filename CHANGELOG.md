# Changelog

Format: date, then bullets. Older work lives in `git log`.

## Unreleased

- Panel keep-awake (Screen Wake Lock) and fullscreen controls; hide while active; restore when the lock or fullscreen ends.
- Room setting **Keep tablets fullscreen** and **Push fullscreen** (`display.fullscreen` / `host.fullscreenAt`). Browsers still need one tap after reboot.
- `/api/room` and store boot: if `data/` is missing or read-only, serve the bundled demo instead of HTTP 503.
- Interface scan: `/dev/serial0`, `/dev/serial1`, `/dev/ttyAMA0`, `/dev/ttyS0`.
- Driver `denon-dn-500av.json` (Telnet 23 / RS-232 9600, Denon AVR ASCII).
- LINUX.md: Pi UART enable, `serial0`, 3.3 V vs RS-232.
- This file and `KNOWN_ISSUES.md`.

## 2026-09

- Driver spec v2 tokens: `{value}`, `{value:hex2}`, `{value:nrpn14}`, `{auth.*}`, `{host}`, `{port}`, `{id}`.
- TCP hex TX/RX, empty probe = connect, `payloadEncoding` fallback, `minIntervalMs`.
- Host driver: dim, lock, toast, block, vars, nested macros, soft restart.
- Panel schedule widget; systemd boot notes; optional `gpiod` / `i2c-tools` / `cec-utils` / `lirc`.
- Samsung WOL + token pair; Chromecast volume `0–1`; monitors write-on-error.
- Driver library vs instance config; confirm delete when in use.
- Docs: LINUX.md, WINDOWS.md, DRIVER-PROMPT.md, NOTICE, disclaimer in README.
