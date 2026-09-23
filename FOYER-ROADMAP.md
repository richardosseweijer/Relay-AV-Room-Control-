# Foyer contract — Relay roadmap (0.9.0)

**Live wire is [`FOYER-RELAY.md`](FOYER-RELAY.md)** (same file in Foyer). This roadmap is how 0.9.x was built. Do not treat it as the operator contract.

Do not execute until asked. Halt on red. No push until asked.
Do not read Foyer data files. Do not import Foyer. Do not add a Foyer JSON driver.
Do not heap this into `engine.ts` — new files only, thin call-sites.

**Foyer main `7d8e086` is the lock.** One Ubuntu PC = one Relay (`:8081`) + one Foyer (`:8080` / `:8082`) = one room.

## Locked (operator + Foyer `7d8e086`)

- Host: Ubuntu Server 24.04. Pi/Windows stay until parked later.
- Foyer `:8080` / `:8082`. Relay production `:8081`. Do **not** move Foyer.
- Grok sandbox: Relay `npm run dev` stays `:8080`. Room PC: `npm start` (`:8081`).
- HTTP listen was originally `0.0.0.0` + **ufw**. **Superseded by NIC-split A2**: Relay binds AV-LAN IPv4 only (never `0.0.0.0`); ufw still AV CIDR. No dual Node sockets. HTTPS venue = Phase B/C (B1 file PEMs shipped; LE parked; Generate + Networks UI / lifecycle C1–C3 shipped; C4 docs checkpoint — see `SECURITY.md` Venue TLS inventory).
- Occupancy writer: Foyer polls Relay `GET /api/peer`. **No Relay POST occupancy.** Relay polls Foyer `GET :8080/api/peer` for the current or next calendar session (`foyer-peer.ts`, loopback-only).
- Do **not** match room names. Do **not** map occupancy through vars for Foyer.
- NIC pickers independent (standalone). Same NIC allowed; warn, do not block.
- Central monitor: out of scope.
- Isolation: no shared disk, PIN, ICS, or secret file. HMAC on **loopback only**.
- Foyer-as-Relay-device: out this pass (no poll, no POST). Host `occupancy.*` indexes/sets occupancy.

## Foyer wire this pass (do not “improve”)

**NIC list** (match exactly):

- `os.networkInterfaces()`, names sorted **A–Z**.
- Index **0-based** (row order after sort). **Not** `ip` order. **Not** 1-based.
- Skip only ifaces where **every** address is `internal` (that is `lo`).
- Keep `docker0`, `veth*`, `br-*`, down, no-IPv4.
- Label uses **em dash** U+2014: `0 — enp1s0 (10.0.25.10)` / `0 — enp1s0 (no IPv4)`.
- Resolve: **name first, then index**.
- Persist Relay’s own keys (same *names* as Foyer, own disk): `avLanNicIndex` / `avLanNicName`, `outboundNicIndex` / `outboundNicName`.
- UI labels: **AV-LAN**, **LAN (internet)**.

**HMAC** (optional on loopback GET): `x-relay-ts` + `x-relay-auth`; payload `` `${ts}\n${method}\n${path}\n${body}` ``; method `GET`; path exactly `/api/peer`; body `""`; HMAC-SHA256 64 lowercase hex; `ts` = `String(Date.now())`. Loopback GET is allowed unsigned (both occupancy and calendar). HMAC, if sent, must match. Non-loopback GET is denied on Foyer; Relay POST still requires HMAC. Skew/replay: ~90s.

**Foyer `GET /api/peer` (this train):** loopback `:8080`. Body `{ ok, v:1, session: { kind: "now"|"next", title, startIso, endIso } | null }`. HMAC optional on loopback GET. Relay writes `foyer.kind` / `foyer.title` / `foyer.start` / `foyer.end`.

**Occupancy (only thing Foyer reads from GET `/api/peer`):**

Foyer uses **only**:
- `ok: true`
- `occupancy`: `"available"` | `"in-session"` | `"busy"` | `"do-not-disturb"` | `"closed"`
- `host.locked` (only if occupancy is missing → treated as in-session)

