# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted LAN / VLAN only. Bind is `0.0.0.0`. Dev is port 8080 (`npm run dev`). Production is port 8081 (`npm start`). HTTP only (issue #15). Do not port-forward those ports. A host firewall that allows 8081 only from the room VLAN is part of the install, not optional advice.

## Two different “open” switches

They are easy to confuse. They are not the same control.

### 1. Panel access (`room.panelAccess`)

- Default on a new room is **`pin`**. The wall `/` asks for the **panel PIN** and mints a per-tablet session (30 days from last use).
- Config PIN is accepted on the panel only if `room.panelAcceptsConfigPin === true` (Security checkbox, **default off**).
- **`open`** (“Open on LAN” in the configurator) skips the PIN screen and mints a **shared panel session** for any client that can reach `/`. That token is a panel token: it may fire commands and macros through the normal handlers even when “open LAN control” is off. `/config` still requires the config PIN. Host `system.restart|update|reboot` still require a **config** session.
- Use `open` only for a kiosk on a VLAN you treat as the room. It is not a guest Wi-Fi setting.

### 2. Open LAN control (`room.externalControl`)

- **Off by default.**
- When on, `fireCommand` / `fireMacro` / `setVariable` accept calls with no Bearer token. Admin host commands still need a config session.

## What the PIN actually does

- Config `/config` accepts only the config PIN.
- First login accepts `1234`, then forces a stronger PIN. Stored PINs are scrypt hashes.
- Five failed PIN tries lock that gate for five minutes (counter is process memory; a restart clears it).
- Configurator writes need a config session. Host restart/update/reboot also ask for the PIN again.
- Forget deletes the server session row. The tablet drops `relay-panel-token` when `/api/room` reports `sessionValid: false`.
- `/api/room` without a Bearer token omits IPs, drivers, and the action log. Rate-limited per client.

## Room-to-room

HMAC-SHA256 (`x-relay-ts` + `x-relay-auth`). Signature must be 64 lowercase hex characters. Replay cache stores the digest for 90s. Peers may run only macros listed on Security. Host commands are rejected.

## Secrets on disk

`data/relay-secrets.json` (or `RELAY_SECRETS_FILE`) holds hashed PINs, peer secret, session secrets, and device tokens (issue #14). Put that file off the SD card backup set.

Export never includes PINs, `peerSecret`, session secrets, or device tokens.

Persist writes a `relay-room.json.transaction` journal, then secrets, then room (temp + fsync + rename). Matching `.good` copies are refreshed after a successful pair. A crash mid-write is recovered on boot from the journal or the last-good pair. A corrupt journal is moved aside (`.transaction.bad`); the last-good pair is kept. The room is not wiped because a journal was unreadable.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them. They need a config session.

## Checklist

- Change PIN `1234` on first config login.
- Leave panel access on **Panel PIN** unless the wall tablet is a dedicated kiosk on the room VLAN.
- Leave `panelAcceptsConfigPin` off unless the same PIN must open both screens.
- Leave open LAN control off unless the VLAN is fully trusted.
- Guest Wi-Fi on another VLAN.
- Keep `data/` off shared sticks.
- Do not port-forward 8080 or 8081.
