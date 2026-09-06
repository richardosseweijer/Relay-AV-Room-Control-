# Relay — Windows

Windows 10/11. Command Prompt or PowerShell.

Default configurator PIN: `1234`. Change it before a live room.

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
npm install
```

Several minutes the first time. npm deprecation warnings are normal.

## 4. Start

```bat
cd C:\relay
npx vite dev --host 0.0.0.0 --port 8081
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

1. Open `/config`, PIN `1234`.
2. Room tab: name, change PIN, Save all.
3. Devices: add driver from library, set IP, turn Simulate off for real hardware.
4. Authenticate if the driver has pairing (Samsung: Allow on the TV, port 8002, save token).
5. Pages / Macros: bind buttons.
6. Open `/` on the tablet.

## 6. After replacing source files

Ctrl+C, then the same `npx vite` command. Run `npm install` only if `package.json` changed.

`Invalid server function ID` or missing `@/` import: stop Vite and start it again. Do not copy files over a running server.

## 7. Update from GitHub

Requires a git clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all** → **Update from GitHub**.

Runs `git pull --ff-only`, `npm install`, restarts on 8081. Log: `data\relay-update.log`. Uncommitted local edits can block the pull.

```bat
cd C:\relay
git pull --ff-only
npm install
npx vite dev --host 0.0.0.0 --port 8081
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