It ignores `room`, `room.name`, `room.id`, `vars`, `macros` for occupancy. Names in Foyer and Relay may differ.

Relay still **emits**:

```
{ "ok": true, "v": 1, "room": { "id": "", "name": "" }, "host": { "dim": false, "locked": false, "pageId": null }, "occupancy": "available", "vars": { … }, "macros": { … } }
```

Do not require Foyer’s name. Occupancy is first-class `room.occupancy` plus baked enum var `occupancy` (panel/macros). Foyer does not map that var.

When occupancy is set, it is the plate status (Foyer Auto). Calendar still shows the agenda.

Room tab copy: “Foyer on this PC reads occupancy. Room names do not need to match.”

## Handrails

After every phase: `npx tsc --noEmit`; `driver-check` if a JSON driver changed; that phase’s test file. Halt on red.

After each block: full `npm test`.

Do not edit `data/relay-room.json` / secrets. Version is three-part (`0.9.4`); bump only when pushing.

---

## Phase 0 — Freeze / inventory (no behaviour)

- Confirm `start` is `:8081`. Leave Vite `server.port` **8080**.
- Inventory sockets for later `localAddress`: `udp.ts`, `wol.ts`, `engine.ts` tcp/session, `pjlink.ts`, `ws.ts`, `rtp-midi.ts`, `http-client.ts`, midi-in UDP if any.
- `listHostInterfaces()` is serial/GPIO/MIDI — **not** NICs.
- `GET /api/peer` today: `room` is a **string**.

Gate: tsc. No tests.

---

## Block A — NIC list + resolve (no UI)

### Phase 1 — `src/lib/control/nics.ts`

Implement **Foyer’s algorithm**, not `ip`:

1. `os.networkInterfaces()`
2. Drop names where every addr is `internal`
3. Sort remaining names A–Z (`localeCompare` / code-point, tests lock this)
4. Index = `0 .. n-1`
5. IPv4 = first `family` IPv4 / `4` that is not internal; else `null`
6. Label: `${index} — ${name} (${ipv4 ?? "no IPv4"})` with U+2014

`resolveNic({ name, index })`: name match first (exact), else index.

`outboundAddress`: picker set + `ipv4 == null` → fail closed (no AV-LAN fallback).

Tests `scripts/nics.test.mjs` with a **mocked** `networkInterfaces()` object:

- `lo` (internal) + `enp2s0` + `enp1s0` → order `enp1s0` then `enp2s0`, indexes **0, 1**, labels with em dash.
- No IPv4 row → `(no IPv4)`.
- Persist name `enp2s0` + stale index 0 → still `enp2s0`.
- Fail closed: selected name, `ipv4` null.
- `docker0` **present** (not skipped).

Gate: tsc + nics tests. Fixture asserts `label.includes(" — ")` (em dash, not hyphen-minus).

### Phase 2 — persist fields

`room`: `avLanNicIndex`, `avLanNicName`, `outboundNicIndex`, `outboundNicName`, `occupancy`. Baked var id `occupancy`.

Default occupancy `"available"`. Nic fields null. `foyerPeerUrl` **not used this pass** (no poller). May still persist the default for later; do not GET it.

Gate: tsc.

---

## Block B — Room UI

### Phase 3 — pickers + occupancy

Room tab:

- Dropdowns **AV-LAN** and **LAN (internet)**, labels from Phase 1.
- Same NIC → one-line warning, still save.
- Occupancy dropdown (available / in-session / busy / do-not-disturb / closed). Help: Foyer on this PC reads occupancy. Room names do not need to match.
- Baked list var `occupancy`. No occupancy-var picker. No Match room name.
- Relay room name stays editable. It does not have to match Foyer.

Gate: tsc.

---

## Block C — occupancy + peer GET

### Phase 4 — host commands + wire

`relay-host.json` + `defaults.ts`:

- `occupancy.available` | `occupancy.in-session` | `occupancy.busy` | `occupancy.do-not-disturb` | `occupancy.closed`
- Feedback `occupancy.state`

`applyHost`: set `room.occupancy`, persist, write baked var `occupancy` (including DND).

`GET /api/peer`:

