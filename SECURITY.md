# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted **AV-LAN** only for the cleartext panel and API. Production HTTP binds to the **AV-LAN IPv4** (never `0.0.0.0`). Dev is port 8080 (`npm run dev`). Production is port 8081 (`npm start`). HTTP only today (issue #15). **HTTPS / Let’s Encrypt on the venue NIC is Phase B** — not shipped in A3. Do not port-forward 8080, 8081, or 8082. A host firewall that allows the panel port only from the AV-LAN CIDR is part of the install, not optional advice.

### Dual-NIC trust model

| NIC | Role | Required? |
|---|---|---|
| **NIC1 AV-LAN** | Trusted offline control LAN. Panel/API listen here. Device/control protocols stay on AV unless already designed for open LAN (Cast, Hue, etc.). | Required |
| **NIC2 venue/internet** | Outbound GitHub Update (and future Phase B HTTPS/LE). Picker **None** = air-gap / single-NIC. | Optional |

- NIC2 down, **None**, or a future LE failure must **not** break NIC1 / AV listen.
- No IP forwarding or bridge between NICs (`ip_forward=0`, no `br-*` joining AV and venue).
- No cleartext panel on the venue NIC. Do not set `RELAY_LISTEN_HOST=0.0.0.0` in production.

### Listen resolution (A2)

1. `RELAY_LISTEN_HOST` env override if set (escape hatch; do not use `0.0.0.0` in production).
2. Else room **AV-LAN** pick → that NIC’s IPv4.
3. AV unset → `127.0.0.1` + warning (loopback only).
4. AV set but missing / no IPv4 → refuse listen (never widen to all interfaces).

Tablet URL today: `http://<av-lan-ip>:8081` (or configured `PORT`). Dual HTTPS venue URL is Phase B.

Outbound **None** → **Update from GitHub** is disabled / refused with a clear reason. Update needs an outbound NIC.

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
- `GET /api/vars` is unsigned only when this switch is on **and** no peer secret is configured. If a peer secret is set, `/api/vars` requires the same HMAC headers as `/api/peer` (a configured key is never ignored for open GET).

## What the PIN actually does

- Config `/config` accepts only the config PIN.
- First login accepts `1234`, then forces a stronger PIN. Stored PINs are scrypt hashes.
- Five failed PIN tries lock that gate for five minutes (counter is process memory; a restart clears it).
- Configurator writes need a config session. Host restart/update/reboot also ask for the PIN again.
- Forget deletes the server session row. The tablet drops `relay-panel-token` when `/api/room` reports `sessionValid: false`.
- `/api/room` without a Bearer token omits IPs, drivers, and the action log. Rate-limited per client.
- `/api/preview` needs a panel or config session. The RTSP/HTTP URL comes from the widget, not the query string, and must pass `allowedLanHost`.

## Room-to-room

HMAC-SHA256 (`x-relay-ts` + `x-relay-auth`). Signature must be 64 lowercase hex characters. Replay cache stores the digest for 90s. Peers may run only macros listed on Security. Host commands are rejected. The peer secret is not a PIN.

Foyer (optional) on this PC: occupancy GET and calendar-session GET on loopback. See [`FOYER-RELAY.md`](FOYER-RELAY.md). Unsigned GET is allowed only when the **TCP peer** is loopback (`127.0.0.1` / `::1`); the body is occupancy + `host.locked` only. `Host` / `X-Forwarded-*` are not loopback. HMAC GET (LAN or loopback) returns the full peer snapshot. POST still requires HMAC. Room names do not need to match.

## Secrets on disk

`data/relay-secrets.json` (or `RELAY_SECRETS_FILE`) holds hashed PINs, peer secret, session secrets, and device tokens (issue #14). Put that file off the SD card backup set.

Export never includes PINs, `peerSecret`, session secrets, or device tokens.

Persist writes a `relay-room.json.transaction` journal, then secrets, then room (temp + fsync + rename). Matching `.good` copies are refreshed after a successful pair. A crash mid-write is recovered on boot from the journal or the last-good pair. A corrupt journal is moved aside (`.transaction.bad`); the last-good pair is kept. The room is not wiped because a journal was unreadable.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them. They need a config session.

## Checklist

- Change PIN `1234` on first config login.
- Leave panel access on **Panel PIN** unless the wall tablet is a dedicated kiosk on AV-LAN.
- Leave `panelAcceptsConfigPin` off unless the same PIN must open both screens.
- Leave open LAN control off unless AV-LAN is fully trusted.
- Guest Wi-Fi on another VLAN (not AV-LAN).
- Keep `data/` off shared sticks.
- **AV-LAN** has **no default route**. **LAN (internet)** has the default route, **or** is **None** (air-gap / single-NIC; Update unavailable).
- `sysctl net.ipv4.ip_forward=0` (and IPv6 forward off). No bridge between AV and venue NICs.
- ufw: allow panel port **from AV-LAN CIDR only** — not from the venue NIC / WAN. Do not `ufw allow 8081/tcp` from anywhere.
- Verify: `ip route`, `ss -lptn 'sport = :8081'`, `ufw status`. Listen address must be the AV IPv4 (or loopback if AV unset) — never `0.0.0.0`.
- Outbound **None** ⇒ Update from GitHub unavailable (expected).
- Do not port-forward the panel port to venue/WAN. Do not port-forward 8080, 8081, or 8082. Foyer (if installed) is a separate process; HMAC between Relay and Foyer is loopback only.
- Do not set `RELAY_LISTEN_HOST=0.0.0.0` on a room PC.
