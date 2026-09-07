# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted LAN / VLAN only. Bind is `0.0.0.0`. Dev is port 8080 (`npm run dev`). Production is port 8081 (`npm start`). Do not port-forward those ports. HTTP only (issue #15).

## What the PIN actually does

- Room `/` unlocks with the **panel PIN**. The config PIN is accepted on the panel only if `room.panelAcceptsConfigPin === true` (Security checkbox, **default off**).
- Config `/config` accepts only the config PIN.
- First login accepts `1234`, then forces a stronger PIN. Stored PINs are scrypt hashes.
- Five failed PIN tries lock that gate for five minutes.
- Configurator writes need a config session. Host restart/update/reboot also ask for the PIN again.
- Each tablet pairs with the panel PIN and gets its own session (30 days from last use). Forget deletes the server row; the tablet drops its stored token when `/api/room` reports the session invalid.
- Open LAN control is **off** by default.
- `/api/room` without a Bearer token omits IPs, drivers, and the action log. Rate-limited per client.

## Room-to-room

HMAC-SHA256 (`x-relay-ts` + `x-relay-auth`). Signature must be 64 lowercase hex characters. Replay cache stores the digest for 90s. Peers may run only macros listed on Security. Host commands are rejected.

## Secrets on disk

`data/relay-secrets.json` (or `RELAY_SECRETS_FILE`) holds hashed PINs, peer secret, and session secrets. Put that file off the SD card backup set.

Export never includes PINs, `peerSecret`, session secrets, or device tokens.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them. They need a config session.

## Checklist

- Change PIN `1234` on first config login.
- Leave open LAN control off unless the VLAN is fully trusted.
- Leave `panelAcceptsConfigPin` off unless the same PIN must open both screens.
- Guest Wi-Fi on another VLAN.
- Keep `data/` off shared sticks.
