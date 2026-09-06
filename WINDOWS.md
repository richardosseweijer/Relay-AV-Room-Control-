# Relay — Windows

Windows 10/11. Command Prompt or PowerShell.

Default configurator PIN: `1234`. Change it before a live room.

Folder used below: `C:\relay`. If you cloned to `C:\Relay-AV-Room-Control-`, use that path instead.

## 1. Node.js 22 LTS

Installer: [https://nodejs.org](https://nodejs.org) — keep “Add to PATH”.

```bat
node -v
npm -v
```

Need v22+.

## 2. Get the project

```bat
cd C:\
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git relay
cd C:\relay
```

Zip works for a first run. In-app **Update from GitHub** needs a git clone.

## 3. Packages (once)

```bat
cd C:\relay
npm install
```

Deprecation warnings from npm are normal.

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

Configurator: `http://localhost:8081/config`

## 5. After replacing files

Ctrl+C, then the same `npx vite` line. `npm install` only if `package.json` changed.

`Invalid server function ID`: restart Vite.

## 6. Update from GitHub

Clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-) required.

Configurator → Room → **Save all** → **Update from GitHub**.

Runs `git pull --ff-only`, `npm install`, restarts on 8081. Log: `data\relay-update.log`. Uncommitted edits can block the pull.

```bat
cd C:\relay
git pull --ff-only
npm install
npx vite dev --host 0.0.0.0 --port 8081
```

## Notes

- Private LAN. Do not port-forward 8081.
- COM ports: Configurator → Interfaces → Scan.
- Data: `C:\relay\data\relay-room.json`, `C:\relay\data\drivers\`.
- Kill a stray process: `netstat -ano | findstr 8081` then `taskkill /PID <id> /F`.
- `npm run driver:check -- data\drivers\samsung-qe50q65t.json`
