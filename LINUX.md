# Relay — Linux / Raspberry Pi from a blank install

Install **`main`** from GitHub (that is the supported tree). Current package version is **0.8.2.7** (beta). Confirm with the Room tab version field or `git log -1`. 64-bit Debian, Ubuntu, or Raspberry Pi OS.

Default configurator PIN after first start: `1234`. Open `/config` once and set a stronger PIN. New rooms default to **Panel PIN**: every tablet unlocks with that PIN and gets its own session (30 days, sliding). **Open on LAN** is a separate Security setting that skips the panel PIN for anyone who can reach port 8081 — use it only on the room VLAN. Do not confuse it with **open LAN control** (unauthenticated `fireCommand`). See `SECURITY.md`.

This host speaks HTTP on `0.0.0.0:8081`. Before you call the install finished, restrict that port to the room VLAN (ufw, nftables, or the router). Do not port-forward 8081.

Commands below are run in a terminal as a normal user that can use `sudo`.

---

## 0. Confirm the machine is online

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
ping -c 1 github.com
```

If `ping` fails, fix Wi-Fi or Ethernet before continuing (`nmtui` on many desktops, or the Raspberry Pi Imager Wi-Fi settings).

---

## 1. Base tools

```bash
sudo apt-get install -y git build-essential
```

`build-essential` is only needed if `npm install` later compiles a native module. It is cheap to include on a fresh card.

---

## 2. Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

`node -v` must print `v22` or newer. If the NodeSource script fails (no outbound HTTPS), install Node 22 from [https://nodejs.org](https://nodejs.org) instead and ensure `node` and `npm` are on `PATH`.

On a Raspberry Pi you may use [nvm](https://github.com/nvm-sh/nvm) instead of NodeSource. If you do, the systemd unit in §6 must include that user’s nvm `bin` directory on `PATH`.

---

## 3. Optional hardware packages

Install these if this machine will drive GPIO, I2C, CEC, or IR. Skip on a plain PC that only talks LAN.

```bash
sudo apt-get install -y gpiod i2c-tools cec-utils lirc samba-common-bin
```

| Function | Tool | Package |
|---|---|---|
| LAN | Node 22 | `nodejs` |
| GPIO | `gpioset` | `gpiod` |
| I2C | `i2cset` | `i2c-tools` |
| CEC | `cec-client` | `cec-utils` |
| IR | `ir-ctl` / `irsend` | `lirc` |
| Serial | `/dev/tty*` / `/dev/serial0` | kernel |
| PC RPC shutdown | `net rpc shutdown` | `samba-common-bin` |

On Raspberry Pi OS: `sudo raspi-config` → Interface Options → enable I2C / Serial / SPI as needed → reboot.

### Onboard serial (GPIO 14/15)

Relay’s interface scan lists USB adapters (`ttyUSB*`, `ttyACM*`) and the Pi UART nodes (`ttyAMA0`, `ttyS0`, `serial0`, `serial1`) when those files exist.

The header UART is off by default. Enable it:

1. `sudo raspi-config`
2. Interface Options → Serial Port
3. Login shell over serial: **No**
4. Serial hardware: **Yes**
5. Finish → reboot

Use **`/dev/serial0`** for a device on GPIO 14/15. That alias follows the current Pi model. `ttyAMA0` is often taken by Bluetooth on Pi 3/4/5.

If scan still has no onboard port: UART is disabled, console still owns it, or you scanned a PC. Type `/dev/serial0` by hand only after the steps above.

Wiring is 3.3 V TTL, not RS-232 levels. A projector or Denon on the header needs a level shifter or a USB–serial adapter (`/dev/ttyUSB0`).

---

## 4. Clone Relay (`main`)

Do **not** use a zip, an old tag (`v0.7.3`), or a copy of `dist/` from another machine. The in-app update and this guide both track **`origin/main`**. `v0.8.2.7` is a snapshot of this beta.

```bash
cd ~
rm -rf ~/Relay-AV-Room-Control-
git clone --branch main --single-branch https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd ~/Relay-AV-Room-Control-
git fetch origin
git checkout -B main origin/main
git log -1 --oneline
test -f src/lib/control/gateway.ts && echo "tree: current" || echo "tree: TOO OLD — fetch failed"
npm ci --include=dev
```

`git log -1` must print a commit on GitHub `main` (after 2026-09-08 this includes `gateway.ts`). `--include=dev` is required: systemd sets `NODE_ENV=production`, and Vite lives in devDependencies.

The clone has no room file and no secrets file. Those appear under `data/` after the first start. Do not copy `data/relay-room.json` or `data/relay-secrets.json` from another machine unless you intend to move that room.

A zip cannot use **Update from GitHub**.

---

## 5. Start once and confirm

| Script | Command | Bind | Use |
| --- | --- | --- | --- |
| Dev | `npm run dev` | `0.0.0.0:8080` | Edit / preview host |
| Production | `npm run build` then `npm start` | `0.0.0.0:8081` | Pi / 24/7 |

```bash
cd ~/Relay-AV-Room-Control-
npm run build
npm start
```

Leave that terminal open. You should see `Local: http://localhost:8081/`.

Optional: store secrets off the card you back up.

```bash
sudo mkdir -p /var/lib/relay
sudo chown "$USER" /var/lib/relay
export RELAY_SECRETS_FILE=/var/lib/relay/secrets.json
```

