# Run Relay on a Windows PC

Use this when the PC is on the **same Wi‑Fi / LAN as the Samsung TV**. The in-browser preview cannot reach your TV. This copy can.

Config PIN for the bundled demo room: **1234** (change this before any real room).

License: MIT — see `LICENSE`, `NOTICE`, `PRIVACY.md`, and `SECURITY.md`.

---

## 1. Install Node.js

1. Open [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** installer (Windows Installer .msi)
3. Run it. Leave the defaults. Make sure **“Add to PATH”** is checked
4. Close any open Command Prompt windows

Check it worked: open **Command Prompt** and type:

```bat
node -v
npm -v
```

You should see version numbers. If Windows says the command is not recognized, sign out and back in, or reboot once.

---

## 2. Get the project onto the PC

You should have `relay-room-controller.tgz` (or a folder that already contains `package.json`).

**Option A — Windows 10 / 11 (built-in tar)**

1. Put the `.tgz` in a folder you can find, e.g. `C:\relay`
2. Open Command Prompt
3. Run:

```bat
cd C:\relay
tar -xzf relay-room-controller.tgz
```

**Option B — 7-Zip / WinRAR**

Extract the archive into `C:\relay`. You want to see `package.json` in that folder (or one level down). If everything landed in a subfolder, `cd` into that subfolder for the next steps.

---

## 3. Install and start

In Command Prompt:

```bat
cd C:\relay
npm install
npm run dev
```

The first `npm install` takes a few minutes. Leave the window open.

When it is ready you will see a local address, usually:

`http://localhost:8080`

Open that in Chrome or Edge **on the same PC**.

To open the panel from a phone on the same Wi‑Fi:

1. On the PC, Command Prompt: `ipconfig`
2. Find **Wireless LAN adapter Wi-Fi** → **IPv4 Address** (example `192.168.1.40`)
3. On the phone go to `http://192.168.1.40:8080`

If the phone cannot open it, allow **Node.js** through Windows Firewall when Windows asks, or: Windows Security → Firewall → Allow an app → Node.js / `node.exe`.

---

## 4. First-time setup in the app

1. Open the gear / Config
2. PIN **1234**
3. **Devices** → **Add device**
4. Name: `Samsung`
5. Driver: `samsung-qe50q65t.json`
6. Host: the TV’s IP address  
   On the TV: Settings → Network / General → Network Status → IP address
7. Uncheck **Simulate**
8. **Save all** → PIN **1234**
9. Press **Probe**
10. On the TV, accept **Allow** / **OK** for the new remote named Relay

If Probe is red:

- PC and TV must be on the same network (not guest Wi‑Fi, not a phone hotspot that isolates clients)
- IP control / Smart View is not blocked on the set
- Try host port **8002** and paste a pairing token if the TV shows one
- Some Q65T units ignore Power On while off; use **Power toggle** with the TV already on for the first test

---

## 5. Daily use

```bat
cd C:\relay
npm run dev
```

Leave that window running while you use the panel. Closing it stops the server.

To stop: click the Command Prompt window and press `Ctrl+C`.

---

## 6. Optional: start on boot (later)

Not required for testing. After you are happy with it, we can add a Windows Task Scheduler entry or move the same project onto a Raspberry Pi.
