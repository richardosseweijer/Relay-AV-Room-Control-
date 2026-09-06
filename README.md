# Relay

Relay **0.7.2** (beta). Room controller for local AV devices. Private LAN only.

Clone is unused until you start it. First boot writes `data/relay-room.json` and `data/relay-secrets.json` on the host. Those files are not in git.

```
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd Relay-AV-Room-Control-
npm install
npx vite dev --host 0.0.0.0 --port 8081
```

Room `http://HOST:8081/` — configurator `http://HOST:8081/config`

First PIN is `1234`. You must set a stronger one. Open LAN control is off. Each tablet pairs until Forget.

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
