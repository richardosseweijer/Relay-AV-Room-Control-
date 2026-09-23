# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted **AV-LAN** only for the cleartext panel and API. Production HTTP binds to the **AV-LAN IPv4** (never `0.0.0.0`). Dev is port 8080 (`npm run dev`). Production is port 8081 (`npm start`). HTTP on AV-LAN today (issue #15). **Shipped:** optional file-based HTTPS on the venue NIC is **B1** (when `RELAY_TLS_CERT`/`RELAY_TLS_KEY` or room `tlsCertPath`/`tlsKeyPath` are set and outbound NIC is not None), plus **B3** venue HMAC peer and **B4** `nicFace`. **Let’s Encrypt / ACME / DNS-01 is PARKED permanently** for this product shape (guest LAN, no admin DNS rights, $0, no Cloudflare/LE accounts) — do not treat LE as the default or next path. **Planned (C1–C4, not shipped):** in-box **Generate** venue CA + leaf. Do not port-forward 8080, 8081, or 8082. A host firewall that allows the panel port only from the AV-LAN CIDR is part of the install, not optional advice. Inventory and roadmap: [Venue TLS inventory](#venue-tls-inventory-c0).

### Dual-NIC trust model

| NIC | Role | Required? |
|---|---|---|
| **NIC1 AV-LAN** | Trusted offline control LAN. Panel/API listen here. Device/control defaults to AV (`nicFace=av`). Cast/Hue etc. stay AV unless operator sets venue face (no cleartext on venue). | Required |
| **NIC2 venue/internet** | Outbound GitHub Update + optional Phase B1 HTTPS (file certs) + B3 HMAC peer over that HTTPS + B4 per-device `nicFace=outbound` bind. Picker **None** = air-gap / single-NIC (no venue HTTPS / no venue peer / venue nicFace soft-fails). | Optional |

- NIC2 down, **None**, missing PEMs, or a future venue-TLS / Generate failure must **not** break NIC1 / AV listen.
- No IP forwarding or bridge between NICs (`ip_forward=0`, no `br-*` joining AV and venue).
- No cleartext panel on the venue NIC. Do not set `RELAY_LISTEN_HOST=0.0.0.0` in production.

### Listen resolution (A2)

1. `RELAY_LISTEN_HOST` env override if set (escape hatch; do not use `0.0.0.0` in production).
2. Else room **AV-LAN** pick → that NIC’s IPv4.
3. AV unset → `127.0.0.1` + warning (loopback only).
4. AV set but missing / no IPv4 → refuse listen (never widen to all interfaces).

Tablet URL (AV): `http://<av-lan-ip>:8081` (or configured `PORT`). Optional venue URL when B1 certs are present: `https://<outbound-ip>:8443` (`RELAY_HTTPS_PORT`). LE/ACME parked; in-box PEMs now; Generate planned (C1–C4).

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

### Peer face (B3)

| Face | When | Wire |
|---|---|---|
| **AV-LAN** (default) | Peer host on AV subnet, or `peerFace=av` | `http://<av-ip>:8081` + HMAC; bind AV IPv4 |
| **Venue / NIC2** | Host on outbound subnet, or `peerFace=outbound` | `https://<venue-ip>:8443` (`RELAY_HTTPS_PORT`) + HMAC under TLS; bind outbound IPv4 |

- Never cleartext HTTP on the venue face. Soft-skip venue peer when outbound is **None** or TLS PEMs are missing — AV-LAN peers keep working.
- Inbound peer on the B1 HTTPS listener uses the same `/api/peer` + HMAC middleware when certs are present.
- Operator: point a remote `relay-host` device at the other room’s live NIC2 IP (Networks UI) + 8443, set Peer face **Venue** (or Auto when the IP is on your outbound subnet). No ACME/FQDN (LE parked).
- File PEMs (self-signed / private CA, drop-in today or Generate planned) use `rejectUnauthorized: false` on the venue face for this product shape. Raw IPv4 is OK; public DNS/FQDN is not required.

### Device NIC face (B4)

| Face | When | Wire |
|---|---|---|
| **AV-LAN** (default) | `nicFace` unset / `av` | Device sockets bind AV IPv4 (unchanged) |
| **Venue / NIC2** | `nicFace=outbound` | Bind outbound IPv4; soft-fail that device if outbound None / no IPv4 |

- **vs peerFace:** `peerFace` is relay-host HMAC only (`auto` + HTTP↔HTTPS). `nicFace` is bind-only for general devices (no auto; default `av`). Do not use `nicFace` instead of Peer face for HMAC peers.
- No cleartext HTTP/WebSocket on venue. sACN and ipMIDI multicast stay AV-only (clear error if `nicFace=outbound`). Cast / HTTPS / TLS-WebSocket may use venue bind.
- Soft-fail venue face must not take AV devices down.
- Inventory `httpPath` is cleartext HTTP today — refused on `nicFace=outbound` with a clear error (keep AV face for inventory HTTP).
- Venue device HTTPS also uses soft TLS verify (`rejectUnauthorized: false`) for file / venue-CA PEMs (LE parked).

Foyer (optional) on this PC: occupancy GET and calendar-session GET on loopback. See [`FOYER-RELAY.md`](FOYER-RELAY.md). Unsigned GET is allowed only when the **TCP peer** is loopback (`127.0.0.1` / `::1`); the body is occupancy + `host.locked` only. `Host` / `X-Forwarded-*` are not loopback. HMAC GET (LAN or loopback) returns the full peer snapshot. POST still requires HMAC. Room names do not need to match.

