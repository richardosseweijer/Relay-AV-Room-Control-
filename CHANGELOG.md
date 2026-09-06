# Changelog

Format: date, then bullets. Older work lives in `git log`.

## 0.7.0 — 2026-09-06

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
