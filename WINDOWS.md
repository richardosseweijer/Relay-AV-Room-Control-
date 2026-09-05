# Relay — Windows

Tested with Windows 10/11. Use a normal Command Prompt or PowerShell.

Default login after first start: config PIN `1234`. Change it before a real room.

## 1. Install Node.js 22 LTS

Download the LTS installer from [https://nodejs.org](https://nodejs.org) and keep the “Add to PATH” box checked.

Close and reopen the terminal, then:

```bat
node -v
npm -v
```

You want v22 or newer.

## 2. Get the project

If you use git:

```bat
cd C:\
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd C:\Relay-AV-Room-Control-
```

If you already keep the project in `C:\relay`, `cd` there instead.

## 3. Install packages (once)

```bat
cd C:\relay
npm install
```

This can take several minutes the first time. Deprecation warnings from npm are normal.

## 4. Start Relay

```bat
cd C:\relay
npx vite dev --host 0.0.0.0 --port 8081
```

Leave this window open. You should see:

```
Local:   http://localhost:8081/
Network: http://YOUR-LAN-IP:8081/
```

Room: [http://localhost:8081/](http://localhost:8081/)  
Configurator: [http://localhost:8081/config](http://localhost:8081/config) — PIN `1234`.

## 5. After you replace files

Stop the server with Ctrl+C. You do **not** need `npm install` again unless `package.json` changed.

```bat
cd C:\relay
npx vite dev --host 0.0.0.0 --port 8081
```

If the page shows “Invalid server function ID”, Ctrl+C and start it again.

## 6. Update from GitHub

The checkout must be a `git clone` of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-), not a zip.

Configurator → Room → **Save all**, then **Update from GitHub**. Confirm the warning.

That stops Relay, runs `git pull --ff-only` and `npm install`, then starts it again on port 8081. The room is down for a minute. Log: `data\relay-update.log`.

Uncommitted local edits can block the pull. Do not use Update if you only unpacked a zip.

Manual equivalent:

```bat
cd C:\relay
git pull --ff-only
npm install
npx vite dev --host 0.0.0.0 --port 8081
```

## Notes

- Stay on a private LAN. Do not port-forward 8081.
- COM ports: Configurator → Interfaces → Scan.
- Room data: `C:\relay\data\relay-room.json` and `C:\relay\data\drivers\`.
- To stop a forgotten server: Task Manager → end the `node.exe` that is using port 8081, or `netstat -ano | findstr 8081` then `taskkill /PID <id> /F`.
