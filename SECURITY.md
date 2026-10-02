# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted **AV-LAN** only for the cleartext panel and API. Production HTTP binds to the **AV-LAN IPv4** (never `0.0.0.0`). Dev `:8080` / production `:8081`. Do not port-forward 8080, 8081, or 8082. A host firewall that allows the panel port only from the AV-LAN CIDR is part of the install. Optional venue HTTPS, Generate/UI lifecycle, strict peer/device TLS, and PARKED LE: see [Venue TLS inventory](#venue-tls-inventory-c0).

### Dual-NIC trust model

| NIC | Role | Required? |
|---|---|---|
| **NIC1 AV-LAN** | Trusted offline control LAN. Panel/API listen here. Device/control defaults to AV (`nicFace=av`). Cast/Hue etc. stay AV unless operator sets venue face (no cleartext on venue). | Required |
| **NIC2 venue/internet** | Outbound GitHub Update + optional Phase B1 HTTPS (file certs) + B3 HMAC peer over that HTTPS + B4 per-device `nicFace=outbound` bind. Picker **None** = air-gap / single-NIC (no venue HTTPS / no venue peer / venue nicFace soft-fails). | Optional |

- NIC2 down, **None**, missing PEMs, or a future venue-TLS / Generate failure must **not** break NIC1 / AV listen.
- No IP forwarding or bridge between NICs (`ip_forward=0`, no `br-*` joining AV and venue).
- No cleartext panel on the venue NIC. Do not set `RELAY_LISTEN_HOST=0.0.0.0` in production.
- **Local HDMI panel kiosk (Linux):** optional `relay-kiosk.service` (cage + Chromium) opens `http://<av-lan-ipv4>:<port>/` only — never widens HTTP to `0.0.0.0`. Narrow sudoers for `sudo -n systemctl` on that unit only (`deploy/sudoers.relay-kiosk`); missing drop-in → clear LINUX.md error (not raw polkit). Relay stays non-root. When Foyer owns Welcome/Room panel heads on the same host, disable Relay’s unit (`systemctl disable --now relay-kiosk`) — see [`LINUX.md`](LINUX.md) §7a. Relay-only HDMI: [`LINUX.md` Appendix](LINUX.md#appendix-relay-without-foyer-relay-owns-a-display).
- **Apply AV-LAN IPv4 (Linux):** configurator may set AV static/DHCP via `sudo -n nmcli` under config token + Config PIN. Targets the saved AV pick only; strips gateway + `ipv4.never-default yes`; never listens on `0.0.0.0`; privilege is narrow nmcli sudoers — not full root / not AmbientCapabilities for this path.
- **LAN Wi‑Fi join (Linux):** configurator may scan/connect the LAN (outbound) wireless NIC via `sudo -n nmcli` under config token (+ Config PIN for Connect). PSK in `relay-secrets.json` only; SSID in room config. Does not host an AP or change AV-LAN Apply.

### Listen resolution (A2)

1. `RELAY_LISTEN_HOST` env override if set (escape hatch; do not use `0.0.0.0` in production).
2. Else room **AV-LAN** pick → that NIC’s IPv4.
3. AV unset/invalid → auto-map **first scanned NIC** (physical eth/en* before docker/veth/bridges; persist); bind that IPv4. No scanned NICs → `127.0.0.1` + warning.
4. AV set but missing / no IPv4 → refuse listen (never widen to all interfaces).

Tablet URL (AV): `http://<av-lan-ip>:8081` (or configured `PORT`). Optional venue URL when B1 certs are present: `https://<outbound-ip>:8443` (`RELAY_HTTPS_PORT`). LE/ACME parked; in-box PEMs now; Generate + Networks UI / CA download / regenerate lifecycle shipped (C1–C3); C4 docs checkpoint `v0.9.46`.

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

- Never cleartext HTTP on the venue face. Soft-skip venue peer when outbound is **None** or server TLS PEMs are missing — AV-LAN peers keep working.
- Inbound peer on the B1 HTTPS listener uses the same `/api/peer` + HMAC middleware when certs are present.
- Operator: point a remote `relay-host` device at the other room’s live NIC2 IP (Networks UI) + 8443, set Peer face **Venue** (or Auto when the IP is on your outbound subnet). No ACME/FQDN (LE parked).
- **Strict peer TLS (shipped):** venue HTTPS peers verify the remote leaf against a **trusted peer CA** you configure on the `relay-host` device (`peerTrustedCaPath` / paste / `RELAY_PEER_TRUSTED_CA`). Happy path: `rejectUnauthorized: true` + `ca` = that PEM. **Fail-closed** with a clear “install peer CA” error when the CA is missing — soft `rejectUnauthorized: false` is **not** the venue peer happy path. Exchange: remote Networks → **Download CA** → save PEM → set Trusted peer CA path. Same-install loop: point at this room’s `data/tls/venue/ca.cert.pem`. Raw IPv4 is OK; public DNS/FQDN is not required.
- AV control must not depend on venue peer TLS succeeding — a failed venue peer call soft-fails that peer only.

### Device NIC face (B4)

| Face | When | Wire |
|---|---|---|
| **AV-LAN** (default) | `nicFace` unset / `av` | Device sockets bind AV IPv4 (unchanged) |
| **Venue / NIC2** | `nicFace=outbound` | Bind outbound IPv4; soft-fail that device if outbound None / no IPv4 |

- **vs peerFace:** `peerFace` is relay-host HMAC only (`auto` + HTTP↔HTTPS). `nicFace` is bind-only for general devices (no auto; default `av`). Do not use `nicFace` instead of Peer face for HMAC peers.
- No cleartext HTTP/WebSocket on venue. sACN, ipMIDI multicast, and **Cast** stay AV-only (clear error if `nicFace=outbound`). HTTPS / TLS-WebSocket may use venue bind **with** device CA or sha256 pin.
- Soft-fail venue face must not take AV devices down.
- Inventory `httpPath` is cleartext HTTP today — refused on `nicFace=outbound` with a clear error (keep AV face for inventory HTTP).
- **Strict device TLS (shipped `v0.9.48`):** third-party HTTPS / tls-websocket use per-device `deviceTrustedCaPath` / PEM and/or `tlsFingerprintSha256`. Venue without trust → fail-closed (“configure device CA / pin”). Soft `rejectUnauthorized: false` is **not** the venue device happy path. AV without CA/pin uses the system trust store. Cast soft verify is AV-only (documented exception). Manual `scripts/samsung-pair.mjs` is fail-closed on port 8002 unless `--ca` / `--fingerprint` (or explicit `--insecure` discover). Relay↔Relay peers use trusted peer CA (`v0.9.47`).

Foyer (optional) on this PC: occupancy GET to Relay on **AV-LAN `:8081`** (or loopback lab); calendar-session GET on Foyer loopback `:8080`. See [`FOYER-RELAY.md`](FOYER-RELAY.md). Unsigned GET is allowed when the **TCP peer** is loopback (`127.0.0.1` / `::1`) **or equals the HTTP listen host** (same-PC AV hairpin); the body is occupancy + `host.locked` only. `Host` / `X-Forwarded-*` are not local. HMAC GET (LAN or loopback) returns the full peer snapshot. POST still requires HMAC. Room names do not need to match.

**Foyer control URL (fixed):** Relay production still binds HTTP to the AV-LAN IPv4 only (never `0.0.0.0`). The advertised panel / Foyer Relay URL prefers that live AV IPv4 (`controlBaseUrlFrom`; Room → Occupancy paste hint). Soft-fail when no scanned NICs / no IPv4 (unset auto-maps like listen). Unsigned `/api/peer` GET treats TCP peer == listen host as local (same-PC hairpin), same as loopback. Lab escape only: `RELAY_LISTEN_HOST=127.0.0.1`. Do not widen listen to all interfaces. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## Venue TLS inventory (C0)

<a id="venue-tls-inventory-c0"></a>

Canonical dual-NIC + venue TLS map. Prefer this over older “LE = B2” wording. `LINUX.md` §5b keeps ufw copy-paste and a short venue pointer — **do not** re-expand history there.

| Status | What |
|---|---|
| **Shipped A1–A2** | Outbound may be **None** (Update soft-fail). HTTP listen = **AV-LAN IPv4 only** (never `0.0.0.0`). |
| **Shipped B1 / B3 / B4 / B5** (`v0.9.45`) | Optional venue HTTPS from file PEMs (`RELAY_TLS_*` or room paths; C1 Generate wires `data/tls/venue/`). `peerFace` + HMAC; **strict peer CA** (fail-closed). `nicFace` AV vs venue; cleartext blocked on venue. AV must not depend on venue certs. |
| **Shipped C1–C4** (`v0.9.46`) | In-box Generate (ECDSA CA+leaf, IP SAN) + Networks UI / CA download / regenerate confirm / expiry+mismatch banners / OS hints + docs checkpoint. |
| **Shipped strict TLS** | Peer `v0.9.47`; device HTTPS/TLS-WS CA or sha256 pin `v0.9.48`; `samsung-pair.mjs` fail-closed on 8002 `v0.9.49`. Soft `rejectUnauthorized: false` is not the venue / pairing happy path. |
| **PARKED** | Let’s Encrypt / ACME / DNS-01 / public FQDN — permanently parked for this product shape. Do not reintroduce as default or “next”. |
| **Residual** | AV-only Cast soft TLS (blocked on venue). |

Operators may still drop file PEMs for B1. **C0–C4 closed.** Trust-model detail for peer / device faces: sections above (Peer face B3, Device NIC face B4). Doc pointers: `LINUX.md` §5b (ufw), `ARCHITECTURE.md` §2/§8, `CONTEXT.md` / `AGENTS.md` (bans), `KNOWN_ISSUES.md`, `README.md`, `CHANGELOG.md`.


## Secrets on disk

`data/relay-secrets.json` (or `RELAY_SECRETS_FILE`) holds hashed PINs, peer secret, session secrets, and device tokens (issue #14). Put that file off the SD card backup set.

Export never includes PINs, `peerSecret`, session secrets, or device tokens.

Persist writes a `relay-room.json.transaction` journal, then secrets, then room (temp + fsync + rename). Matching `.good` copies are refreshed after a successful pair. A crash mid-write is recovered on boot from the journal or the last-good pair. A corrupt journal is moved aside (`.transaction.bad`); the last-good pair is kept. The room is not wiped because a journal was unreadable.

## Host commands

`relay-host.json` can restart Vite, reboot the OS, dim, lock, and toast. Those run if a macro or the configurator fires them. They need a config session.

## Firewall (install detail)

Room-PC ufw for **one-NIC** and **two-NIC** builds lives in [`LINUX.md` §5b](LINUX.md): CIDR-scoped `8081`, fail-closed optional `8443`, no forward/bridge, no WAN port-forward. This checklist stays the short security contract; follow LINUX for copy-paste commands.

## Checklist

- Change PIN `1234` on first config login.
- Leave panel access on **Panel PIN** unless the wall tablet is a dedicated kiosk on AV-LAN.
- Leave `panelAcceptsConfigPin` off unless the same PIN must open both screens.
- Leave open LAN control off unless AV-LAN is fully trusted.
- Guest Wi-Fi on another VLAN (not AV-LAN).
- Keep `data/` off shared sticks.
- **AV-LAN** has **no default route**. **LAN (internet)** has the default route, **or** is **None** (air-gap / single-NIC; Update unavailable).
- `sysctl net.ipv4.ip_forward=0` (and IPv6 forward off). No bridge between AV and venue NICs.
- ufw: allow panel port **from AV-LAN CIDR only** — not from the venue NIC / WAN / anywhere. Do not `ufw allow 8081/tcp` from anywhere. Detail: [`LINUX.md` §5b](LINUX.md).
- Verify: `ip route`, `ss -lptn 'sport = :8081'`, `ufw status`. Listen address must be the AV IPv4 (or loopback only if no scanned NICs) — never `0.0.0.0`.
- Outbound **None** ⇒ Update from GitHub unavailable (expected); venue HTTPS also skipped.
- Optional venue HTTPS (B1): `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (or room `tlsCertPath`/`tlsKeyPath`) with outbound NIC set. Port `RELAY_HTTPS_PORT` (default 8443). Missing certs ⇒ skip venue HTTPS only — AV HTTP stays up. LE/ACME parked — not required.
- Venue peer (B3): same server PEMs + outbound NIC; HMAC peer over HTTPS; **strict trusted peer CA** (fail-closed if CA missing). Soft-skip venue peer if None/no server PEMs; AV peers unchanged.
- Device `nicFace` (B4): venue bind only when needed; soft-fail that device if None/no IPv4; no cleartext HTTP/WS on venue; Cast AV-only. Device HTTPS/TLS-WS require CA or sha256 pin on venue (`v0.9.48`). Manual samsung-pair helper strict on 8002 (`v0.9.49`).
- Phase B software checkpoint (B5): A1–A4 + B1/B3/B4 tagged at `v0.9.45`. **C1–C4 shipped** (Generate + UI + lifecycle + docs) at `v0.9.46`. **Strict peer TLS** at `v0.9.47`. **Strict device TLS** at `v0.9.48`. **Strict samsung-pair TLS** at `v0.9.49`.
- Do not port-forward the panel port to venue/WAN. Do not port-forward 8080, 8081, or 8082. Foyer (if installed) is a separate process; Foyer↔Relay occupancy is `http:` to this PC’s AV-LAN `:8081` (or loopback lab); calendar session stays loopback `:8080`. Do not put the peer secret on guest Wi-Fi.
- Do not set `RELAY_LISTEN_HOST=0.0.0.0` on a room PC.
