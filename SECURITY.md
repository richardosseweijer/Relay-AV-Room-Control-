# Security

## Report

Contact the maintainer privately. Do not file a public issue with exploit details.

## Scope

Trusted **AV-LAN** only for the cleartext panel and API. Production HTTP binds to the **AV-LAN IPv4** (never `0.0.0.0`). Dev is port 8080 (`npm run dev`). Production is port 8081 (`npm start`). HTTP on AV-LAN today (issue #15). **Shipped:** optional file-based HTTPS on the venue NIC is **B1** (when `RELAY_TLS_CERT`/`RELAY_TLS_KEY` or room `tlsCertPath`/`tlsKeyPath` are set and outbound NIC is not None), plus **B3** venue HMAC peer and **B4** `nicFace`. **Let’s Encrypt / ACME / DNS-01 is PARKED permanently** for this product shape (guest LAN, no admin DNS rights, $0, no Cloudflare/LE accounts) — do not treat LE as the default or next path. **Shipped (C1–C4):** in-box **Generate** venue CA + leaf (API + Networks UI), CA download, IP-mismatch / expiry banners, regenerate confirm, OS install hints; C4 docs consistency + checkpoint tag `v0.9.46`. **Strict peer TLS verify** (`v0.9.47`) + **strict device TLS** (`v0.9.48`) + **strict samsung-pair TLS** (`v0.9.49`): trusted peer CA; per-device CA/pin (fail-closed on venue); manual pairing helper fail-closed on 8002. Do not port-forward 8080, 8081, or 8082. A host firewall that allows the panel port only from the AV-LAN CIDR is part of the install, not optional advice. Inventory and roadmap: [Venue TLS inventory](#venue-tls-inventory-c0).

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

**Foyer control URL (fixed):** Relay production still binds HTTP to the AV-LAN IPv4 only (never `0.0.0.0`). The advertised panel / Foyer Relay URL prefers that live AV IPv4 (`controlBaseUrlFrom`; Room → Occupancy paste hint). Soft-fail when AV unset / no IPv4. Unsigned `/api/peer` GET treats TCP peer == listen host as local (same-PC hairpin), same as loopback. Lab escape only: `RELAY_LISTEN_HOST=127.0.0.1`. Do not widen listen to all interfaces. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## Venue TLS inventory (C0)

Canonical dual-NIC + venue TLS map. Prefer this section over older “LE = B2” wording elsewhere. C0 was docs-only; **C1–C3 shipped** (Generate + Networks UI + regenerate lifecycle); **C4** is the docs/hardening checkpoint (`v0.9.46`).

### Shipped (A + B through `v0.9.45`)

| Item | Behaviour |
|---|---|
| **A1** | Outbound NIC can be **None**; Update / NIC2 soft-fail when None |
| **A2** | HTTP listen pinned to **AV-LAN IPv4 only** (never `0.0.0.0`) |
| **A3/A4** | Dual-NIC docs + remaining AV bind gaps closed (~`v0.9.43` → B train) |
| **B1** | Optional HTTPS on NIC2/outbound when PEM cert+key present; soft-skip if None/no certs; **AV stays up** |
| Live IP | Networks UI shows live IPv4 for NICs (raw IP OK; no DNS/LE needed) |
| **B3** | `peerFace` `auto` \| `av` \| `outbound`; venue peers HTTPS+HMAC; soft-skip outbound/TLS; **strict peer CA verify** (fail-closed if CA missing) |
| **B4** | `nicFace` `av` \| `outbound` for device bind |
| **B5** | Inventory cleartext blocked on `nicFace=outbound`; tagged `v0.9.45` |

**Wire split:** AV cleartext HTTP (`:8081`) vs venue optional HTTPS (`:8443`) vs `nicFace`/`peerFace` bind planners. AV must not depend on venue certs.

**Current PEM drop (B1):** point `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (env wins) or room `tlsCertPath` + `tlsKeyPath` at readable PEM files on disk. **C1 Generate** writes `data/tls/venue/server.{cert,key}.pem` and wires the room paths. Missing/unreadable ⇒ soft-skip venue HTTPS only.

### PARKED (not the product path)

**Let’s Encrypt / ACME / DNS-01 / public FQDN** — parked permanently for this product shape: guest / venue LAN, no admin DNS rights, $0 budget, no Cloudflare or LE accounts. Do **not** reintroduce LE as the default story, “next” milestone, or install prerequisite.

### Shipped — C1 (in-box Generate)

| Item | Behaviour |
|---|---|
| **C1 Generate** | Admin API (`generateVenueTls` / `getVenueTlsStatus`, config-token gated) builds an **ECDSA P-256** private CA (~10y) + server leaf (~2y) with **IP SAN** = live outbound/NIC2 IPv4 |
| **Storage** | Fixed paths under `data/tls/venue/` (`ca.cert.pem`, `ca.key.pem`, `server.cert.pem`, `server.key.pem`); keys `0600`; never commit; private keys never enter room JSON export |
| **B1 wire** | Sets room `tlsCertPath` / `tlsKeyPath` to the server PEM pair (env `RELAY_TLS_*` still wins if set) |
| **Reload** | Reloads venue HTTPS listener only; AV HTTP untouched. Soft-skip when outbound None / no IPv4 |
| **Crypto** | Node `crypto` only (no openssl shell-out; no ACME/LE) |

### Shipped — C2 (Networks UI / CA download)

| Item | Behaviour |
|---|---|
| **Generate button** | Room → Networks: **Generate venue certificate** (disabled + reason when outbound None / no live IPv4) |
| **Status** | Surfaces `getVenueTlsStatus`: active?, SAN IP, leaf expiry, fingerprint (near outbound / live IP) |
| **CA download** | Same-origin `/api/venue-tls-ca` (config-token gated) serves `ca.cert.pem` only — never private keys; works after NIC2 HTTPS click-through |
| **IP mismatch** | Banner when live NIC2 IPv4 ∉ leaf SAN; prompts Regenerate (confirm UX = C3) |
| **OS hints** | Brief iOS / Android / Windows / macOS install notes next to Download CA |

### Shipped — C3 (lifecycle)

| Item | Behaviour |
|---|---|
| **Regenerate confirm** | When PEMs already present, Networks requires explicit `confirm` before replacing CA + leaf; re-issues for current live NIC2 IPv4; reloads venue HTTPS only (AV untouched) |
| **Expiry UX** | Status shows days-left; warn banner when leaf ≤30 days (or expired) with clear Regenerate path |
| **IP drift** | Strengthened mismatch banner → confirm → Regenerate with new SAN |
| **Light auto-check** | On Networks load and Refresh NICs, recompute mismatch / expiry flags — **no silent auto-reissue** |

### Shipped — C4 (docs checkpoint)

| Item | Behaviour |
|---|---|
| **C4** | Full doc consistency audit across SECURITY / LINUX / ARCHITECTURE / AGENTS / CONTEXT / KNOWN_ISSUES / README / WINDOWS / CHANGELOG / FOYER-ROADMAP; light comment hardening (LE = PARKED, not “next B2”); checkpoint package + annotated tag `v0.9.46` |

### Shipped — strict peer TLS verify (`v0.9.47`)

| Item | Behaviour |
|---|---|
| **Trust model** | Per-`relay-host` **trusted peer CA** (`peerTrustedCaPath` / PEM paste / `RELAY_PEER_TRUSTED_CA`) = the **remote room’s** Download CA PEM |
| **Happy path** | Venue peer HTTPS: `rejectUnauthorized: true` + Node `ca` = that PEM; leaf IP SAN must match peer host |
| **Fail-closed** | Missing/unreadable/non-cert CA → clear skip error (install peer CA); AV-LAN HTTP peers unchanged |
| **Exchange** | Remote Networks → Download CA → save PEM → set Trusted peer CA path on this device; same-install loop → `data/tls/venue/ca.cert.pem` |
| **Not in scope** | Let’s Encrypt; silent auto-reissue; changing Foyer; soft-verify as venue peer default |

### Shipped — strict device TLS verify (`v0.9.48`)

| Item | Behaviour |
|---|---|
| **Trust model** | Per-device **trusted CA** (`deviceTrustedCaPath` / PEM) and/or **sha256 cert pin** (`tlsFingerprintSha256`) |
| **Venue happy path** | HTTPS / tls-websocket: `rejectUnauthorized: true` + `ca`, or explicit pin checker; **fail-closed** if neither configured |
| **AV** | System trust store when no CA/pin; self-signed needs CA or pin |
| **Cast** | AV-only (blocked on `nicFace=outbound`); soft verify remains AV Cast exception only |
| **Not in scope** | LE; silent auto-reissue; huge PKI UI; bundling Google Cast CA |

### Shipped — strict samsung-pair TLS (`v0.9.49`)

Manual lab helper `scripts/samsung-pair.mjs` (not the runtime engine path) no longer soft-verifies by default on port **8002**.

| Item | Behaviour |
|---|---|
| **Trust** | `--ca=<pem>` and/or `--fingerprint=<sha256>` (`--accept-fingerprint` alias; env `SAMSUNG_PAIR_CA` / `SAMSUNG_PAIR_FINGERPRINT`) |
| **Happy path** | CA: `rejectUnauthorized: true` + `ca`; pin: pin checker (self-signed Samsung leaves) |
| **Fail-closed** | HTTPS/8002 with no trust → clear refusal (see `--help`) |
| **`--insecure`** | Discover-only: soft-connect, print leaf sha256, exit — **no pairing token**; re-run with `--fingerprint=` |
| **8001** | Cleartext `ws` (no TLS) unchanged |

Operators may still drop in file PEMs for B1. **C0–C4 closed.** **Strict peer TLS** (`v0.9.47`) + **strict device TLS** (`v0.9.48`) + **strict samsung-pair TLS** (`v0.9.49`) shipped. Foyer loopback-vs-AV URL footgun is fixed (AV live IP default + local hairpin). Residual: AV-only Cast soft TLS (Google Cast; blocked on venue).

### Doc crawl (where dual-NIC / TLS / LE lived)

| File | Role after C0 |
|---|---|
| `SECURITY.md` (this file) | Canonical trust model + inventory (Shipped C0–C4 vs PARKED LE vs residual leftovers) |
| `LINUX.md` §5b / venue HTTPS notes | Install: dual-NIC, ufw, PEM drop, Generate + NIC2 CA download click-through |
| `ARCHITECTURE.md` §2 / §8 | Process listen + access control aligned with AV HTTP vs venue HTTPS |
| `CONTEXT.md` / `AGENTS.md` | Agent map + bans: no LE default; no `0.0.0.0`; AV ≠ venue certs; C1–C4 Generate + UI + lifecycle + docs checkpoint shipped |
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
- Venue peer (B3): same server PEMs + outbound NIC; HMAC peer over HTTPS; **strict trusted peer CA** (fail-closed if CA missing). Soft-skip venue peer if None/no server PEMs; AV peers unchanged.
- Device `nicFace` (B4): venue bind only when needed; soft-fail that device if None/no IPv4; no cleartext HTTP/WS on venue; Cast AV-only. Device HTTPS/TLS-WS require CA or sha256 pin on venue (`v0.9.48`). Manual samsung-pair helper strict on 8002 (`v0.9.49`).
- Phase B software checkpoint (B5): A1–A4 + B1/B3/B4 tagged at `v0.9.45`. **C1–C4 shipped** (Generate + UI + lifecycle + docs) at `v0.9.46`. **Strict peer TLS** at `v0.9.47`. **Strict device TLS** at `v0.9.48`. **Strict samsung-pair TLS** at `v0.9.49`.
- Do not port-forward the panel port to venue/WAN. Do not port-forward 8080, 8081, or 8082. Foyer (if installed) is a separate process; Foyer↔Relay occupancy is `http:` to this PC’s AV-LAN `:8081` (or loopback lab); calendar session stays loopback `:8080`. Do not put the peer secret on guest Wi-Fi.
- Do not set `RELAY_LISTEN_HOST=0.0.0.0` on a room PC.
