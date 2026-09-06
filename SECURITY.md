# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted LAN / VLAN only. Bind is `0.0.0.0:8081`. Do not port-forward that port.

## What the PIN actually does

- Configurator pages require a config PIN session for editor writes.
- Panel PIN (optional) gates the operator UI in the browser.
- If Room → external control is on (default), `fireCommand` / `fireMacro` / `setVariable` accept LAN calls without a token.
- Turn external control off to require a panel or config token on those handlers.
- `/api/room` is a public snapshot with PINs and secrets stripped. It is still a live view of the room.

## Secrets on disk

`data/relay-secrets.json` holds PINs and pairing tokens in plaintext. `data/relay-room.json` holds layout and IPs only. PINs and tokens stay plaintext in `data/relay-secrets.json`. Treat the card as secret. Export never includes that file.

GET `/api/room` is the panel bootstrap (layout + vars, no PINs). Keep it on the room VLAN.

HMAC uses the peer secret only (not the PIN). Reused signatures are rejected for 90s. Generate a secret on Security or Save all will create one.

`/api/ping` and `/api/vars` writes need a config session or HMAC. Open LAN control is off unless you tick it.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them. Restrict who can reach `/config` and who can edit macros.

## Checklist

- Change PIN `1234` before a live room.
- Disable external control if the LAN is not fully trusted.
- Guest Wi-Fi on another VLAN.
- Keep `data/` off shared sticks.
