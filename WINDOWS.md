# Relay — Windows

Relay **0.8.2.3** (beta). Windows 10/11. Command Prompt or PowerShell.

Default configurator PIN: `1234`. The app then requires a stronger PIN. Tablets stay paired until Forget on Security.

Working folder in this guide: `C:\relay`.

## 1. Node.js 22 LTS

1. Installer: [https://nodejs.org](https://nodejs.org) (LTS `.msi`).
2. Keep **Add to PATH**.
3. Close every terminal, open a new one.

```bat
node -v
npm -v
```

Need `v22` or newer. If `node` is not recognized, sign out or reboot.

## 2. Get the project

```bat
cd C:\
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git relay
cd C:\relay
```

A zip extract also works. Put `package.json` at `C:\relay\package.json`. In-app **Update from GitHub** needs the git clone.

## 3. Packages (once)

```bat
cd C:\relay
npm ci
```

Several minutes the first time. npm deprecation warnings are normal.

## 4. Start

| Script | Command | Bind | Use |
| --- | --- | --- | --- |
| Dev | `npm run dev` | `0.0.0.0:8080` | Edit |
| Production | `npm run build` then `npm start` | `0.0.0.0:8081` | 24/7 |

```bat
cd C:\relay
npm run build
npm start
```

Leave the window open.


```
Local:   http://localhost:8081/
Network: http://YOUR-LAN-IP:8081/
```

- This PC: [http://localhost:8081/](http://localhost:8081/)
- Configurator: [http://localhost:8081/config](http://localhost:8081/config)

Phone or tablet on the same LAN:

```bat
ipconfig
```

Use **Wireless LAN adapter Wi-Fi → IPv4 Address**, then `http://THAT-IP:8081/`.

If the phone cannot connect: Windows Security → Firewall → allow `node.exe`. Do not port-forward 8081 off the LAN.

## 5. First room

1. Open `/config`, PIN `1234`. Set a new PIN when asked. Optionally set a different room PIN on Security.
2. Room tab: name, Save all.
3. Devices: add driver from library, set IP, turn Simulate off for real hardware.
4. Authenticate if the driver has pairing (Samsung: Allow on the TV, port 8002, save token).
5. Pages / Macros: bind buttons.
6. Open `/` on the tablet.

## 6. After replacing source files

Ctrl+C, then `npm start` again (or `npm run dev` while editing). Run `npm ci` only if `package-lock.json` changed.

`Invalid server function ID` or missing `@/` import: stop Vite and start it again. Do not copy files over a running server.

## 7. Update from GitHub

Requires a git clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all** → **Update from GitHub**.

Builds the fetched release in a separate git worktree, checks its `/api/room` response, and only then switches the live checkout and build. A failed stage leaves the running release untouched. If the switched release fails readiness, the updater restores and restarts the previous release. Log: `data\relay-update.log`. Room tab then shows `0.8.2.3 (<sha>)`. Tracked uncommitted edits block the update.

```bat
cd C:\relay
git pull --ff-only
npm ci --include=dev
npm run build
npm start
```

```bat
cd C:\relay
git pull --ff-only
npm ci --include=dev
npm run dev
```

## 8. Data and COM ports

- Room file: `C:\relay\data\relay-room.json` (layout, IPs)
- Secrets: `C:\relay\data\relay-secrets.json` (PINs, tokens — not in Export)
- Drivers: `C:\relay\data\drivers\`
- COM ports: Configurator → Interfaces → Scan
- Driver check: `npm run driver:check -- data\drivers\samsung-qe50q65t.json`

## 9. Stop a leftover process

```bat
netstat -ano | findstr 8081
taskkill /PID <id> /F
```

Or Task Manager → end the `node.exe` bound to 8081.
