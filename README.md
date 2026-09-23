# Relay

Relay **0.9.45** (beta). Room controller for local AV devices. Private LAN only. Tag `v0.9.45` is a snapshot of this tree (Phase B checkpoint); install and update from **`main`**. After Update, Configurator → Room shows `0.9.45 (<git sha>)`. Versions are three-part from this release.

Clone is unused until you start it. First boot writes `data/relay-room.json` and `data/relay-secrets.json` on the host. Those files are not in git.

```
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd Relay-AV-Room-Control-
npm ci
```

| Script | Command | Bind | Use |
| --- | --- | --- | --- |
| Dev | `npm run dev` | AV-LAN IPv4 `:8080` (else loopback) | Local edit / App Builder preview |
| Production | `npm run build` then `npm start` | AV-LAN IPv4 `:8081` (else loopback) | Pi / 24/7 |

Panel today: `http://<av-lan-ip>:PORT/` — configurator `/config`. Never binds `0.0.0.0`. Optional venue HTTPS (B1 file PEMs) is shipped; LE/ACME parked; in-box Generate is Planned (C1–C4). See [SECURITY.md](SECURITY.md#venue-tls-inventory-c0).

Room tab **AV-LAN** (required trust LAN; panel listen) / **LAN (internet)** (optional outbound for Update; **None** = air-gap). Same NIC is allowed (test box). See [SECURITY.md](SECURITY.md) and [LINUX.md](LINUX.md) §5b. Foyer signage is an optional second process (`:8080` / `:8082`). How they talk: **[FOYER-RELAY.md](FOYER-RELAY.md)**.

Do not start with raw `npx vite`. Scripts run `scripts/with-app-env.mjs`.

First PIN is `1234`. You must set a stronger one. New rooms default to **Panel PIN**; each tablet pairs until Forget. **Open on LAN** is an explicit kiosk mode (no panel PIN; shared panel session). Open LAN *control* (`fireCommand` without a token) is a different switch and stays off. See [Security](SECURITY.md).

- [Foyer ↔ Relay contract](FOYER-RELAY.md)
- [Linux / Pi](LINUX.md)
- [Windows](WINDOWS.md)
- [Known issues](KNOWN_ISSUES.md)
- [Changelog](CHANGELOG.md)
- [Driver prompt](DRIVER-PROMPT.md)
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [Legal notice](NOTICE)

Validate a driver:

```
npm run driver:check -- data/library/samsung-qe50q65t.json
```

## Disclaimer

This repository is **AI-generated software**. It has **not been audited, reviewed, or certified by a human**.

The software is provided **as is**, with **no warranties** of any kind, express or implied, including fitness for a particular purpose, reliability, or safety.

**You use it entirely at your own risk.** The author and contributors accept **no liability** for any loss, damage, injury, downtime, data loss, device damage, or other claim that arises from installing, configuring, or running this software.

See `LICENSE`.