```json
{
  "ok": true,
  "v": 1,
  "room": { "id": "<id>", "name": "<relay room.name>" },
  "host": { "dim": false, "locked": false, "pageId": null },
  "occupancy": "available",
  "vars": { "<id>": { "name": "<label>", "value": "<value>" } },
  "macros": {}
}
```

Must **not** emit `room` as a string. Foyer reads `occupancy` only. Keep `vars` for Relay.

Tests `scripts/peer-occupancy.test.mjs`: builder emits object `room`; occupancy field; var value aliases; `busy`; locked flag passthrough.

Gate: tsc + tests + `driver-check` relay-host.

---

## Block D — Foyer client

**Done in 0.9.4.** `foyer-peer.ts` polls Foyer `GET http://127.0.0.1:8080/api/peer` every 4 s (loopback only, unsigned GET). Writes `foyer.kind` / `foyer.title` / `foyer.start` / `foyer.end`. Occupancy stays Foyer → Relay GET. No occupancy POST.

---

## Block E — AV-LAN bind

`avLanBind(config) → { localAddress?: string }` in `nics.ts`.

### Phase 6 — UDP / WOL / multicast

`sendUdp`, `sendUdpMulticast` (`setMulticastInterface`), `listenUdpMulticast` (`addMembership(group, addr)`), `wol.ts` bind.

Gate: tsc + udp/wol tests.

### Phase 7 — TCP / WS / PJLink / RTP-MIDI

`net.connect({ host, port, localAddress })`. Grep: `net.connect(` without `localAddress` in `src/lib/control` is red unless `// loopback`.

Gate: tsc + existing tests + grep.

### Phase 8 — HTTP

`localAddress` on `requestHttpExact`. Route **all** `sendHttp` through it. `fetchTextBounded` only for loopback HMAC (Foyer later / Relay peer).

Gate: tsc + grep `sendHttp` must not call `fetchTextBounded`.

---

## Block F — outbound fail-closed + docs

### Phase 9 — updater preflight

If outbound NIC set and no IPv4 → refuse update. Do not bind `git`. No AV-LAN fallback.

### Phase 10 — docs

Two NICs + loopback HMAC. Tablet on AV-LAN (drop rack-AP door story). Relay AV-LAN IPv4 `:8081` + ufw (A2; was `0.0.0.0`). Foyer `:8080`/`:8082`. Peer secret ≠ PIN. Foyer occupancy = first-class `occupancy`. Room names do not need to match. Docs train = A3.

### Phase 11 — full gate

`tsc`, `npm test`, `driver-check` all JSON. Grep: no `data/foyer`, no Foyer package imports, no `8181`. `net.connect` grep still holds. `foyer-peer.ts` may GET loopback `:8080/api/peer`.

---

## External (not this train)

- Foyer-as-Relay-device (poll/POST). Occupancy is host `occupancy.*` + Room tab list.
- Central monitor.

## Out of scope

Moving Foyer ports; sandbox `:8080`; dual listen; Foyer driver; occupancy POST; Foyer data files; HMAC on a NIC; Pi/Windows parking.

---

## Success rate (re-scored after `f6abb8e`)

What changed vs the PDF plan:

| Change | Effect |
|---|---|
| NIC = Node A–Z, 0-based, em dash (Foyer’s code, not `ip`) | A residual 4% → **1%** |
| **No Foyer poll this pass** | Block D residual **0%** (work removed) |
| Emit first-class `occupancy`; Foyer 7d8e086 reads that field | C residual **0%** (no label match) |
| Bind helper unchanged | E **6%** (still the fat one) |

First-clean product of residuals:

`(0.99)(0.98)(1.00)(1.00)(0.94)(0.98)(0.98) ≈ **87%** first-pass.

Halt-on-red eventual for **this train**: **~97%**.

Not 99%: dual-NIC not in this sandbox.

Live now/next: **not scored** (Foyer has no peer route).

Errors folded in this revision: do not use `ip`; indexes are 0-based; em dash; do not skip docker; occupancy is first-class including DND; do not match room names. 0.9.4 polls Foyer loopback GET for calendar session only.

Ready to execute from Phase 0 when you say go.
