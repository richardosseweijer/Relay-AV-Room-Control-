# Changelog

Format: date, then bullets. Older work lives in `git log`.

## Unreleased

## 0.9.65

- Tag `v0.9.65`. **Slider text size removed:** Pages Text size select no longer applies to `slider` widgets; panel slider face restored to fixed `text-xl` / `text-[11px]` sizing (pre-0.9.61). Normalize strips leftover `textSize` on sliders. Label/button/status/schedule textSize unchanged.

## 0.9.64

- Tag `v0.9.64`. **Text align for label/button/status:** Pages Button setup select `textAlign` (`left`|`center`|`right`, default Left — matches prior panel look) for `label`, `button`, and `status` only. Normalize fills `left` when missing/invalid ([`text-align-widget.ts`](src/lib/control/text-align-widget.ts)); editor [`pages-editor.tsx`](src/components/config/pages-editor.tsx); panel [`panel-tile.tsx`](src/components/panel/panel-tile.tsx) + [`widget-face.tsx`](src/components/panel/widget-face.tsx). Preview/image/slider/schedule unchanged.

## 0.9.63

- Tag `v0.9.63`. **Label hide when disabled:** Pages enable-when section for `label` widgets gains a **Hide when disabled** checkbox (`hideWhenDisabled`). When ticked and enable-when fails, the panel omits the label tile (no DOM / no space). Unticked (default) keeps the label visible with muted opacity — existing panels unchanged. Normalize coerces the flag on labels ([`panel-widget.ts`](src/lib/control/panel-widget.ts)); editor [`pages-enable-when.tsx`](src/components/config/pages-enable-when.tsx); panel [`panel-tile.tsx`](src/components/panel/panel-tile.tsx).

## 0.9.62

- Tag `v0.9.62`. **Panel text size height-relative:** Text size dropdown now scales glyph size from widget tile height via `cqh` (not fixed rem). Formula: usable = height × (1 − 2/16); sm/md/lg = ¼ / ½ / full of usable. Buttons use body size for the label (primary face text). Same widget set as 0.9.61 (exclude preview/image).

## 0.9.61

- Tag `v0.9.61`. **Panel text size:** Pages Button setup select `textSize` (`sm`|`md`|`lg`, default Medium) for all widget types except Preview and Image. Panel render scales chip/body/label/slider/schedule text via [`text-size-widget.ts`](src/lib/control/text-size-widget.ts); normalize fills `md` when missing/invalid.

## 0.9.60

- Tag `v0.9.60`. **ufw sudoers fix:** Ubuntu `visudo` rejects `*` wildcards in raw `ufw` argv. Install [`deploy/relay-ufw-av-lan.sh`](deploy/relay-ufw-av-lan.sh) → `/usr/local/sbin/relay-ufw-av-lan` and NOPASSWD only that helper (`deploy/sudoers.relay-ufw`). Apply calls the helper; still never Anywhere. Re-run `install-host-sudoers.sh` on appliances that pulled `0.9.59`.

## 0.9.59

- Tag `v0.9.59`. **Apply AV-LAN post-hooks:** after a successful static/DHCP Apply, soft-update **ufw** so TCP **8081** is allowed from the new AV CIDR (`comment Relay-AV-LAN`) and remove prior Relay-tagged rules; never Anywhere / `0.0.0.0/0`. Soft-update co-hosted **Foyer** `data/foyer-site.json` `relayUrl` + `foyer-kiosk.env` `FOYER_ROOM_PANEL_URL` when empty/loopback/previous AV (skip deliberate remote). Best-effort `try-restart` foyer units. IP apply still succeeds if ufw/Foyer fail — success message warns. New [`deploy/sudoers.relay-ufw`](deploy/sudoers.relay-ufw) + [`deploy/relay-ufw-av-lan.sh`](deploy/relay-ufw-av-lan.sh) → `/usr/local/sbin/relay-ufw-av-lan` via [`scripts/install-host-sudoers.sh`](scripts/install-host-sudoers.sh) (visudo rejects `*` wildcards in raw ufw argv). Lib/tests: [`scripts/av-lan-post-apply.mjs`](scripts/av-lan-post-apply.mjs). Docs: [`LINUX.md`](LINUX.md) §5b; [`FOYER-RELAY.md`](FOYER-RELAY.md) day-one checklist.

- Docs: [`LINUX.md`](LINUX.md) §5b Ubuntu Server NetworkManager — renderer switch (`99-relay-network-manager.yaml`), unmanaged reason 76, SSH/console safety on `netplan apply`, printf vs 0-byte tee footgun, dual-NIC same-subnet AV identity, DHCP IP drift for Foyer `relayUrl`, wait-online known follow-up. Checklist + troubleshooting rows aligned.
- Fix: do not sticky-stamp resolved AV-LAN IPv4 into `RELAY_LISTEN_HOST` from `with-app-env` / restart / update paths. Apply AV-LAN IP was refusing every address change because boot injected the current listen host and `listenHostConflict` treated it as an operator override. Escape hatch remains: only an explicit systemd/lab `RELAY_LISTEN_HOST` blocks Apply when it disagrees.

## 0.9.58

- Tag `v0.9.58`. **Image Borderless** option: Pages Image setup checkbox `imageBorderless` draws the tile flush without WidgetShell button chrome (no rounded border/fill). Unchecked (default) keeps the current shell look. Fit contain|cover and optional tap macro work in both modes. Color swatches hide when borderless (chrome unused), matching icon-hidden-for-image. Normalize coerces to boolean ([`image-widget.ts`](src/lib/control/image-widget.ts)); panel [`image-tile.tsx`](src/components/panel/image-tile.tsx); editor [`pages-image-fields.tsx`](src/components/config/pages-image-fields.tsx).

## 0.9.57

