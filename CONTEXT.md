# Relay — agent map

Read this first. Then `AGENTS.md` (rules). Do not treat old Grok Build chats as source.
Git `main` is the product. Room files on a Pi are not in git.

Keep this file short. If it grows past ~150 lines, cut history — do not append it.

## Product

Relay **0.9.50** (beta). Single-process LAN AV room controller. Phase B software checkpoint (B5 at `v0.9.45`). LE/ACME parked; C1–C4 in-box venue TLS train closed (Generate + Networks UI + lifecycle + docs checkpoint).
TanStack Start + Vite. Dev `:8080` / prod `:8081` bind to **AV-LAN IPv4** (else loopback). Never `0.0.0.0`. `RELAY_LISTEN_HOST` overrides.
Not a grok.me / Vercel host — those have no writable `data/`.

Companion signage: [Foyer-Room-Signage](https://github.com/richardosseweijer/Foyer-Room-Signage) `v0.2.2`.
Wire: `FOYER-RELAY.md` (same file in both repos).

## Where to look (one job → those files only)

| Job | Files |
| --- | --- |
| Send / parse / sockets | `engine.ts` (orchestration façade), `engine-wire.ts` (TCP/pace/encode), `engine-lan.ts` (LAN dispatch), `engine-host.ts` (local/host), `engine-policy.ts`, `engine-payload.ts` |
| Protocol adapters | same folder: `ws.ts`, `cast.ts`, `pjlink.ts`, `wol.ts`, `osc.ts`, `sacn.ts`, `udp.ts`, `ipmidi.ts`, `rtp-midi.ts`, `midi.ts`, `midi-in.ts`, `http-client.ts`, `gateway.ts` |
| Persist / boot / clocks | `src/lib/control/store.server.ts`, `scripts/write-atomic.mjs` |
| Panel / config RPCs | `actions.ts` (barrel), `actions-auth.ts`, `actions-config.ts`, `actions-runtime.ts`, `actions-host.ts`, `actions-context.ts` (`loadControl`) |
| Types / empty room | `types.ts`, `defaults.ts`, `schema.ts`, `vars.ts` |
| PIN / session | `pins.ts`, `pins.server.ts`, `session.server.ts`, `session-expire.ts`, `panel-token.ts`, `panel-unlock-rule.ts` |
| Occupancy / Foyer GET | `peer-payload.ts`, `peer-auth.ts`, `src/routes/api/peer.ts`, `FOYER-RELAY.md` |
| Peer AV vs venue (B3) | `peer-venue.ts`, `engine.ts` (`signedPeerFetch`), Devices tab Peer face |
| Device nicFace (B4) | `device-face.ts`, `engine-lan.ts` (`sendLan`), Devices tab NIC face |
| Foyer calendar poll | `foyer-peer.ts` |
| Preview tile | `preview-grab.ts`, `src/components/panel/preview-tile.tsx`, `src/routes/api/preview.ts` |
| Panel UI | `src/components/panel/control-panel.tsx` |
| Page layout | `page-layout.ts`, `pages-editor.tsx`, `control-panel.tsx` |
| Config shell / tabs | `src/components/config/config-app.tsx`, `*-tab.tsx`, `trigger-pane.tsx`, `pages-editor.tsx` |
| HTTP snapshot | `src/routes/api/room.ts` |
| Unlock | `src/routes/api/panel-unlock.ts`, `config-unlock.ts` |
| Stock drivers | `data/library/*.json` + `index.json` |
| This room’s copies | `data/drivers/*.json` (not git) |
| New driver syntax | `DRIVER-PROMPT.md`, then `npm run driver:check -- data/library/<file>.json` |
| NIC pick / listen host | `nics.ts`, `scripts/http-listen-host.mjs`, `scripts/https-venue-listen.mjs` (B1), `peer-venue.ts` (B3), `device-face.ts` (B4), `scripts/venue-tls-*.mjs` (C1–C3), `scripts/with-app-env.mjs`, Room tab Networks (Generate / Regenerate / Download CA) |
| Install / firewall | `LINUX.md`, `WINDOWS.md`, `SECURITY.md` |
| Venue TLS inventory (C0–C4) | `SECURITY.md` § Venue TLS inventory — Shipped C0–C4 vs PARKED LE vs residual leftovers |

## Do not open unless the operator names them

`ARCHITECTURE.md`, `CHANGELOG.md`, `package-lock.json`, `scripts/*test*`,
`.grok/`, `.vercel/`, `screenshots/`, `public/__grok/`, factory PWA scripts.

Do not grep the whole repo to “get context.” If the table above is missing a file, ask.

## Live notes (still true at 0.9.50)

- Occupancy var is `0` closed, `1` open, `2` in-session, `3` DND. Foyer GET still reads the **string** field. Save-all must not apply `draft.room.occupancy`.
- Unsigned `GET /api/peer` is TCP loopback **or listen-host hairpin** (real `remoteAddress`, not `Host`). HMAC GET is the full snapshot.
- Foyer calendar poll is Relay → loopback Foyer `:8080` only.
- Generic LAN TCP is connect-write-close (issue #4). Gateway sockets are the reused path.
- Panel PIN ≠ config PIN unless `panelAcceptsConfigPin` (default off).
- Open-on-LAN (no panel PIN) is not `externalControl` (unauthenticated fire\*).
- `system.restart|update|reboot` need a config session even if open LAN is on.
- Listen is AV-LAN IPv4 only — never `0.0.0.0`. Optional venue HTTPS (B1) when outbound NIC + file certs (`RELAY_TLS_CERT`/`RELAY_TLS_KEY` or room paths); **LE/ACME/DNS-01 PARKED** (not default). **Shipped C1–C4:** in-box Generate venue CA (API + Networks UI / CA download / regenerate confirm / expiry banners) + docs checkpoint `v0.9.46`. B3: HMAC peer over that HTTPS (`peer-venue.ts`); soft-skip venue peer if None/no server PEMs; **strict trusted peer CA** (fail-closed if missing; `peerTrustedCaPath` / Download CA exchange). B4: per-device `nicFace` (`device-face.ts`) bind AV vs venue; soft-fail venue face if None/no IPv4; no cleartext HTTP/WS on venue (inventory `httpPath` refused on outbound); Cast AV-only; device HTTPS/TLS-WS require CA or sha256 pin on venue (`v0.9.48`); manual `samsung-pair.mjs` fail-closed on 8002 (`v0.9.49`). B5 = Phase B software checkpoint (tag `v0.9.45`). Firewall panel port to AV CIDR (#15). Outbound None ⇒ Update refused (A1) and venue HTTPS / venue peer / venue nicFace skipped. AV must not depend on venue certs. Foyer/default control URL prefers live AV-LAN IPv4 (`controlBaseUrlFrom`); soft-fail if AV unset / no IPv4; unsigned peer GET allows listen-host hairpin. Footgun fixed. Canonical map: `SECURITY.md` Venue TLS inventory.
- Do not add xAI / Grok API calls. Do not print PINs. Do not commit `data/relay-secrets.json` or `.env`.
- Do not start raw `npx vite`. Use `npm run dev` / `npm start`.

## Open tickets (read the issue if you touch that area)

| # | One line |
| --- | --- |
| 4 | Generic TCP still connect-write-close |
| 14 | Secrets file holds peer secret, device tokens, session secrets |
| 15 | HTTP on AV-LAN; venue HTTPS B1 + peer B3 (strict CA) + nicFace B4 (B5); LE parked; Generate C1–C4 shipped; strict peer TLS `v0.9.47`; strict device TLS `v0.9.48`; samsung-pair TLS `v0.9.49` |
| 16 | Config tab labels are raw ids |
| 37 | PIN lockout is process memory, one counter per gate |
| 38 | Trigger engine still has false-path / hold / delay |
| 39 | Occupancy dual-write leftover (`busy` alias, docs drift) |

## How a new agent should start

1. Read this file. Read `AGENTS.md` only for bans / gates, not for a history lesson.
2. One job per turn. Name the files from the table.
3. After edits: `npm run typecheck` and `npm run test`. `npm run build` before claiming done.
4. Stop. Do not start the next job unasked.
5. If this map is wrong, patch **this file** in the same turn — one or two lines — not a new essay.

```text
Read CONTEXT.md only, then the files it lists for this job.
Do not open ARCHITECTURE.md, CHANGELOG.md, or package-lock.json.
Do not grep the repo. If you need another file, stop and ask.
Job: …
```