- This machine: [http://localhost:8081/](http://localhost:8081/)
- Another device on the same LAN: `http://HOST-IP:8081/`  
  Print the address with `hostname -I`.
- Configurator: [http://localhost:8081/config](http://localhost:8081/config) — PIN `1234`.

Stop the test process with Ctrl+C.

If the page never loads, check that nothing else is bound to 8081 (`ss -lptn | grep 8081`).

### 5b. Firewall (required before tablets live on the LAN)

The process listens on all interfaces. Limit who may connect:

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 8081 proto tcp
# add 10.0.0.0/8 and 172.16.0.0/12 if those are your room nets
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

Adjust the CIDR to the actual room VLAN. Do not `ufw allow 8081/tcp` from anywhere, and do not forward 8081 to the public internet.

---

## 6. Start on boot (systemd)

Linux starts background programs from **unit files**. Relay’s unit is a new file you create:

`/etc/systemd/system/relay.service`

You do not edit anything inside the Relay folder for this step. Stop the test server from §5 first (Ctrl+C in that terminal) so port 8081 is free.

### 6a. Create the file in one paste

This writes the unit with your current username and home directory:

```bash
whoami
echo $HOME
```

You should see a name like `pi` and a path like `/home/pi`. Then paste all of the next block at once:

```bash
USER_NAME="$(whoami)"
HOME_DIR="$HOME"
sudo tee /etc/systemd/system/relay.service >/dev/null <<EOF
[Unit]
Description=Relay room controller
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${HOME_DIR}/Relay-AV-Room-Control-
Environment=PATH=/usr/bin:/usr/local/bin
Environment=PORT=8081
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF
```

`sudo tee …` creates the file as root. You will be asked for the account password. There is no output if it succeeds.

Check the file:

```bash
cat /etc/systemd/system/relay.service
```

`User=` must be your login. `WorkingDirectory=` must be the folder from §4 (usually `/home/YOURNAME/Relay-AV-Room-Control-`).

### 6b. Or create it with an editor

```bash
sudo nano /etc/systemd/system/relay.service
```

Paste this, then change `pi` and `/home/pi` if that is not your account (`whoami` and `echo $HOME`):

```
[Unit]
Description=Relay room controller
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Relay-AV-Room-Control-
Environment=PATH=/usr/bin:/usr/local/bin
Environment=PORT=8081
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
```

Save: Ctrl+O, Enter. Leave the editor: Ctrl+X.

### 6c. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay
sudo systemctl status relay --no-pager
```

`enable --now` means: start immediately and start again after every reboot.

You want `Active: active (running)` in green. Open `http://localhost:8081/` on the Pi.

If it failed:

```bash
sudo journalctl -u relay -e --no-pager
```

Typical causes: the test server from §5 is still running, `WorkingDirectory` is wrong, or Node is not in `/usr/bin` (nvm users: put the nvm `bin` directory on the `Environment=PATH=` line).

Later:

```bash
sudo systemctl restart relay
sudo systemctl stop relay
sudo nano /etc/systemd/system/relay.service
sudo systemctl daemon-reload
sudo systemctl restart relay
```

### 6d. Is it running?

```bash
cd ~/Relay-AV-Room-Control-
bash scripts/relay-status.sh
```

Or without the script:

```bash
sudo systemctl status relay --no-pager
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/
```

`200` means the page is answering. `000` or connection refused means it is not.

---

## 7. Update from GitHub

The application directory must be a clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all**, then **Update from GitHub**. Confirm the warning.

That fetches the release into a separate git worktree, runs `npm ci --include=dev`, builds it, and checks its `/api/room` response before changing the live checkout. A failed stage leaves the running release untouched. After the verified files are switched, systemd restarts Relay; without systemd the updater starts the release and restores and restarts the previous one if readiness fails. Log: `data/relay-update.log`. After a successful update, Room tab version should match `git log -1` (for example `0.8.2.7 (<sha>)`).

`NODE_ENV=production` (systemd) would otherwise skip Vite. `--include=dev` keeps it.

First install still needs a build before `systemctl enable`:

```bash
cd ~/Relay-AV-Room-Control-
npm ci --include=dev
npm run build
sudo systemctl enable --now relay
```

Uncommitted source edits block Update. A dirty `.vercel/` tree (build output) does not. The updater fetches `origin/main` (force-updating tags), builds it in a worktree, then `git checkout -f -B main <sha>`. A zip-only copy cannot use the button. If the button still no-ops, `data/relay-update.log` has the reason.

Manual equivalent (use this if the button failed):

```bash
cd ~/Relay-AV-Room-Control-
sudo systemctl stop relay
rm -rf .vercel
git fetch origin
git checkout -B main origin/main
git log -1 --oneline
test -f src/lib/control/gateway.ts && echo "tree: current" || echo "tree: TOO OLD"
npm ci --include=dev
npm run build
sudo systemctl start relay
```

`git checkout -B main origin/main` matches the published branch. It discards uncommitted edits in the clone (not `data/relay-*.json`).

Check the running tree:

```bash
cd ~/Relay-AV-Room-Control-
git rev-parse --short HEAD
git log -1 --oneline
git merge-base --is-ancestor origin/main HEAD && echo "matches origin/main" || echo "behind GitHub"
```

Optional (only if you want the Node process itself to call `systemctl restart relay`):

```bash
echo "$USER ALL=NOPASSWD: /bin/systemctl restart relay" | sudo tee /etc/sudoers.d/relay
```

The default path does not need that: `system.restart` is `process.exit(1)` and systemd starts it again.

---

## 8. Data

Room configuration is stored in `data/relay-room.json` (layout, IPs) and `data/relay-secrets.json` (PINs, tokens). Copy both off the card before a re-image. Do not put the secrets file in an export or a git repo.

---

## Notes

- Keep Relay on a private LAN. Do not port-forward 8081. Finish §5b before tablets live on the network.
- Serial, GPIO, and CEC only work on the machine that has the hardware.
- Supported run: `npm start` on 8081 after `npm run build`. Dev is `npm run dev` on 8080.
- Check a driver file: `npm run driver:check -- data/drivers/samsung-qe50q65t.json`
