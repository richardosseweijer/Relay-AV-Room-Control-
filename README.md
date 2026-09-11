# Relay

Relay **0.8.2.7** (beta). Room controller for local AV devices. Private LAN only. Tag `v0.8.2.7` is a snapshot of this tree; install and update from **`main`**. After Update, Configurator → Room shows `0.8.2.7 (<git sha>)`.

Clone is unused until you start it. First boot writes `data/relay-room.json` and `data/relay-secrets.json` on the host. Those files are not in git.

```
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd Relay-AV-Room-Control-
npm ci
```

| Script | Command | Bind | Use |
| --- | --- | --- | --- |
| Dev | `npm run dev` | `0.0.0.0:8080` | Local edit / App Builder preview |
| Production | `npm run build` then `npm start` | `0.0.0.0:8081` | Pi / 24/7 |

Room `http://HOST:PORT/` — configurator `http://HOST:PORT/config`

Do not start with raw `npx vite`. Scripts run `scripts/with-app-env.mjs`.

First PIN is `1234`. You must set a stronger one. New rooms default to **Panel PIN**; each tablet pairs until Forget. **Open on LAN** is an explicit kiosk mode (no panel PIN; shared panel session). Open LAN *control* (`fireCommand` without a token) is a different switch and stays off. See [Security](SECURITY.md).

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
npm run driver:check -- data/drivers/samsung-qe50q65t.json
```

## Disclaimer

This repository is **AI-generated software**. It has **not been audited, reviewed, or certified by a human**.

The software is provided **as is**, with **no warranties** of any kind, express or implied, including fitness for a particular purpose, reliability, or safety.

**You use it entirely at your own risk.** The author and contributors accept **no liability** for any loss, damage, injury, downtime, data loss, device damage, or other claim that arises from installing, configuring, or running this software.

See `LICENSE`.
