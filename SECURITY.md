# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted LAN / VLAN only. Bind is `0.0.0.0:8081`. Do not port-forward that port. HTTP only (issue #15).

## What the PIN actually does

- First login accepts `1234`, then forces a stronger PIN.
- Configurator writes need a config PIN session.
- Panel PIN (optional) gates the operator UI once; that browser stays paired until Forget.
- Open LAN control is **off** by default. Turn it on only if you want anonymous `fireMacro` from the VLAN.
- `/api/room` is a public snapshot (layout + vars + IPs). PINs and `peerSecret` are stripped.

## Room-to-room

HMAC-SHA256 (`x-relay-ts` + `x-relay-auth`) using the **peer secret**, not the PIN. Save all creates a secret if missing. Put that secret on the far Relay’s host device card.

## Secrets on disk

`data/relay-secrets.json` holds PINs, peer secret, and paired session secrets in plaintext (issues #3, #14). `data/relay-room.json` is layout and IPs. Export never includes the secrets file. Treat the SD card as secret.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them.

## Checklist

- Change PIN `1234` on first config login.
- Leave open LAN control off unless the VLAN is fully trusted.
- Guest Wi-Fi on another VLAN.
- Keep `data/` off shared sticks.