**Foyer ↔ AV-only listen foot-gun (intentional through B5):** Relay production binds HTTP to the AV-LAN IPv4 only (never `0.0.0.0`, never dual-bind). Foyer’s default Relay URL is `http://127.0.0.1:8081` and fail-closes non-loopback — so occupancy pull does **not** work on a dual-NIC room PC until a later dual-bind / Foyer URL train. Lab escape only: `RELAY_LISTEN_HOST=127.0.0.1` (not for production). Do not “fix” this by widening listen to all interfaces. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## Venue TLS inventory (C0)

Canonical dual-NIC + venue TLS map. Prefer this section over older “LE = B2” wording elsewhere. Docs-only phase — **no cert generation code in C0**.

### Shipped (A + B through `v0.9.45`)

| Item | Behaviour |
|---|---|
| **A1** | Outbound NIC can be **None**; Update / NIC2 soft-fail when None |
| **A2** | HTTP listen pinned to **AV-LAN IPv4 only** (never `0.0.0.0`) |
| **A3/A4** | Dual-NIC docs + remaining AV bind gaps closed (~`v0.9.43` → B train) |
| **B1** | Optional HTTPS on NIC2/outbound when PEM cert+key present; soft-skip if None/no certs; **AV stays up** |
| Live IP | Networks UI shows live IPv4 for NICs (raw IP OK; no DNS/LE needed) |
| **B3** | `peerFace` `auto` \| `av` \| `outbound`; venue peers HTTPS+HMAC; soft-skip; `rejectUnauthorized: false` for file PEMs |
| **B4** | `nicFace` `av` \| `outbound` for device bind |
| **B5** | Inventory cleartext blocked on `nicFace=outbound`; tagged `v0.9.45` |

**Wire split:** AV cleartext HTTP (`:8081`) vs venue optional HTTPS (`:8443`) vs `nicFace`/`peerFace` bind planners. AV must not depend on venue certs.

**Current PEM drop (B1):** point `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (env wins) or room `tlsCertPath` + `tlsKeyPath` at readable PEM files on disk. No default path under `data/` today — operator chooses paths. Missing/unreadable ⇒ soft-skip venue HTTPS only.

### PARKED (not the product path)

**Let’s Encrypt / ACME / DNS-01 / public FQDN** — parked permanently for this product shape: guest / venue LAN, no admin DNS rights, $0 budget, no Cloudflare or LE accounts. Do **not** reintroduce LE as the default story, “next” milestone, or install prerequisite.

### Planned — upcoming C1–C4 (NOT shipped; do not document as live)

| Phase | TARGET |
|---|---|
| **C1** | In-box **Generate** venue CA + leaf for the **live NIC2 IPv4** (button / operator action) |
| **C2** | Auto-wire generated PEMs into the B1 HTTPS listener paths |
| **C3** | CA download from **NIC2 HTTPS** after browser click-through (no AV-LAN hop for CA trust) |
| **C4** | Regenerate on NIC2 IP drift; integrator-light UX |

Until C1 ships, operators use drop-in file PEMs for B1. Generate UI, cert crypto, and CA download endpoints are **out of scope for C0**.

### Doc crawl (where dual-NIC / TLS / LE lived)

| File | Role after C0 |
|---|---|
| `SECURITY.md` (this file) | Canonical trust model + inventory + Planned vs Shipped |
| `LINUX.md` §5b / venue HTTPS notes | Install: dual-NIC, ufw, PEM drop, planned Generate + NIC2 CA click-through |
| `ARCHITECTURE.md` §2 / §8 | Process listen + access control aligned with AV HTTP vs venue HTTPS |
| `CONTEXT.md` / `AGENTS.md` | Agent map + bans: no LE default; no `0.0.0.0`; AV ≠ venue certs; C1+ implements Generate |
| `KNOWN_ISSUES.md` | Still-true listen / venue TLS bullets |
| `README.md` / `WINDOWS.md` | Short pointers; never claim LE as default |
| `CHANGELOG.md` | C0 under Unreleased (docs); historical B2 wording left in past releases |
| `FOYER-ROADMAP.md` | Historical implementation notes only — not the TLS roadmap |


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
- Outbound **None** ⇒ Update from GitHub unavailable (expected); venue HTTPS also skipped.
- Optional venue HTTPS (B1): `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (or room `tlsCertPath`/`tlsKeyPath`) with outbound NIC set. Port `RELAY_HTTPS_PORT` (default 8443). Missing certs ⇒ skip venue HTTPS only — AV HTTP stays up. LE/ACME parked — not required.
- Venue peer (B3): same PEMs + outbound NIC; HMAC peer over HTTPS. Soft-skip venue peer if None/no PEMs; AV peers unchanged.
- Device `nicFace` (B4): venue bind only when needed; soft-fail that device if None/no IPv4; no cleartext HTTP/WS on venue.
- Phase B software checkpoint (B5): A1–A4 + B1/B3/B4 tagged at `v0.9.45`. Soft TLS verify for file PEMs. **Planned C1–C4:** in-box Generate venue CA (not live yet).
- Do not port-forward the panel port to venue/WAN. Do not port-forward 8080, 8081, or 8082. Foyer (if installed) is a separate process; HMAC between Relay and Foyer is loopback only.
- Do not set `RELAY_LISTEN_HOST=0.0.0.0` on a room PC.
