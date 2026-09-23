# Relay — Linux / Raspberry Pi from a blank install

Install **`main`** from GitHub (that is the supported tree). Current package version is **0.9.46** (beta; venue TLS C0–C4 checkpoint). Confirm with the Room tab version field or `git log -1`. 64-bit Debian, Ubuntu, or Raspberry Pi OS.

Default configurator PIN after first start: `1234`. Open `/config` once and set a stronger PIN. New rooms default to **Panel PIN**: every tablet unlocks with that PIN and gets its own session (30 days, sliding). **Open on LAN** is a separate Security setting that skips the panel PIN for anyone who can reach port 8081 — use it only on the room VLAN. Do not confuse it with **open LAN control** (unauthenticated `fireCommand`). See `SECURITY.md`.

This host binds the cleartext panel/API to the **AV-LAN IPv4** only (never `0.0.0.0`). Tablet URL: `http://<av-lan-ip>:8081` (or your configured port). Before you call the install finished, finish the dual-NIC / firewall checklist in §5b. Do not port-forward 8081 to venue/WAN. Optional **file-based HTTPS** on the venue NIC is **shipped B1** (set `RELAY_TLS_CERT`/`RELAY_TLS_KEY` or room `tlsCertPath`/`tlsKeyPath`, outbound NIC not None; default port 8443). **Let’s Encrypt / ACME / DNS-01 is PARKED** — not required. **Shipped (C1–C4):** Generate (API + Networks UI), CA download, mismatch / expiry banners, regenerate confirm, OS hints; docs consistency + checkpoint tag `v0.9.46`. See [`SECURITY.md` Venue TLS inventory](SECURITY.md#venue-tls-inventory-c0).

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
| Preview tile | `ffmpeg` RTSP remux | `ffmpeg` |

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

Do **not** use a zip, an old tag (`v0.7.3`), or a copy of `dist/` from another machine. The in-app update and this guide both track **`origin/main`**. `v0.9.46` is a snapshot of this beta (venue TLS C0–C4 checkpoint; Phase B was `v0.9.45`).

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
| Dev | `npm run dev` | AV-LAN IPv4 `:8080` (else loopback) | Edit / preview host |
| Production | `npm run build` then `npm start` | AV-LAN IPv4 `:8081` (else loopback) | Pi / 24/7 |

Listen host resolution: `RELAY_LISTEN_HOST` if set; else AV-LAN IPv4; AV unset → `127.0.0.1` + warning; AV set with no IPv4 → refuse. Never `0.0.0.0`.

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

- On the host, open the panel via the **AV IPv4** (same as tablets): `http://<av-lan-ipv4>:8081/`. Loopback `http://127.0.0.1:8081/` only works when listen is loopback (AV unset) or you set `RELAY_LISTEN_HOST=127.0.0.1` (lab only).
- Wall tablet / other device on **AV-LAN**: `http://<av-lan-ipv4>:8081/`  
  Print the AV address after setting Room → **AV-LAN** (or `ip -4 addr show <av-iface>`). Do not use the venue/internet NIC address for the panel.
- Configurator: `http://<av-lan-ipv4>:8081/config` — PIN `1234`.

Stop the test process with Ctrl+C.

If the page never loads, check that nothing else is bound to 8081 (`ss -lptn | grep 8081`).

### 5b. Dual-NIC + firewall (required before tablets live on AV-LAN)

Relay binds HTTP to the **AV-LAN IPv4** only. ufw still limits who may connect. Do this on every room PC.

#### Networks (Room tab)

| Picker | Role |
|---|---|
| **AV-LAN** | Trusted offline control LAN. Panel/API listen. Device sockets (except protocols already designed for open LAN such as Cast / Hue). Tablets live here. |
| **LAN (internet)** | Optional venue/outbound NIC for **Update from GitHub**. Choose **None** for air-gap or single-NIC rooms — Update is then disabled/refused with a clear reason. When set and up, the Room tab shows that NIC’s live IPv4 (Refresh NICs) so you can copy the raw address without DNS/LE. |

On a two-NIC Ubuntu room PC:

- AV-LAN has **no default route**.
- NIC2 (venue) has the **default route**, **or** is **None**.
- NIC2 down / None / missing PEMs / a future venue-TLS Generate failure must **not** break NIC1.
- No IP forward and no bridge between the two NICs.
- Same NIC on both pickers is allowed on a test box only.

#### Apply AV-LAN IPv4 (Linux / NetworkManager)

Room → Networks → **AV-LAN IPv4 (Linux)** can set **static** or **DHCP** on the saved AV-LAN interface only (not LAN/internet). Confirm dialog + **Config PIN** (same bar as Restart / Update). On success Relay **restarts** so HTTP re-binds to the new AV IPv4 (never `0.0.0.0`).

- Requires **NetworkManager** (`nmcli` on `PATH`) and a managed connection on the AV iface.
- Apply always clears gateway on that connection and sets `ipv4.never-default yes` — AV-LAN must not take the default route.
- Demo/default `room.network.gateway` is **not** applied to AV.
- DNS / hostname / NTP / NIC2 address are out of scope.
- Windows / non-Linux: Apply returns a clear error (no silent success).
- If `RELAY_LISTEN_HOST` is set and would disagree with the new address, Apply **refuses**.
- Changing prefix/network: update **ufw** to the new AV CIDR (Apply does not edit ufw).

Privilege: Relay stays non-root. Install a narrow sudoers drop-in so the service user can run nmcli without a password:

```bash
# Replace $USER with the systemd User= (often pi)
echo "$USER ALL=NOPASSWD: /usr/bin/nmcli" | sudo tee /etc/sudoers.d/relay-nmcli
sudo chmod 440 /etc/sudoers.d/relay-nmcli
sudo visudo -cf /etc/sudoers.d/relay-nmcli
```

Apply spawns `sudo -n nmcli …` (argv allowlist, no shell). Missing sudoers → clear operator error pointing here. Do **not** run Relay as root; MR1 does not use `AmbientCapabilities` / `CAP_NET_ADMIN`.

```bash
# No forward / no bridge between AV and venue
sudo sysctl -w net.ipv4.ip_forward=0
sudo sysctl -w net.ipv6.conf.all.forwarding=0
# persist (Debian/Ubuntu):
echo 'net.ipv4.ip_forward=0' | sudo tee /etc/sysctl.d/99-relay-no-forward.conf
echo 'net.ipv6.conf.all.forwarding=0' | sudo tee -a /etc/sysctl.d/99-relay-no-forward.conf
# Confirm there is no br-* joining the two NICs: ip link; bridge link
```

#### ufw — panel from AV CIDR only

Replace `192.168.25.0/24` with your real AV-LAN CIDR. Do **not** allow the panel from the venue NIC or from anywhere.

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.25.0/24 to any port 8081 proto tcp
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

Do not `ufw allow 8081/tcp` from anywhere. Do not port-forward 8080, 8081, or 8082 to venue/WAN / the public internet.

#### Verify

```bash
ip route
# Expect: default via venue NIC (or no default if outbound is None / air-gap).
# Expect: AV subnet route on the AV interface — no default on AV.

ss -lptn 'sport = :8081'
# Expect: listen on the AV IPv4 (or 127.0.0.1 if AV-LAN is unset) — never 0.0.0.0.

sudo ufw status
# Expect: 8081 allowed from AV CIDR only.
```

Outbound **None** ⇒ Room → **Update from GitHub** unavailable until you pick a venue NIC. That is intentional.

#### Venue HTTPS (shipped B1) — PEM drop paths

Optional venue HTTPS: `https://<outbound-ip>:8443` when outbound NIC is set **and** PEMs are readable.

| How | Paths |
|---|---|
| Env (wins) | `RELAY_TLS_CERT` + `RELAY_TLS_KEY` → absolute PEM file paths |
| Room fields | `tlsCertPath` + `tlsKeyPath` on the room object (same idea) |
| Port | `RELAY_HTTPS_PORT` (default **8443**) |

**C1 Generate** also writes `data/tls/venue/server.{cert,key}.pem` and wires room paths. You may still drop PEMs where you like (e.g. `/var/lib/relay/tls/cert.pem` + `key.pem`) and point the env/room fields at them. Missing/unreadable PEMs ⇒ soft-skip venue HTTPS only; **AV HTTP stays up**. Raw venue IPv4 is fine (Networks UI live IP). B3: HMAC peer over that venue HTTPS (`peerFace`) with **strict trusted peer CA** (Devices → Trusted peer CA path = remote **Download CA** PEM; fail-closed if missing). B4: per-device `nicFace` bind (AV default; venue soft-fails if outbound None). Device HTTPS/TLS-WS: set **Device trusted CA path** or **sha256 pin** (venue fail-closed if missing; `v0.9.48`). Cast stays AV-only. Lab Samsung pair: `node scripts/samsung-pair.mjs <tv-ip> 8002 --fingerprint=<sha256>` (or `--insecure` once to print fingerprint; fail-closed without trust; `v0.9.49`).

**Guest / venue LAN reality:** NIC2 is often a guest or venue segment with no admin DNS, no Cloudflare, and no LE account. **LE/ACME/DNS-01 is PARKED permanently** for this product — do not require public FQDN for venue HTTPS.

#### Generate venue TLS (shipped C1–C4) — API + Networks UI + lifecycle

In-box **ECDSA P-256** private CA (~10y) + server leaf (~2y) with IP SAN = live outbound/NIC2 IPv4. No openssl shell-out; no ACME/LE.

| Step | Detail |
|---|---|
| API | Config-token gated `generateVenueTls` / `getVenueTlsStatus` (see `actions-venue-tls.ts`) |
| Networks UI | Room → Networks: **Generate / Regenerate venue certificate** + status (active / SAN IP / expiry with days-left / fingerprint) |
| Paths | `data/tls/venue/ca.cert.pem`, `ca.key.pem`, `server.cert.pem`, `server.key.pem` (keys mode `0600`) |
| B1 wire | Sets room `tlsCertPath` / `tlsKeyPath` to the server pair (env `RELAY_TLS_*` still wins) |
| Reload | Venue HTTPS reloads; AV HTTP stays up. Soft-skip if outbound is None / no IPv4 |
| CA download | Same-origin **Download CA** → `GET /api/venue-tls-ca` (config token); PEM only — never private keys. Use on NIC2 HTTPS after browser click-through (no AV-LAN hop). |
| Mismatch / expiry | Banner when live NIC2 IPv4 ∉ leaf SAN or leaf ≤30d / expired → **Regenerate** (explicit confirm; no silent auto-reissue) |
| OS hints | Brief iOS / Android / Windows / macOS notes next to Download CA |

**Integrator flow (NIC2):** open `https://<outbound-ip>:8443/config` → accept click-through → unlock → Networks → Generate → Download CA → install CA on tablets → reopen venue URL. On IP drift or leaf nearing expiry, **Regenerate** (confirm) → re-Download CA if the CA changed → reinstall on tablets.

**Room-to-room CA exchange (venue peers):** On room B, Networks → **Download CA** → save PEM on room A (e.g. `data/tls/peers/room-b-ca.cert.pem`). On room A’s `relay-host` device pointing at B’s NIC2 IP:8443, set Peer face Venue (or Auto) and **Trusted peer CA path** to that file (or paste / `RELAY_PEER_TRUSTED_CA`). Reverse for B→A. Same-install loop: use this room’s `data/tls/venue/ca.cert.pem`. Venue peer TLS failure soft-fails that peer only — AV control stays up.

**C4 shipped:** docs consistency + checkpoint tag `v0.9.46`. **Strict peer TLS** (`v0.9.47`) + **strict device TLS** (`v0.9.48`) + **strict samsung-pair TLS** (`v0.9.49`). No silent auto-reissue (by design). Foyer control URL prefers AV live IP (footgun fixed).

File PEM drop (table above) still works. AV tablet URL remains `http://<av-lan-ip>:8081`. Inventory: [`SECURITY.md`](SECURITY.md#venue-tls-inventory-c0).

Foyer (optional, separate process) owns `:8080` / `:8082`; Relay production is `:8081`. Occupancy: Foyer GETs Relay on this PC’s **AV-LAN IPv4 `:8081`** (loopback lab escape); calendar session: Relay GETs Foyer on loopback `:8080` — [`FOYER-RELAY.md`](FOYER-RELAY.md). Foyer occupancy is the Occupancy variable (`0` closed, `1` open, `2` in session, `3` do not disturb) or a Relay Occupancy command. Foyer GETs `/api/peer` and reads the string `occupancy` field. Room names do not need to match.

**Foyer control URL:** prefers the live AV-LAN IPv4 (`http://<av-lan-ipv4>:8081`) — Room → Occupancy shows the paste URL. Soft-fails if AV unset / no IPv4. Same-PC hairpin to that listen address is allowed for unsigned occupancy GET. Do not widen listen to `0.0.0.0`. Lab only: `RELAY_LISTEN_HOST=127.0.0.1`. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

If Foyer is installed on this host, also allow the door/welcome ports from AV-LAN (still do not forward them):

```bash
# sudo ufw allow from 192.168.25.0/24 to any port 8080 proto tcp
# sudo ufw allow from 192.168.25.0/24 to any port 8082 proto tcp
```

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

You want `Active: active (running)` in green. Open `http://<av-lan-ipv4>:8081/` on the Pi (after AV-LAN is set).

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
ss -lptn 'sport = :8081'
# curl the AV IPv4 shown by ss (not 127.0.0.1 once AV-LAN is set):
# curl -s -o /dev/null -w "%{http_code}\n" http://<av-lan-ipv4>:8081/
```

`200` means the page is answering. `000` or connection refused means it is not. After AV-LAN is set, probing `127.0.0.1` will fail — that is expected.

---


## 7. Panel on local HDMI (kiosk)

Optional. Same pattern as Foyer welcome kiosk: **cage** on tty1 + Chromium on Wayland, pinned to one DRM connector. The kiosk opens the **live AV-LAN panel URL** (`http://<av-lan-ipv4>:8081/`), not `127.0.0.1` and never `0.0.0.0`. HTTP listen stays AV-LAN only.

Skip until §5 answers on the AV IPv4 and §6 has `relay.service` enabled.

```bash
sudo apt-get install -y seatd cage wlr-randr fonts-liberation fonts-noto-core mesa-vulkan-drivers libgl1-mesa-dri
sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
sudo systemctl enable --now seatd
sudo usermod -aG video,render,input,tty "$USER"
sudo loginctl enable-linger "$USER"
```

Log out and back in (or reboot) so the `video` / `render` groups apply. `echo $XDG_RUNTIME_DIR` should print `/run/user/$(id -u)`.

If `chromium` is missing, try `chromium-browser`. Snap Chromium under cage often needs `--no-sandbox` on a dedicated PC — set `RELAY_KIOSK_NO_SANDBOX=1` in `data/relay-kiosk.env` only if `journalctl -u relay-kiosk` shows namespace errors. Do not enable it by default.

`unclutter` is X11 and does nothing under cage. Skip it.

Disable blanking and sleep:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### 7a. Kiosk unit

Cage needs a real HDMI connected **before** start. This unit **takes tty1** from the Ubuntu login prompt so Chromium covers that console. SSH is unchanged.

```bash
USER_NAME="$(whoami)"
HOME_DIR="$HOME"
REPO_DIR="${HOME_DIR}/Relay-AV-Room-Control-"
chmod +x "${REPO_DIR}/scripts/relay-kiosk.sh"
sudo tee /etc/systemd/system/relay-kiosk.service >/dev/null <<EOF
[Unit]
Description=Relay panel kiosk (local HDMI)
After=relay.service systemd-user-sessions.service plymouth-quit-wait.service
Requires=relay.service
Conflicts=getty@tty1.service
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=${USER_NAME}
SupplementaryGroups=video render input tty
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UnsetEnvironment=TERM
Environment=XDG_SESSION_TYPE=wayland
Environment=XDG_RUNTIME_DIR=/run/user/%U
Environment=WLR_LIBINPUT_NO_DEVICES=1
EnvironmentFile=-${REPO_DIR}/data/relay-kiosk.env
ExecStartPre=+/bin/chvt 1
ExecStart=/usr/bin/cage -d -- ${REPO_DIR}/scripts/relay-kiosk.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now relay-kiosk
sudo systemctl status relay-kiosk --no-pager
```

Room → **Local display (HDMI)** saves `data/relay-kiosk.env` (`RELAY_VIDEO_OUTPUT` + `RELAY_KIOSK_URL`) and can restart this unit. Wrong output can blank the console page; SSH stays up.

Configurator restart needs passwordless systemctl for this unit only:

```bash
USER_NAME="$(whoami)"
sudo tee /etc/sudoers.d/relay-kiosk >/dev/null <<EOF
${USER_NAME} ALL=(root) NOPASSWD: /usr/bin/systemctl start relay-kiosk.service, /usr/bin/systemctl restart relay-kiosk.service, /usr/bin/systemctl try-restart relay-kiosk.service, /usr/bin/systemctl stop relay-kiosk.service
EOF
sudo chmod 440 /etc/sudoers.d/relay-kiosk
sudo visudo -c
```

Templates: `deploy/relay-kiosk.service`, `deploy/sudoers.relay-kiosk`.

cage `-d` skips client decorations. It does **not** use `-s` (that flag allows switching back to the text console).

If the kiosk stays on the Ubuntu login TTY: the unit is the old one (no `Conflicts=getty@tty1`). Re-run this section, then `sudo systemctl daemon-reload && sudo systemctl restart relay-kiosk`. Next step: `sudo journalctl -u relay-kiosk -e`. Confirm the panel from a config laptop at `http://<av-lan-ipv4>:8081/` (not loopback once AV-LAN is set).

---

## 8. Update from GitHub

The application directory must be a clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all**, then **Update from GitHub**. Confirm the warning.

That fetches the release into a separate git worktree, runs `npm ci --include=dev`, builds it, and checks its `/api/room` response before changing the live checkout. A failed stage leaves the running release untouched. After the verified files are switched, systemd restarts Relay; without systemd the updater starts the release and restores and restarts the previous one if readiness fails. Log: `data/relay-update.log`. After a successful update, Room tab version should match `git log -1` (for example `0.9.42 (<sha>)`).

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

For **Apply AV-LAN IP**, also install the nmcli sudoers drop-in in §5b (`/etc/sudoers.d/relay-nmcli`). You may keep both drop-ins.

---

## 9. Data

Room configuration is stored in `data/relay-room.json` (layout, IPs) and `data/relay-secrets.json` (PINs, tokens). Copy both off the card before a re-image. Do not put the secrets file in an export or a git repo.

---

## Notes

- Keep the panel on AV-LAN only. Do not port-forward 8081 to venue/WAN. Finish §5b before tablets live on the network.
- Serial, GPIO, and CEC only work on the machine that has the hardware.
- Supported run: `npm start` on AV-LAN `:8081` after `npm run build`. Dev is `npm run dev` on `:8080` (same listen rules).
- Check a driver file: `npm run driver:check -- data/library/samsung-qe50q65t.json`
- Samsung lab pair (TLS fail-closed): `node scripts/samsung-pair.mjs <tv-ip> 8002 --insecure` then re-run with `--fingerprint=<printed>` (or `--ca=<pem>`).