- Tag `v0.9.57`. **Image page widget** end-to-end (#155–#158 + docs MR5). Static tile on the panel grid: host media under `data/media/`, fit `contain`|`cover`, optional tap macro. Docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) widget row + file map; [`CONTEXT.md`](CONTEXT.md) Where-to-look (`image-tile`, `pages-image-fields`, `media-store`, `/api/media`). FOYER-RELAY untouched (Relay-only widget).
- **MR1 — types + normalize** (#155): `WidgetType` `"image"` with `imageSrc?` / `imageFit?` (`contain`|`cover`); `normalizeImageFields` in store-normalize ([`image-widget.ts`](src/lib/control/image-widget.ts)).
- **MR2 — host media store** (#156): [`media-store.ts`](src/lib/control/media-store.ts) PNG/JPEG/WebP allowlist (~2 MB, magic-byte sniff, SVG denied); `POST /api/media` (config), `GET /api/media/:id` (panel|config), `DELETE` config-only; files gitignored under `data/media/`.
- **MR3 — panel tile** (#157): [`image-tile.tsx`](src/components/panel/image-tile.tsx) via WidgetShell; Bearer fetch → blob URL (bare `<img src>` cannot auth); empty `imageSrc` → “No image”; optional tap mirrors preview.
- **MR4 — pages editor** (#158): [`pages-image-fields.tsx`](src/components/config/pages-image-fields.tsx) upload/clear, picture fit, optional tap macro; wired in pages editor (color swatches kept; icon picker hidden for image).
- Meta (I5): `package.json` `"engines": { "node": ">=22" }` + `.nvmrc` (`22`); LINUX.md §2 note. No `engine-strict`.
- Also on main since `v0.9.56`: Networks NIC section card chrome (#153); `install-host-units` `RELAY_SVC_USER=pi` after unit render (#154); FOYER-RELAY I1/I2 sync bullets (#151–#152).

## 0.9.56

- Tag `v0.9.56`. **I4 — install-host-units preflight:** before any write / `daemon-reload` / enable, [`scripts/install-host-units.sh`](scripts/install-host-units.sh) checks `/usr/bin/npm`, Node major ≥ 22 on unit PATH (`/usr/bin:/usr/local/bin`), and `.vercel/output/nitro.json` from `npm run build`. Clear failure points at LINUX.md §2 / §5 (nvm caveat). `--skip-preflight` escape hatch. Lib: [`scripts/install-host-preflight.sh`](scripts/install-host-preflight.sh); tests: [`scripts/install-host-preflight.test.mjs`](scripts/install-host-preflight.test.mjs). Docs: [`LINUX.md`](LINUX.md) §6a.
- Docs (I3): cross-ref hygiene (FOYER Day-one §4/§5/§6a; LINUX §6 build-before-units); `ffmpeg` note in §3; uninstall appendix §10; neutral `RELAY_USER=ubuntu` examples.
- Docs (I2): [`LINUX.md`](LINUX.md) first-run footguns + trim — clone-if-missing (no `rm -rf`), listen-host / dual-NIC AV check, demote manual unit tee to `deploy/` templates, move venue-TLS inventory narrative to [`SECURITY.md`](SECURITY.md#venue-tls-inventory-c0).
- Docs (I1): Ubuntu Server prerequisites in [`LINUX.md`](LINUX.md) — NetworkManager + netplan for Apply AV-LAN IP (§5b); Chromium snap + universe for Relay HDMI kiosk (§7b).

## 0.9.55

- Tag `v0.9.55`. **K7 (Relay) — host systemd unit installer:** [`scripts/install-host-units.sh`](scripts/install-host-units.sh) installs `/etc/systemd/system/relay.service` + `relay-kiosk.service` from [`deploy/`](deploy/) with `User=` / checkout-path substitution (`RELAY_USER` / `SUDO_USER` / …), `daemon-reload`, enables **`relay`** only; **`relay-kiosk` stays disabled by default** (`--enable-kiosk` for Relay-only HDMI — Foyer dual-head must leave it off). Thin [`scripts/install-host.sh`](scripts/install-host.sh) chains units + [`install-host-sudoers.sh`](scripts/install-host-sudoers.sh). [`deploy/relay.service`](deploy/relay.service) uses `USER` placeholders (no hard-coded `pi`). Docs: [`LINUX.md`](LINUX.md) §6a preferred path, §7c, checklist / post-Update. Residual: **K7b** Foyer units installer; **K8** hygiene.

## 0.9.54

- Tag `v0.9.54`. **K6 — disable relay-kiosk on Local display uncheck:** Room → Local display Save with Enable unchecked runs `systemctl disable --now relay-kiosk` (bare, then `sudo -n`), so the unit cannot fight Foyer dual-head after save-off. Reuses K1 error classifier (LINUX.md §7 / `scripts/install-host-sudoers.sh`). Extend [`deploy/sudoers.relay-kiosk`](deploy/sudoers.relay-kiosk) with `enable --now` / `disable --now`. Docs: [`LINUX.md`](LINUX.md) §7a; [`FOYER-RELAY.md`](FOYER-RELAY.md) day-one + operator setup. Tests: disable argv, sudoers failure messages.

- Docs (K5): single **Day-one dual-head (same host)** checklist in [`FOYER-RELAY.md`](FOYER-RELAY.md) (byte-identical with Foyer); [`LINUX.md`](LINUX.md) §7a points “start here”. Docs-only; no version bump.

- Ops (K1+K2): [`scripts/install-host-sudoers.sh`](scripts/install-host-sudoers.sh) installs `/etc/sudoers.d/relay-kiosk` + `/etc/sudoers.d/relay-nmcli` from [`deploy/sudoers.relay-kiosk`](deploy/sudoers.relay-kiosk) + new [`deploy/sudoers.relay-nmcli`](deploy/sudoers.relay-nmcli) (USER substitute, mode 0440, `visudo -cf` pre/post; root required). [`LINUX.md`](LINUX.md) §5b / §7c / §8 point at the script; Update/pull/reboot still do **not** install host drop-ins. No app/code change; no version bump.

- Docs (K0): [`LINUX.md`](LINUX.md) header version **0.9.53** (match package); dual-head / disable `relay-kiosk` narrative stays §7a (shared with Foyer [`FOYER-RELAY.md`](FOYER-RELAY.md)). No app/code change; no version bump.

- Docs: [`LINUX.md`](LINUX.md) §7c callout that **pull / Update from GitHub / reboot do not install** `/etc/sudoers.d/relay-kiosk` (one-time host step; re-run if `User=` changes); §8 post-update checklist for both `relay-nmcli` and `relay-kiosk` drop-ins. No app/code change; no version bump.

## 0.9.53

- Tag `v0.9.53`. **Relay HDMI kiosk restart sudoers:** Room → Local display saves `data/relay-kiosk.env` then restarts `relay-kiosk.service`. Bare `systemctl` hits polkit (“interactive authentication”); without `/etc/sudoers.d/relay-kiosk` the UI only showed that raw error. Now classify auth/sudo failures and point at LINUX.md §7; keep `sudo -n systemctl …`. Extend `deploy/sudoers.relay-kiosk` with start/stop/restart/try-restart/status/is-active/enable/disable (unit only — never NOPASSWD ALL). Docs: install with `chown root:root`, `chmod 0440`, `visudo -cf`. Relay-only HDMI operators need the drop-in; Foyer dual-head still leaves the unit off (§7a).
- Tests: polkit/missing-sudoers → clear LINUX.md hint; sudoers allowlist verbs.

## 0.9.52

- Tag `v0.9.52`. **Fresh-install AV-LAN auto-map:** when Room → AV-LAN is unset/blank/invalid, Relay maps to the **first scanned NIC** (same Networks scan; prefer physical eth/en* over docker/veth/bridges; fall back to virtual only if that is all that exists), **persists** the pick (outbound/NIC2 untouched), and binds HTTP panel/API to that IPv4. Valid saved AV-LAN is left alone. If the chosen iface has no IPv4 yet, boot logs clearly and waits/retries — never binds `0.0.0.0`. No scanned NICs → loopback + warning (lab). Docs: LINUX Networks / listen resolution; AGENTS / ARCHITECTURE / SECURITY / CONTEXT / KNOWN_ISSUES.
- Tests: empty → first scanned; invalid → first scanned; valid saved unchanged; skip lo/docker preference; persist write.

## 0.9.51

- Tag `v0.9.51`. **Local HDMI panel kiosk** (Linux): Room → Local display lists DRM outputs, saves `panelHdmiEnabled` / `panelHdmiOutputName` / `panelHdmiOutputIndex` + `data/relay-kiosk.env` (`RELAY_VIDEO_OUTPUT` / `RELAY_KIOSK_URL`), restarts `relay-kiosk.service` (cage + Chromium). Kiosk URL is the live AV-LAN panel root — never `0.0.0.0`. Docs: LINUX §7, WINDOWS Linux-only note. Tests: DRM fixture, resolve, env body, restart argv, URL builder.
- Also notes **Apply AV-LAN IPv4** from #133 (landed on `0.9.50` without a ticker): Room → Networks static/DHCP via nmcli; confirm + Config PIN; persist `room.network` then restart Relay.

## 0.9.50

- Tag `v0.9.50`. Version ticker / docs checkpoint after #131 (Foyer↔Relay AV-LAN occupancy contract sync). Same Foyer pair (`v0.2.2`). Wire unchanged. No LE/ACME; Cast soft verify still AV-only.
- Docs: sync [`FOYER-RELAY.md`](FOYER-RELAY.md) with Foyer main (Foyer #2/#3) — occupancy is AV-LAN HTTP (`http://<AV-IPv4>:8081`), not loopback-only; pair table Relay **0.9.47+** / Foyer rewrite-on-load + `http:` allowlist. Calendar session pull stays `http://127.0.0.1:8080`. LINUX / SECURITY / CONTEXT stop saying Foyer↔Relay occupancy must be loopback-only.
- Version lockstep: `package.json` / lockfile, Configurator chip, README / ARCHITECTURE / CONTEXT / WINDOWS / CHANGELOG.

## 0.9.49

- Tag `v0.9.49`. **Strict samsung-pair.mjs TLS** — closes the residual soft `rejectUnauthorized: false` footgun on the manual Samsung Tizen pairing helper (not the runtime device path; that was already strict in `v0.9.48`). Same Foyer pair (`v0.2.2`). No LE/ACME; Cast soft verify still AV-only.
- **Trust model:** `--ca=<pem>` and/or `--fingerprint=<sha256>` (aliases `--accept-fingerprint`, env `SAMSUNG_PAIR_CA` / `SAMSUNG_PAIR_FINGERPRINT`). Port **8002** fail-closed when trust missing. Explicit `--insecure` is **discover-only** (prints leaf sha256, exits; no token) — re-run with `--fingerprint=` to pair. Soft TLS is not the pairing happy path.
- Docs: SECURITY / LINUX / WINDOWS mention the helper; AGENTS / ARCHITECTURE / CONTEXT / KNOWN_ISSUES / README / CHANGELOG version lockstep.
- Tests: `scripts/samsung-pair-trust.test.mjs` (parse, fail-closed, CA, pin, discover, env).

## 0.9.48

- Tag `v0.9.48`. **Strict third-party device HTTPS / TLS-WebSocket verify** — closes the remaining soft `rejectUnauthorized: false` footgun on venue (and general) device HTTPS. Peer path already strict in `v0.9.47`. Same Foyer pair (`v0.2.2`). No LE/ACME; no silent auto-reissue.
- **Trust model:** per-device `deviceTrustedCaPath` / PEM paste and/or `tlsFingerprintSha256` pin. Venue (`nicFace=outbound`) HTTPS/TLS-WS **fail-closed** when trust missing (“configure device CA / pin”). Happy path: `rejectUnauthorized: true` + Node `ca`, or explicit sha256 pin (pin checker enforced on connect). AV without CA/pin uses the system trust store (self-signed needs CA or pin).
- **Cast:** AV-only — blocked on `nicFace=outbound` (Google Cast TLS cannot use a normal operator CA). Soft verify remains the documented AV Cast exception only.
- Devices UI: **Device trusted CA path** + **Device cert sha256 pin** next to NIC face. Docs: SECURITY / LINUX / AGENTS / ARCHITECTURE / CONTEXT / KNOWN_ISSUES / CHANGELOG / README.
- Tests: planner fail-closed; CA success / reject wrong CA; pin success / mismatch (`device-tls-verify.test.mjs`).

## 0.9.47

- Tag `v0.9.47`. **Strict peer TLS verify** for venue HMAC peers — closes the soft `rejectUnauthorized: false` footgun on the Relay↔Relay path. Same Foyer pair (`v0.2.2`). No LE/ACME; no silent auto-reissue; Foyer control-URL footgun left as already fixed on main.
- **Trust model:** per-`relay-host` trusted peer CA (`peerTrustedCaPath` / PEM paste / `RELAY_PEER_TRUSTED_CA`) = remote room’s **Download CA** PEM. Venue peer happy path: `rejectUnauthorized: true` + Node `ca`. **Fail-closed** with a clear install-peer-CA error when CA missing/unreadable. AV-LAN HTTP peers unchanged. Same-install loop: `data/tls/venue/ca.cert.pem`. Venue peer TLS failure soft-fails that peer only — AV control stays up.
- Devices UI: **Trusted peer CA path** next to Peer face. Docs: SECURITY / LINUX / AGENTS / ARCHITECTURE / CONTEXT / KNOWN_ISSUES / CHANGELOG aligned (remove “soft verify until LE” as the standing peer story).
- Tests: planner strict success + fail-closed; live HTTPS verify against test CA; reject wrong CA (`peer-tls-verify.test.mjs`).

## 0.9.46 — 2026-09-23
- Tag `v0.9.46`. Venue TLS **C4** docs/hardening checkpoint — closes in-box venue TLS train C0–C4. Same Foyer pair (`v0.2.2`). No LE/ACME; no silent auto-reissue; no strict peer TLS verify.
- **C4:** full doc consistency audit (SECURITY / LINUX / ARCHITECTURE / AGENTS / CONTEXT / KNOWN_ISSUES / README / WINDOWS / CHANGELOG / FOYER-ROADMAP). Current-state sections now say C1–C3 Generate / UI / lifecycle **shipped**; C4 checkpoint **shipped**; LE **PARKED** (not “B2 next”). Light comment hardening: leftover “until B2 LE” / “B2 deferred” strings aligned to PARKED. Residual known: Foyer loopback URL vs AV-only listen; soft `rejectUnauthorized: false` (optional strict peer verify not implemented).
- **Venue TLS C3 (lifecycle):** Networks **Regenerate** requires explicit confirm before replacing CA/leaf; re-issues for current live NIC2 IPv4 and reloads venue HTTPS only (AV untouched). Expiry UX shows days-left and warns at ≤30 days / expired with a clear Regenerate path. Strengthened IP-drift mismatch → confirm → Regenerate. Light auto-check on Networks load + Refresh NICs recomputes mismatch/expiry flags — **no silent auto-reissue**.
- **Venue TLS C2 (Networks UI):** Room → Networks **Generate venue certificate** (disabled + reason when outbound None / no live IPv4); status from `getVenueTlsStatus` (active / SAN IP / expiry / fingerprint); same-origin **Download CA** via `/api/venue-tls-ca` (config-token; `ca.cert.pem` only); IP-mismatch banner when live NIC2 IPv4 ∉ leaf SAN; brief iOS/Android/Windows/macOS CA install hints.
- **Venue TLS C1 (Generate):** in-box ECDSA P-256 venue CA (~10y) + leaf (~2y) with IP SAN for live NIC2/outbound IPv4 via Node `crypto` (no openssl shell-out; no ACME/LE). PEMs at `data/tls/venue/` (keys `0600`); room `tlsCertPath`/`tlsKeyPath` auto-wired; venue HTTPS reload without touching AV HTTP; soft-skip when outbound None / no IPv4. Admin API `generateVenueTls` / `getVenueTlsStatus` (config-token gated).
- **Docs C0 (venue TLS inventory):** crawl dual-NIC / venue TLS / certs / LE / listen-bind docs; correct drift vs shipped A+B (`v0.9.45`). **LE/ACME/DNS-01 marked PARKED** (not deferred B2 / not default). C0 itself was docs-only. Canonical section: [`SECURITY.md` Venue TLS inventory](SECURITY.md#venue-tls-inventory-c0).

## 0.9.45 — 2026-09-23
- Tag `v0.9.45`. Phase B software checkpoint (B5): hardening audit + docs/tests alignment. B2 Let’s Encrypt / ACME / FQDN remains deferred. Same Foyer pair (`v0.2.2`). Foyer loopback vs AV-only bind foot-gun documented, not fixed.
- B5 hardening: inventory `httpPath` cleartext on `nicFace=outbound` returns a pointed error; soft-skip / nicFace / peerFace coverage kept green. Docs: SECURITY / LINUX / ARCHITECTURE / CONTEXT / KNOWN_ISSUES / CHANGELOG aligned with A+B (raw IP OK; `rejectUnauthorized: false` for file PEMs until LE).
- NIC-split B4: per-device `nicFace` (`av` | `outbound`, default `av`) for device I/O bind. Venue soft-fails when outbound None / no IPv4. No cleartext HTTP/WS on venue; sACN / ipMIDI multicast stay AV-only. `peerFace` (B3) unchanged for HMAC peers. No ACME (B2).

## 0.9.44 — 2026-09-23
- Networks UI: show live DHCP IPv4 next to LAN (internet) / AV-LAN pickers (read-only; Refresh NICs). No LE/ACME.
- NIC-split B3: HMAC peer over venue/NIC2 HTTPS (outbound bind + soft-skip when outbound None / no TLS PEMs). AV-LAN HTTP peers unchanged. Narrow `peerFace` on relay-host (auto / av / outbound). No ACME (B2). B4 nicFace shipped in 0.9.45.
- NIC-split B1: optional HTTPS listener on outbound/venue NIC IPv4 (file certs via `RELAY_TLS_CERT`/`RELAY_TLS_KEY` or room `tlsCertPath`/`tlsKeyPath`; default port 8443). Soft-skip when outbound is None or certs missing — AV HTTP unchanged. No ACME/LE (B2 deferred; tagged with B5 at 0.9.45).

## 0.9.43 — 2026-09-23
- NIC-split A4: pin UDP multicast listen, ping, and RPC shutdown to AV-LAN when configured; refresh nics Phase-0 header.

## 0.9.42 — 2026-09-23
- Tag `v0.9.42`. Same Foyer pair (`v0.2.2`). Wire unchanged for occupancy.
- NIC-split A1: outbound **None** — Update refuses without a venue/internet NIC (#113).
- NIC-split A2: HTTP panel/API listen pinned to AV-LAN IPv4; never `0.0.0.0` (#114).
- NIC-split A3: install/security/architecture docs match dual-NIC trust model + A1/A2 (this train). HTTPS/LE venue = Phase B (not shipped).
- God-file splits (façade-preserving): store leaves drivers/secrets/persist/normalize/monitors/schedules (#96–#101); panel tiles/pin/locked/widget (#102–#105); pages status/preview/enable/bind (#106–#109). No behaviour change.

## 0.9.41 — 2026-09-23

- Tag `v0.9.41`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Anti-vibecode poll/persist/monitor hygiene after v0.9.40: dirty-bit clear-before-flush, session slide persist throttle, validTokenAny, normalize memo, panel snap fingerprint, Map eviction, toggle/docs, parallel monitors (#87–#94).
- Status traffic-light `colorWhen` + `statusDefault` (#86).
- Panel `fireMacro` drains `triggerQueue` after macro (#85).

## 0.9.40 — 2026-09-22

- Tag `v0.9.40`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- ChatGPT extras after v0.9.39: secret backup gitignore, peerSecret import keep, OSC/sACN slider value, sliding session persist, paced concurrent sends, gateway monitor mapping, sACN universe merge (#77–#83).

## 0.9.39 — 2026-09-22

- Tag `v0.9.39`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Security train after v0.9.38: F2 serial allowlist, F1 LAN HTTP authority, F3 LAN gates, F4 secrets reload on verifyConfigPin, F5 vars PUT clamp, F6 peer macro-only, F7 session missing exp, F8 room lastError scrub (#68–#75).

## 0.9.38 — 2026-09-22

- Tag `v0.9.38`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Control plane Track B: engine split into wire/LAN/host leaves (#62–#64); slim orchestration façade (#65). No behaviour change.

## 0.9.37 — 2026-09-22

- Tag `v0.9.37`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Control plane Track A: shared `loadControl()` (#59); `actions` split into auth/config/runtime/host modules with a barrel façade (#60). No behaviour change.

## 0.9.36 — 2026-09-22

- Tag `v0.9.36`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Security hardening pass (backend foot-guns): expired config sessions rejected on `/api/ping`; durable weak-PIN force-change; unlock routes share `mint()`; `scrubSecret` aligned with `isSecretKey`; `/api/room` uses shared `validToken`; corrupt secrets JSON fails closed; `/api/vars` requires peer HMAC when a key is set; timing-safe plaintext PIN compare on the legacy path.

## 0.9.35 — 2026-09-22

- Tag `v0.9.35`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: Biamp Nexia PM (NTP Telnet :23). Mic 1–4, line 1–6, out 1–6, preset recall. Tag blocks MicIn / LineIn / LineOut in Nexia.
- Library: Nexia PM expanded — 4 mic + 12 stereo-line (six RCA pairs) + 6 out, all NTP GETD/SET (gain, level, mute, phantom, invert, gang, output FS). Preset recall 1001–1040. System GET IP/MAC/DEVID. Line count was 6 (hardware is 12). Destructive CLEAR/RESET/IP SET omitted. Re-apply the driver from the library on rooms that already have a Nexia copy.

## 0.9.34 — 2026-09-20

- Tag `v0.9.34`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: Mitsubishi UD8900U PJLink Class 1 (TCP 4352). Inputs Computer 1/2, Video, S-Video, HDMI, DVI, SDI. Default password `admin`.

## 0.9.33 — 2026-09-20

- Tag `v0.9.33`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider: drag on the whole tile again (capsule was the only hit target). Fill meets the knob centre, not the far edge. Pointer-only — no touch handlers fighting Chrome.

## 0.9.32 — 2026-09-20

- Tag `v0.9.32`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- MPS 602 library: Mic volume (`16*{n}G`, 0–60 dB), mute/unmute mic (`1M` / `0M`), plus poll `16G` / `M`. Program `{n}V` / `Z` unchanged. Re-apply the driver from the library on rooms that already have an MPS copy.

## 0.9.31 — 2026-09-20

- Tag `v0.9.31`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider knob is the same size as the bar. 0 / max are when the knob edges meet the capsule ends.

## 0.9.30 — 2026-09-20

- Tag `v0.9.30`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider Direction default Auto: upright when the tile is taller than wide. Horizontal / Upright still lock.

## 0.9.29 — 2026-09-20

- Tag `v0.9.29`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Capsule slider: fill via flex (no `%` calc), knob not clipped by `overflow`, touch handlers for Android Chrome.

## 0.9.28 — 2026-09-20

- Tag `v0.9.28`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider is a capsule bar: widget-colour fill, dark remainder, white knob. Inset on the tile; knob stays inside the pill at 0 and max. Upright is the same capsule stood on end.

## 0.9.27 — 2026-09-20

- Tag `v0.9.27`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider is a thin bar + small dot, with a hairline that travels across the tile. Travel stays inset (~22px) so 0 and max are not on the edge.

## 0.9.26 — 2026-09-20

- Tag `v0.9.26`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Landscape panel uses the full window width (dropped `max-w-3xl` gutters).

## 0.9.25 — 2026-09-20

- Tag `v0.9.25`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Slider tiles: filled track in the widget colour, round knob. Pages inspector **Direction**: Horizontal or Upright (mixer fader). Old rooms stay horizontal.

## 0.9.24 — 2026-09-20

- Tag `v0.9.24`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview label chip hugs the text (it was stretching the full tile height).

## 0.9.23 — 2026-09-20

- Tag `v0.9.23`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Hide scrollbars (still scroll with wheel / trackpad / touch).

## 0.9.22 — 2026-09-20

- Tag `v0.9.22`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Pages inspector: Preview fields sit in a Stream box at the top of the side panel (sticky, scrollable). Header shows `Configurator · 0.9.22` so a stale Config tab is obvious.

## 0.9.21 — 2026-09-20

- Tag `v0.9.21`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview tile settings: RTSP transport (auto / UDP / TCP), behind-live seconds (default 1.2, match I-frame interval), fit vs fill. Still copy remux. Old rooms keep the previous defaults.

## 0.9.20 — 2026-09-20

- Tag `v0.9.20`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Panel face follows the window (`innerHeight > innerWidth`), not CSS `orientation` — iPad was showing the landscape page in portrait and the reverse.

## 0.9.19 — 2026-09-20

- Tag `v0.9.19`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: restart ffmpeg when the picture stalls (no first frame in 15 s, or no progress for 5 s) or the decoder errors. Changing ZowieBox stream settings used to leave the old RTSP session running (black / stuck).

## 0.9.18 — 2026-09-20

- Tag `v0.9.18`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview black screen on ZowieBox Main Profile / I-frame 30: tile was seeking 120 ms behind live (mid-GOP). Catch-up is now 1.2 s behind, and only if more than 2.5 s late. SourceBuffer codec is read from `avcC`. SPS/PPS repeated on keyframes (`dump_extra`). Copy remux kept.

## 0.9.17 — 2026-09-20

- Tag `v0.9.17`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: drop the 0.9.16 `libx264` ultrafast encode. Back to `-c:v copy` plus the 0.9.15 probe/muxdelay/120 ms tile buffer.

## 0.9.16 — 2026-09-20

- Tag `v0.9.16`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: if `libx264` is present, remux is now `ultrafast` / `zerolatency` / GOP 10 (~0.3 s at 30 fps) at 1.2 Mbps. Copy if that encoder is missing. Tile keeps ~80 ms. Still four streams max. i3 + LAN has the CPU; this is the remaining delay that copy could not cut.

## 0.9.15 — 2026-09-20

- Tag `v0.9.15`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview latency: smaller ffmpeg probe (`32 KiB` / `0.5 s`), `muxdelay 0`, flush each packet. Tile keeps ~120 ms of MSE buffer instead of 2 s. Copy remux still waits on the next keyframe (GOP), no extra encode.

## 0.9.14 — 2026-09-20

- Tag `v0.9.14`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: drop `-localaddr` unless that ffmpeg lists it, drop `separate_moof` / `reset_timestamps` / `-nostdin` (those were `ffmpeg flags` on the Pi). Tile lists steps: url, ffmpeg version, encoder host:port open/closed, each UDP/TCP try with the rejected option name.

## 0.9.13 — 2026-09-20

- Tag `v0.9.13`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: bound ZowieBox uses `rtsp://IP:554/sub/av` (the box’s own URL), not :8554. ffmpeg drops `prefer_tcp` / `allowed_media_types` (those printed `ffmpeg flags` on the Pi). Tries UDP then TCP with `-rtsp_transport` only.

## 0.9.12 — 2026-09-20

- Tag `v0.9.12`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Preview: RTSP uses `prefer_tcp` (UDP fallback) instead of TCP-only — VLC-ok streams on `:554` that do not interleave RTP over TCP were showing `no signal`. Tile SourceBuffer codec is High-profile first so Main/High H.264 paints. Routed RFC1918 no longer pins the wrong NIC for 4s.

## 0.9.11 — 2026-09-20

- Tag `v0.9.11`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Each UI page has a landscape grid and an optional portrait grid. Same widgets (bind, label, preview URL). Portrait cell is `widget.portrait`; missing = hidden on that face. Old rooms without `portraitGrid` still show landscape on a phone. Pages editor: Landscape / Portrait toggle, Copy from landscape.

## 0.9.10 — 2026-09-17

- Tag `v0.9.10`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Library: `zowietek-zowiebox.json` (HTTP :80 ZowieAPI). Encoder control, internet publish 0–3, record USB/SD/NAS, tally, HDMI output presets, digital zoom, PTZ on an attached camera. Local RTSP is not toggled. Encode bitrate POST omitted (it replaces the whole venc blob).
- Optional Preview widget: host `ffmpeg` remuxes RTSP (ZowieBox `rtsp://IP:8554/sub/av`, 720p H.264, `-c:v copy`) to fMP4 for a panel `<video>` tile. No extra npm. Missing ffmpeg shows `ffmpeg?`. Cap four streams. Drop the files listed at the top of `src/lib/control/preview-grab.ts` to remove it. No ffmpeg timeout flag (those differ by version and yielded 0 bytes). Wait for the first remux byte before HTTP 200. Tile shows the API error (e.g. `Bad stream URL`) instead of a blank `no signal`. ffmpeg binds AV-LAN (`-localaddr`) when the dest is on that subnet, else the other adapter. Tile is any grid size; `object-contain` keeps stream aspect ratio.

## 0.9.9 — 2026-09-14

- Tag `v0.9.9`. Same Foyer pair (`v0.2.2`). Occupancy GET strings unchanged.
- Trigger panes rebuilt: If / and / on-change-or-interval / one macro. Same engine.
- Room tab occupancy dropdown removed (it overwrote live occupancy on Save). Occupancy var is `0` closed, `1` open, `2` in session, `3` DND. Foyer GET still reads string `occupancy`.
- `FOYER-RELAY.md` identical with Foyer. Architecture lists trigger panes and occupancy `0`–`3`.



## 0.9.8 — 2026-09-14

- Tag `v0.9.8`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Phase 0 tidy: remove dead `resetDemo`. Empty / wipe room is Relay host on localhost only (no conference demo, no fake TV/amp state). Empty `data/drivers/` seeds `relay-host.json` only. Drop joke driver. Write `home-assistant.json` to disk.
- Stock drivers live in `data/library/` (`index.json` for search). `data/drivers/` is this room’s working set. Add copies one spec in; Remove unlinks that copy. Library update does not rewrite room files.
- Deleted `extra-drivers.ts` and the compiled demo specs in `defaults.ts`. Stock is JSON in `data/library/` only. `defaults.ts` keeps empty-room config and last-resort `relayHostDriver`.
- Boot working set is devices + host + JSON already in `data/drivers/`. Old `relay-room.json` catalog blobs are not copied back from the library. Add keys through `safeDriverName`. Empty-folder host seed prefers `data/library/relay-host.json`.
- Removed unused server fns (`testDevice`, `exportBundle`, `issuePanelSession`, `checkPanelSession`), unused `probeDevice`, dead helpers (`isUserMacro`, `isFoyerVar`, `stopMidiWatchers`, `isLoopbackRequest`), and stub `client.ts`. Probe button still uses `pingDevice`.


## 0.9.7 — 2026-09-14

- Tag `v0.9.7`. Same Foyer pair (`v0.2.2`). Wire unchanged.
- Engine: `allowedLanHost`, `scrubSecret`, traces, `sleep` in `engine-policy.ts`. Payload tokens, `valueMap`, parse, and inventory JSON parse in `engine-payload.ts`. `engine.ts` remains the barrel (`sendLan`, TCP sessions, monitors, macros). Callers still import `engine.ts`.
- Protocol adapter tests pin `sendLan` / `statusPlane` / `readMonitorValue` by function, not by the next neighbor.

## 0.9.6 — 2026-09-13

- Tag `v0.9.6`.
- Pair Foyer `v0.2.2`.
- Panel: park the portrait 2-column reflow. The room page uses the authored grid on phone and tablet. Equal row tracks so empty cells stay empty and same-span buttons share height.
- Peer GET: unsigned only from TCP loopback (not Host/XFF). Unsigned body is occupancy + `host.locked`. HMAC GET still the full snapshot. Calendar poll unchanged.
- Stop tracking sandbox dumps that `.gitignore` already listed: `artifacts/` (stale engine, tarball, Imagine JPEG), `attachments/`, `.grok/`. Drop App Builder `screenshots/app-builder-*`.

## 0.9.5 — 2026-09-13

- Tag `v0.9.5`.
- Drop unused `occupancyVarId`, `harness.ts`, `src/lib/db.ts` / `migrations/` / `db:migrate`, stale `public/drivers/`, executed agent roadmaps (`CONFIG-SPLIT`, `DRIVER-PAGE`, `PASTEL-THEME`).
- Security copy/generate toasts name Foyer Setup. Wire unchanged: [`FOYER-RELAY.md`](FOYER-RELAY.md).

## 0.9.4 — 2026-09-13

- Tag `v0.9.4`.
- Relay reads Foyer’s current (or next) calendar session over loopback `GET http://127.0.0.1:8080/api/peer` into baked vars `foyer.kind` / `foyer.title` / `foyer.start` / `foyer.end`. Poll every 4 s. Non-loopback Foyer URLs fail closed.
- Occupancy GET on loopback is unsigned so Foyer Auto follows the Room tab / Occupancy commands even if the pasted peer secrets differ. HMAC still required for POST macros. Foyer occupancy poll is still Foyer → Relay (no occupancy POST).

## 0.9.3 — 2026-09-13

- Tag `v0.9.3`.
- Occupancy is first-class (`room.occupancy`) plus a baked list var `occupancy` (`available` / `in-session` / `busy` / `do-not-disturb` / `closed`). Foyer HMAC GET `/api/peer` reads `occupancy` only. Room names do not need to match. No occupancy-variable picker. Foyer is not a Relay device this pass.

## 0.9.2 — 2026-09-13

- Tag `v0.9.2`.
- MPS 602: tagged SIS is ESC…CR (`ESC 0LS CR`, `ESC nAUSW CR`), not the literals `E 0LS}` / `E 0AUSW}`. TCP timeout 8s. Regex accepts `Sig1 0…` and `Sig 1*0*…`.

## 0.9.1 — 2026-09-13

- Tag `v0.9.1`.
- Room tab: **Networks** and **Occupancy / Foyer** cards. Refresh NICs. Peer-secret help names Foyer on loopback.

## 0.9.0 — 2026-09-13

- Tag `v0.9.0`. Versions are three-part from here (`major.minor.patch`). No fourth ticker.
- Room tab: **AV-LAN** and **LAN (internet)** NIC pickers (Foyer `f6abb8e` list: Node A–Z, 0-based, em dash). Same NIC allowed.
- Device sockets bind AV-LAN `localAddress`. GitHub update refuses if the outbound NIC has no IPv4.
- Occupancy (`available` / `in-session` / `busy` / `closed`) plus host `occupancy.*`. `GET /api/peer` emits `v:1`, `room:{id,name}`, `occupancy`, and vars.
- Foyer is optional. No Foyer poller. HMAC stays loopback.

## 0.8.3.5 — 2026-09-13

- Tag `v0.8.3.5`.
- MPS 602: poll SIS `E 0LS}` into `signal.1`…`signal.6` (VGA/HDMI/DTP sync present).

## 0.8.3.4 — 2026-09-12

- Tag `v0.8.3.4`.
- LAN adapters: OSC UDP, sACN (E1.31 multicast), ipMIDI (multicast MIDI), RTP-MIDI (AppleMIDI). USB MIDI is `local.kind` `midi` via `amidi`.
- Library drivers: `osc-udp.json`, `sacn-universe.json`, `usb-midi.json`, `ipmidi.json`, `rtp-midi.json`.
- MIDI in / MTC: `midiWatch` on the driver writes existing feedback ids. Send-only first.

## 0.8.3.3 — 2026-09-11

- Tag `v0.8.3.3`.
- PIN fields stay masked (`type=password`) and request a numeric keypad (`inputMode=numeric`, digits only). Closes #33; supersedes #35.
- Library driver `Driver-voor-christiaans-kut-TV.json`: QE77S95D with power toggle only (no WOL on/off, no app inventory).

## 0.8.3.2 — 2026-09-11

- Tag `v0.8.3.2`.
- Library driver `samsung-tizen.json` (generic Tizen IP remote). Q65T and S95D stay as model copies.

## 0.8.3.1 — 2026-09-11

- Tag `v0.8.3.1`.
- Poll uses `driver.status` only (no feedback `httpPath` GET on port 8001). Sonos/HA monitors go through `sendLan`.
- HTTP path and headers fill `{token}` / `{auth.*}`. Pairing name/token win over `lan.query`.
- Cast `GET_STATUS` returns JSON matching driver parse. Engine no longer peeks `PowerState` / `displayName`.
- Hue feedback: GET `/api/{auth.token}/groups/0`. WOL missing-MAC copy is generic.

## 0.8.3.0 — 2026-09-11

- Tag `v0.8.3.0`.
- LAN I/O split: generic `ws.ts`, `cast.ts`, `pjlink.ts`, `wol.ts`. Websocket path/query/handshake/alsoSend come from driver JSON. Unknown protocol fails closed.
- Sony ADCP `NOKEY` retry is `session.reply` on the driver.

## 0.8.2.10 — 2026-09-11

- Tag `v0.8.2.10`.
- Generic WebSocket: handshake and extra frames live in driver JSON (`lan.handshake`, command/inventory `alsoSend`). Engine no longer special-cases Samsung keys or port 8002.
- `driver-check`: websocket path + handshake; pairing steps; inventory parse fields.
- Seed S95D, Home Assistant, Sonos S1/S2, and ZonePlayer in extra-drivers. ZonePlayer SOAPAction uses `httpHeaders`. Public Samsung/Chromecast copies match `data/drivers`.

## 0.8.2.9 — 2026-09-11

- Tag `v0.8.2.9`.
- Samsung inventory: emit `ed.installedApp.get` and `ed.edenApp.get`; wait for either.

## 0.8.2.8 — 2026-09-11

- Tag `v0.8.2.8`.
- Samsung inventory: wait clock after emit, resend twice, 64-bit WS length; `data:{}` on app-list emit.

## 0.8.2.7 — 2026-09-11

- Tag `v0.8.2.7`.
- Samsung inventory wait: fresh 8002 socket, WS pong, binary frames, honest timeout (not a fake token).

## 0.8.2.6 — 2026-09-11

- Tag `v0.8.2.6`.
- Samsung inventory: reuse live 8002 session, parse appId/name, report item count.
- Light themes: button text stays darker than the fill (no page-color ink on chips).

## 0.8.2.5 — 2026-09-11

- Tag `v0.8.2.5`.
- Themes: Dark, Peach picnic, Outdoors, Modern office. Pastel removed. Muted light backgrounds.

## 0.8.2.4 — 2026-09-11

- Tag `v0.8.2.4`.
- Samsung inventory: parse the JSON that contains the wait event, not the first `{` (app list).
- S95D: pair on 8002 only; WOL delay 10s.

## 0.8.2.3 — 2026-09-11

- Tag `v0.8.2.3`.
- Pastel: lighter shaded-garden (mauve page, green sage/pine, sky steel/ocean). Still not cream.

## 0.8.2.2 — 2026-09-11

- Tag `v0.8.2.2`.
- Extron XPA 1002 driver: gateway I/O templates (`digitalOn`/`digitalOff`; `analogOut` later). Bind Flex I/O, set standbyLine.
- Pastel theme: dusk rose (dark canvas, blush text). Dark theme unchanged.

## 0.8.2.1 — 2026-09-11

- Tag `v0.8.2.1`.
- Drivers tab: search, type chips, sort (brand/model). Library list Add / In room. Snapshot library is index-only (not full JSON).

## 0.8.2 (beta) — 2026-09-11

- Tag `v0.8.2`. Still beta; not production-certified.
- Configurator tabs live in separate files (`src/components/config/*-tab.tsx`). Shell still owns PIN, Save all, draft, and refresh.
- Samsung Q65T and S95D: Authenticate tries **8002 WSS first**. HTTP `:8001/api/v2/` is status-only. Installed-app inventory + App launch / App native.
- Kept LAN sockets no longer grow an unbounded `data` buffer while monitors keep the session alive.
- Config Log tab: one host-status line above the event list. Monitor value changes are logged (including `MON_*`).
- Update from GitHub ignores dirty Nitro/`.vercel` artifacts. Sonos UPnP keeps `SOAPAction` case and polls the feedback path.

## 0.8.1 (beta) — 2026-09-11

- Tag `v0.8.1`. Still beta; not production-certified.
- Config tags for macros / logic (filter chips, drag onto a chip to file, drag chips to reorder). Old `folder` values still load as tags.
- Interface cards fold and drag-reorder. Logic tab sits between Macros and Pages.

## 0.8.0 (beta) — 2026-09-10

- Tag `v0.8.0`. Still beta; not production-certified.
- In-app update checker binds the staged preview with `PORT`/`NITRO_PORT` so it does not collide with the live room on 8081.
- Portrait: two-column flow; full-width only for sliders, schedules, and widgets that already span the authored row; labels stay captions.
- Gateway interfaces (IPL T SFI244), MPS 602 SIS (`input.source`), generic PC WOL + RPC/HTTP shutdown.
- Triggers with extra true/false checks; monitor auto-vars `MON_*`; 500 ms gateway polls.
- Panel access default remains **pin**. **Open on LAN** skips the panel PIN and mints a shared panel session; that is not `externalControl`. New buttons are 1×1 bound to hidden None.
- Chromecast Play/Pause use the live media session and app transport. Button icons pin to the right.
- Room tab shows package version + git SHA. In-app updates are staged and readiness-checked before activation.
- PIN validation/redaction (PR #22). Empty number fields no longer force 0.
- Room and secrets persistence uses a durable paired transaction and matching `.good` files. A corrupt journal is moved aside; the last-good pair is kept.
- HTTP command, monitor, and peer response bodies stay under their timeout and size limit.
- Delayed trigger edges reserve their execution before waiting, preventing duplicate macro runs.
- Server startup loads persisted state and starts automation before the first API request.
- In-app updates build and probe an isolated worktree; failed activation restores and restarts the previous release.
- Added a Sonos S1/S2 LAN driver for transport, mute, volume, and playback-state control over the player HTTP endpoint.
- Added a Samsung QE77S95D driver validated against the TV's Tizen discovery endpoint and secure remote-control port.
- Docs (SECURITY, KNOWN_ISSUES, README, LINUX): panelAccess vs externalControl; firewall as an install step; closed stale tracker issues #17 #19 #20 #21.

## 2026-09-08 — gateway interfaces and Pi update

- Interfaces: `kind: gateway` (first profile: Extron IPL T SFI244). Device bind fills LAN host/port from the slot map (COM1→2001, COM2→2002, IR/I/O on SIS 23).
- Driver `extron-ipl-t-sfi244.json` (SIS I/O, IR play, COM send).
- Sony VPL-FHZ120L waits for ADCP `NOKEY` before commands.
- In-app update: `npm ci --include=dev` so systemd `NODE_ENV=production` still installs Vite. Clears leftover `.vercel/` before `git pull --ff-only origin main`; `npm run build` (Nitro `.vercel/output`, no `dist.next` swap).

## 2026-09-07 — control-plane hardening

- Atomic persist: secrets then room, fsync + rename. Failed second write restores the previous secrets file.
- Panel does not accept the config PIN unless `panelAcceptsConfigPin` is on (default off). Forget clears the tablet token on the next room poll. Expired sessions are dropped from memory and secrets.
- HMAC tests: good sig, replay, uppercase, empty key, skew, wrong path. Open-LAN policy and `system.*` admin gates covered. Change-triggers fire once per edge. Empty schedule days stay skipped.
- Local transports (GPIO / I2C / IR / CEC / SPI) use allowlisted argv. No raw `payload.split`. TCP stays connect-write-close (issue #4).
- Docs aligned with the above. Not audited. Not production-certified.

## 0.7.3 — 2026-09-07

- Configurator PIN is asked once. Sessions stay in memory across secret reload.
- Update: `git pull --ff-only && npm ci && vite build --outDir dist.next`. Failed builds leave `dist/` alone.
- Under systemd, restart is `process.exit(1)` (`Restart=always`). Unit: `StartLimitBurst=5`, `TimeoutStartSec=120`, `ExecStartPre` checks `dist/`.
- `/api/room` rate-limit keyed by session token (loopback not limited). Panel poll 4s.
- Persist: secrets first, `fsync`, corrupt room file renamed `.bad`, last-good `.good`.
- Schedules: busy lock, stamp after success, persist immediately, log `skipped empty days`.
- PGLite not started on `vite preview` / production / systemd.

## 0.7.2 — 2026-09-06

- Panel/config PIN pages use `/api/panel-unlock` and `/api/config-unlock` so client bundles do not import `node:crypto`.
- Unlock re-reads `data/relay-secrets.json` so a reset PIN is live without a process restart.
- Security: peer secret is visible, with Copy and Generate. Relay-host devices use Secret (other room’s peer secret), not Token.
- Vite HMR error overlay disabled so a hot-reload fault does not freeze a tablet.
- Peers can only fire Security allow-listed macros.

- Removed unauthenticated `getSnapshot` / `getRoomState` server functions. Panel uses `/api/room`.
- `system.restart` and `update-relay.mjs` spawn `vite preview` when already in preview, or `systemctl restart relay` under systemd.
- Peers can only fire Security allow-listed macros (no host commands).
- `/api/room` rate-limit uses the socket address. `X-Forwarded-For` only if `RELAY_TRUST_PROXY=1`.
- Empty schedule days never fire. PINs documented as hashed.

- Panel and configurator PIN screens no longer wait on `/api/room`.
- Unlock is `POST /api/panel-unlock` and `POST /api/config-unlock` (scrypt + 5-try lockout).
- First PIN change writes both config and room PINs. Set them apart on Security if the tablet must not open `/config`.
- PINs stored as scrypt. Host restart/update/reboot need a config session and a second PIN. Peers cannot run them.
- `/api/room` rate-limited; unauthenticated calls lose IPs, drivers, and logs.
- Device connects limited to RFC1918 (localhost only for the host driver).
- `npm run start` is vite preview. systemd unit uses that. Secrets path: `RELAY_SECRETS_FILE`.
- Room and secrets files are gitignored. A clone has no used room.

## 0.7.1 — 2026-09-06

- HMAC signatures must be 64 lowercase hex chars; replay cache uses the digest.
- Peer host restart/update/reboot uses the first HMAC only (no second PIN check).
- Save all fails the request if the room or secrets file cannot be written.
- Change-triggers queue at most once per edge.
- Security tab: peer secret, paired tablets until Forget, weak PIN wall (`1234` must be changed).
- Open LAN control **off** by default. HMAC uses the peer secret only; `/api/ping` needs a config session.
- Panel reuses a stored token (no mint on every refresh). `/api/room` hides `peerSecret`.
- Triggers re-check after delay and stamp only on success.
- Kiosk grid fits the screen; dim is an overlay; config scroll clipped under the header.
- Restore demo button removed. Clear config remains.

## 0.7.0 — 2026-09-06

- Relay-to-Relay: remote `relay-host` device (IP:8081 + peer secret) uses `/api/peer` for allow-listed macros only.

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
