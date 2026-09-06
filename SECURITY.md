# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted LAN / VLAN only. Bind is `0.0.0.0:8081`. Do not port-forward that port. HTTP only (issue #15).

## What the PIN actually does

- Room `/` unlocks with the panel PIN **or** the config PIN. Config `/config` accepts only the config PIN.
- First login accepts `1234`, then forces a stronger PIN. Stored PINs are scrypt hashes.
- Five failed PIN tries lock that gate for five minutes.
- Configurator writes need a config session. Host restart/update/reboot also ask for the PIN again.
- Each tablet pairs with the panel PIN and gets its own session (30 days from last use).
- Open LAN control is **off** by default.
- `/api/room` without a Bearer token omits IPs, drivers, and the action log. 40 requests / 10s per client.

## Room-to-room

HMAC-SHA256 (`x-relay-ts` + `x-relay-auth`). Signature must be 64 lowercase hex characters. Replay cache stores the digest for 90s. Peers may run only macros listed on Security. Host commands are rejected.

## Secrets on disk

`data/relay-secrets.json` (or `RELAY_SECRETS_FILE`) holds hashed PINs, peer secret, and session secrets. Put that file off the SD card backup set. Export never includes it.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them.

## Checklist

- Change PIN `1234` on first config login.
- Leave open LAN control off unless the VLAN is fully trusted.
- Guest Wi-Fi on another VLAN.
- Keep `data/` off shared sticks.
