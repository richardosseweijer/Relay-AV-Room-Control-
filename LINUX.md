# Relay — Linux / Raspberry Pi from a blank install

Install **`main`** from GitHub (that is the supported tree). Current package version is **0.9.65**. Confirm with the Room tab version field or `git log -1`. 64-bit Debian, Ubuntu, or Raspberry Pi OS.

Default configurator PIN after first start: `1234`. Open `/config` once and set a stronger PIN. New rooms default to **Panel PIN**: every tablet unlocks with that PIN and gets its own session (30 days, sliding). **Open on LAN** is a separate Security setting that skips the panel PIN for anyone who can reach port 8081 — use it only on the room VLAN. Do not confuse it with **open LAN control** (unauthenticated `fireCommand`). See `SECURITY.md`.

**HTTP listen (canonical):** the cleartext panel/API binds the **AV-LAN IPv4** only — never `0.0.0.0`. Resolution order: `RELAY_LISTEN_HOST` if set; else saved AV-LAN IPv4; if AV unset/invalid → **auto-map first scanned NIC** (physical eth/en* before docker/veth/bridges; same Networks scan order; persist into room config — outbound/NIC2 untouched); chosen iface with no IPv4 yet → refuse + boot wait/retry; no scanned NICs → `127.0.0.1` + warning. Tablet URL: `http://<av-lan-ip>:8081` (or your configured port). Finish §5b before tablets go live. Do not port-forward 8081 to venue/WAN. Optional venue HTTPS on the outbound NIC (file PEMs or in-app Generate): [`SECURITY.md` Venue TLS inventory](SECURITY.md#venue-tls-inventory-c0) — Let’s Encrypt / ACME is parked and not required.

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

`node -v` must print `v22` or newer. The repo pins this via `.nvmrc` (`22`) and `package.json` `"engines": { "node": ">=22" }` (npm warns on older Node; we do not set `engine-strict`). If the NodeSource script fails (no outbound HTTPS), install Node 22 from [https://nodejs.org](https://nodejs.org) instead and ensure `node` and `npm` are on `PATH`.

On a Raspberry Pi you may use [nvm](https://github.com/nvm-sh/nvm) instead of NodeSource (`nvm use` / `.nvmrc`). If you do, the systemd unit in §6 must include that user’s nvm `bin` directory on `PATH` (see §6a preflight).

---

## 3. Optional hardware packages

Install these if this machine will drive GPIO, I2C, CEC, or IR. Skip on a plain PC that only talks LAN. Add **`ffmpeg`** when you use the preview tile (RTSP remux).

```bash
sudo apt-get install -y gpiod i2c-tools cec-utils lirc samba-common-bin
# Preview tile only:
# sudo apt-get install -y ffmpeg
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

The header UART is off by default. Enable it: `sudo raspi-config` → Interface Options → Serial Port → login shell **No**, serial hardware **Yes** → reboot. Use **`/dev/serial0`** for GPIO 14/15 (follows the current Pi model; `ttyAMA0` is often Bluetooth on Pi 3/4/5). If scan still has no onboard port, UART is disabled, console still owns it, or you scanned a PC — type `/dev/serial0` by hand only after the steps above. Wiring is 3.3 V TTL, not RS-232; projectors/Denon on the header need a level shifter or USB–serial (`/dev/ttyUSB0`).

---

## 4. Clone Relay (`main`)

Do **not** use a zip, an old tag, or a copy of `dist/` from another machine. The in-app update and this guide both track **`origin/main`**.

**Do not `rm -rf` an existing checkout.** That deletes `data/` (room config + secrets). If `~/Relay-AV-Room-Control-` already exists — especially if `data/` is present — stop and use **Update from GitHub** / §8 instead of recloning.

```bash
cd ~
if [ -d ~/Relay-AV-Room-Control- ]; then
  echo "Checkout already exists at ~/Relay-AV-Room-Control-."
  echo "If this room is live (see data/), use Update (§8) — do not delete the tree."
  echo "Fresh reinstall only after backup, e.g.:"
  echo "  tar -C ~ -czf relay-data-backup.tgz Relay-AV-Room-Control-/data"
  echo "Then remove the tree deliberately and re-run this section."
  exit 1
fi
git clone --branch main --single-branch https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd ~/Relay-AV-Room-Control-
git fetch origin
git checkout -B main origin/main
git log -1 --oneline
test -f src/lib/control/gateway.ts && echo "tree: current" || echo "tree: TOO OLD — fetch failed"
npm ci --include=dev
```

`git log -1` must print a commit on GitHub `main` (after 2026-09-08 this includes `gateway.ts`). `--include=dev` is required: systemd sets `NODE_ENV=production`, and Vite lives in devDependencies.

A fresh clone has no room file and no secrets file. Those appear under `data/` after the first start. Do not copy `data/relay-room.json` or `data/relay-secrets.json` from another machine unless you intend to move that room. A zip cannot use **Update from GitHub**.

---

## 5. Start once and confirm

| Script | Command | Bind | Use |
| --- | --- | --- | --- |
| Dev | `npm run dev` | AV-LAN IPv4 `:8080` (else loopback if no NICs) | Edit / preview host |
| Production | `npm run build` then `npm start` | AV-LAN IPv4 `:8081` (else loopback if no NICs) | Pi / 24/7 |

Listen host: see the canonical rules at the top of this guide. Never `0.0.0.0`.

```bash
cd ~/Relay-AV-Room-Control-
npm run build
npm start
```

Leave that terminal open. Watch for a log line like `[with-app-env] HTTP listen host <av-ipv4>`. **Do not** treat Vite’s `Local: http://localhost:8081/` as the panel URL — once an AV NIC is mapped, loopback often does not answer. Confirm with:

```bash
ss -ltnp | grep 8081
# Expect listen on the AV IPv4 (or 127.0.0.1 only if no scanned NICs) — never 0.0.0.0
```

Open the Configurator at `http://<that-ip>:8081/config` — PIN `1234`.

**Dual-NIC check (before tablets / Foyer):** on a fresh install Relay **auto-maps AV-LAN to the first scanned physical NIC** and **persists** that pick. On a two-NIC box that may be the venue port. In Configurator → Room → **AV-LAN**, confirm the iface is the AV Ethernet; change it and **Save** if wrong, then restart so HTTP re-binds. Do not point tablets or Foyer’s Room-panel URL at the venue NIC.

Optional: store secrets off the card you back up.

```bash
sudo mkdir -p /var/lib/relay
sudo chown "$USER" /var/lib/relay
export RELAY_SECRETS_FILE=/var/lib/relay/secrets.json
```

- Panel / tablets on **AV-LAN**: `http://<av-lan-ipv4>:8081/` (same IP as the listen-host log / `ss`).
- Loopback `http://127.0.0.1:8081/` only when no scanned NICs exist or you set `RELAY_LISTEN_HOST=127.0.0.1` (lab only).

Stop the test process with Ctrl+C. If the page never loads, re-check `ss -ltnp | grep 8081` and that nothing else owns 8081.

### 5b. Firewall + NIC layout (required before tablets live on AV-LAN)

Relay binds cleartext panel/API to the **AV-LAN IPv4** only (never `0.0.0.0`). **ufw** still limits who may connect. Do this on every new room PC before tablets go live.

This chapter covers **one-NIC** and **two-NIC** builds with copy-paste ufw. nftables / firewalld are out of scope — translate yourself if you must. Do not weaken the model below. Peer HMAC (AV HTTP or venue HTTPS) does **not** replace CIDR scoping. Firewall first; HMAC second.

**Example CIDRs in this section** (`192.168.10.0/24` AV, `10.20.30.0/24` venue) are placeholders — replace with yours every time.

#### Overview

| Setup | NICs | HTTP listen | Venue HTTPS | Typical ufw |
|---|---|---|---|---|
| **One-NIC** | Single Ethernet (AV-only / air-gap / lab). Room → **LAN (internet)** = **None**, *or* the same NIC used as outbound for Update | AV IPv4 `:8081` | None (no outbound face) | Allow `8081` from that LAN CIDR; OpenSSH; deny incoming default |
| **Two-NIC** | NIC1 = AV-LAN (no default route); NIC2 = venue/internet (default route) | AV IPv4 `:8081` only | Optional `:8443` on NIC2 when PEMs present | Allow `8081` **from AV CIDR only**; optional `8443` from known venue/admin CIDR (fail-closed — nowhere by default); OpenSSH prefer AV/mgmt |

#### Networks (Room tab)

| Picker | Role |
|---|---|
| **AV-LAN** | Trusted offline control LAN. Panel/API listen. Device sockets (except protocols already designed for open LAN such as Cast / Hue). Tablets live here. **First boot:** if unset/blank/invalid, Relay auto-maps to the first scanned NIC (physical before docker/veth/bridges), persists the pick, and binds HTTP to that IPv4 once known. A valid saved pick is left alone. |
| **LAN (internet)** | Optional venue/outbound NIC for **Update from GitHub** and optional venue HTTPS. Choose **None** for air-gap or single-NIC rooms that must not use venue — Update is then disabled/refused with a clear reason. When set and up, the Room tab shows that NIC’s live IPv4 (Refresh NICs). |

Rules that always hold:

- No IP forwarding and no bridge between NICs.
- AV-LAN must **not** hold the default route.
- NIC2 down / None / missing PEMs / venue-TLS Generate failure must **not** break NIC1.
- Same NIC on both pickers is allowed on a test box only.
- Local panel display (§7): prefer **panel via Foyer** on dual-head; Relay `relay-kiosk` optional/off when Foyer owns the panel head — **no new inbound ports**.

#### Prerequisites

```bash
ip -br a
ip route

# Confirm no forwarding
sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding
# Expect: both = 0
sudo sysctl -w net.ipv4.ip_forward=0
sudo sysctl -w net.ipv6.conf.all.forwarding=0
echo 'net.ipv4.ip_forward=0' | sudo tee /etc/sysctl.d/99-relay-no-forward.conf
echo 'net.ipv6.conf.all.forwarding=0' | sudo tee -a /etc/sysctl.d/99-relay-no-forward.conf
ip link; bridge link 2>/dev/null || true

sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

Write down:

- AV iface name + IPv4 + CIDR (example: `eth0` → `192.168.10.10/24` → CIDR `192.168.10.0/24`)
- Venue iface name + IPv4 + CIDR if two-NIC (example: `eth1` → `10.20.30.50/24` → CIDR `10.20.30.0/24`)
- Whether Room → **LAN (internet)** is **None** or a real NIC

#### Apply AV-LAN IPv4 (Linux / NetworkManager)

Room → Networks → **AV-LAN IPv4 (Linux)** can set **static** or **DHCP** on the saved AV-LAN interface only (not LAN/internet). Confirm dialog + **Config PIN**. On success Relay **restarts** so HTTP re-binds to the new AV IPv4 (never `0.0.0.0`).

- Requires **NetworkManager** (`nmcli` on `PATH`) and a managed connection on the AV iface.
- Apply always clears gateway on that connection and sets `ipv4.never-default yes` — AV-LAN must not take the default route.
- Apply owns a dedicated NM profile named **`relay-av-lan`** (not `netplan-<iface>` in place). On Ubuntu Server, installer YAML often keeps `dhcp4: true` for the same ethernet id; modifying that netplan profile can leave `ipv4.method=auto` with a stale address after `connection up` / reboot. The Relay profile is a separate netplan `NM-<uuid>` key so it does not merge installer DHCP back on. Apply verifies method+address after up.
- Demo/default `room.network.gateway` is **not** applied to AV. DNS / hostname / NTP / NIC2 address are out of scope.
- Windows / non-Linux: Apply returns a clear error (no silent success).
- If `RELAY_LISTEN_HOST` is set and would disagree with the new address, Apply **refuses**.
- After a successful Apply, Relay **soft-updates ufw** so TCP **8081** is allowed from the **new AV CIDR** (comment `Relay-AV-LAN`) and removes prior Relay-tagged 8081-from-CIDR rules. Never opens 8081 to Anywhere / `0.0.0.0/0`. If ufw/sudoers fails, Apply still succeeds — the success message warns; fix sudoers / ufw manually (IP change is more important than firewall).
- When **Foyer** is co-hosted (sibling `Foyer-Room-Signage` with `data/foyer-site.json`, or `FOYER_ROOT`), Apply also rewrites Foyer `relayUrl` / `data/foyer-kiosk.env` `FOYER_ROOM_PANEL_URL` to `http://<new-av-ipv4>:8081` when the current value is empty, loopback, or the **previous** AV IP — never a deliberate remote Relay URL. Best-effort `systemctl try-restart` of `foyer` / `foyer-kiosk` (needs existing Foyer sudoers for this user, or restart manually). Soft-fail with an operator note.

**Without NetworkManager, Relay still runs.** Panel/API listen, tablets, firewall, and Update do not need NM. Only the in-app **Apply AV-LAN IPv4** button needs it. Manual netplan / `ip` addressing remains fine for day-to-day.

##### Ubuntu Server 24.04 — install NetworkManager first (Apply only)

Ubuntu **Desktop** ships NetworkManager. **Ubuntu Server** defaults to **systemd-networkd** via netplan. Installing the `network-manager` package alone is **not** enough: netplan may still render with networkd, so `nmcli device status` shows NICs **unmanaged** (reason **76**) even when `nmcli` is on `PATH`. Do the package install **and** the renderer switch below **before** the sudoers drop-in (and before relying on Apply).

```bash
sudo apt-get install -y network-manager
```

Add a lexicographically last netplan file that sets **only** the renderer. **Keep** existing Ethernet YAML — do not merge interfaces into this file; the last file wins `renderer`.

**Session safety:** Prefer a **local console / HDMI**, or SSH via the **other** NIC (venue/mgmt). **SSH over the AV NIC will drop** on `netplan apply` during the renderer switch. `netplan try` needs an interactive TTY to confirm within the timeout; non-interactive sessions often cannot confirm and end up forcing `apply` with no timed rollback.

**Write the file carefully:** Nested `echo pw | sudo -S tee <<EOF` can create a **0-byte** netplan file. Prefer `sudo bash -c` + `printf` (or an interactive `sudo tee` on a real console).

```bash
# Example — adjust only if you already manage renderer elsewhere
sudo bash -c 'printf "%s\n" "network:" "  version: 2" "  renderer: NetworkManager" > /etc/netplan/99-relay-network-manager.yaml'
# Interactive console alternative:
# sudo tee /etc/netplan/99-relay-network-manager.yaml >/dev/null <<'EOF'
# network:
#   version: 2
#   renderer: NetworkManager
# EOF
sudo netplan apply
# Interactive console with timed rollback (needs TTY confirm):
# sudo netplan try
```

Confirm the **AV** NIC is managed (replace `enp1s0` with your AV iface — identify it explicitly; do not guess from DHCP alone):

```bash
nmcli device status
nmcli -f GENERAL,IP4 device show enp1s0
# Expect AV iface STATE = connected / connecting — not "unmanaged" (reason 76)
```

**Dual-NIC same-subnet gotcha:** When both ports are cabled into the same AV switch/VLAN, both may get DHCP on that subnet. Label/MAC/cable the AV face and set Room → **AV-LAN** to that iface only — Apply must target the AV connection, never the venue/outbound NIC.

**DHCP address drift:** After the renderer switch (or a later renew), the AV IPv4 can change. Re-run **Apply** (or update ufw / Foyer URLs / tablet bookmarks manually). Production Foyer→Relay must use the **AV IPv4**, not `127.0.0.1`.

**Known follow-up:** `systemd-networkd-wait-online` / NetworkManager wait-online can hang at boot when an optional NIC is down or unplugged. This renderer file does not fix that — treat as a separate host systemd tweak if a room PC stalls on boot.

If `nmcli` is missing or the AV NIC stays unmanaged, fix NM/netplan before `install-host-sudoers.sh`. Relay does **not** auto-switch netplan renderers.

##### Host sudoers (nmcli + ufw + kiosk)

Relay stays non-root. Install narrow sudoers drop-ins so the service user can run nmcli / the ufw helper / kiosk systemctl without a password. Prefer the host installer (also installs the §7c kiosk drop-in):

```bash
# From the repo checkout — replaces USER in deploy/sudoers.relay-nmcli,
# deploy/sudoers.relay-ufw, and deploy/sudoers.relay-kiosk; installs
# /usr/local/sbin/relay-ufw-av-lan from deploy/relay-ufw-av-lan.sh.
# Default user: invoking account under sudo, or set RELAY_USER / SUDOERS_USER.
sudo bash scripts/install-host-sudoers.sh
# Or: sudo RELAY_USER=ubuntu bash scripts/install-host-sudoers.sh
```

| Template | Destination | Purpose |
|---|---|---|
| `deploy/sudoers.relay-nmcli` | `/etc/sudoers.d/relay-nmcli` | Apply AV-LAN via `sudo -n nmcli` |
| `deploy/sudoers.relay-ufw` | `/etc/sudoers.d/relay-ufw` | NOPASSWD for `/usr/local/sbin/relay-ufw-av-lan` — 8081 from AV CIDR + `comment Relay-AV-LAN` only |
| `deploy/sudoers.relay-kiosk` | `/etc/sudoers.d/relay-kiosk` | Local display kiosk unit (§7c) |

**One-time host step** — `git pull`, in-app **Update from GitHub**, and reboot do **not** install these drop-ins or the ufw helper; re-run if `User=` on `relay.service` changes, or after adding `relay-ufw`.

Apply spawns `sudo -n nmcli …` then (on success) `sudo -n /usr/local/sbin/relay-ufw-av-lan …` for tagged 8081 rules (helper argv allowlist, no shell; no `ufw disable`; never Anywhere). Missing nmcli sudoers → Apply fails with a clear error pointing here. Missing **ufw** sudoers → Apply still succeeds; success message warns to install `relay-ufw` / update ufw manually. Do **not** run Relay as root; Apply does not use `AmbientCapabilities` / `CAP_NET_ADMIN`.

#### Shared: what NOT to open

- Do **not** `ufw allow 8081/tcp` from anywhere.
- Do **not** port-forward `8080` / `8081` / `8082` / `8443` to WAN / the public internet.
- Do **not** enable IP forward or add masquerade between NICs.
- Optional Foyer on this host: allow `8080` / `8082` **from the AV CIDR only** — still never forward them.

#### A. One-NIC room

**Topology:** Tablets, AV devices, and this PC share one trusted Ethernet LAN (no second NIC). Outbound is **None** (air-gap — no venue HTTPS, Update disabled) or the **same** NIC is also Room → **LAN (internet)** for Update. Same-NIC outbound is **not** two-NIC venue HTTPS unless you have a separate venue CIDR and PEMs. Panel stays on AV HTTP `:8081`.

**ufw (replace CIDR with yours):**

```bash
# Example AV/lab LAN — replace 192.168.10.0/24 with yours
sudo ufw allow from 192.168.10.0/24 to any port 8081 proto tcp
# SSH: management is usually on this same LAN (or a jump host on it)
sudo ufw allow OpenSSH
# Or restrict SSH to the LAN CIDR (preferred when OpenSSH would otherwise mean "any"):
# sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

**Verify**

```bash
sudo ufw status verbose
# Expect: 8081 from your LAN CIDR only; default deny incoming

ss -lptn 'sport = :8081'
# Expect: listen on this NIC’s IPv4 (or 127.0.0.1 only if no scanned NICs) — never 0.0.0.0

# From another host on the same LAN (replace IP):
curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.10.10:8081/
# Expect: HTTP response (200/302/401 — page reachable)

# From a host *not* on that CIDR: expect hang / timeout / blocked — not the panel
```

Optional Foyer ports (same host, still AV CIDR only):

```bash
# Replace 192.168.10.0/24 with yours
# sudo ufw allow from 192.168.10.0/24 to any port 8080 proto tcp
# sudo ufw allow from 192.168.10.0/24 to any port 8082 proto tcp
```

#### B. Two-NIC room

**Topology**

| NIC | Role | Route |
|---|---|---|
| NIC1 (e.g. `eth0`) | **AV-LAN** — tablets + devices + panel HTTP | Subnet route only — **no default route** |
| NIC2 (e.g. `eth1`) | **Venue / internet** — Update from GitHub; optional HTTPS `:8443` | **Default route** |

Room → **AV-LAN** = NIC1. Room → **LAN (internet)** = NIC2 (not None).

```bash
ip route
# Expect: default via NIC2 (venue). AV subnet on NIC1 — no default on AV.
```

**ufw — panel from AV CIDR only (replace CIDRs with yours)**

```bash
# AV example 192.168.10.0/24 — replace with yours
sudo ufw allow from 192.168.10.0/24 to any port 8081 proto tcp
# Do NOT allow 8081 from the venue CIDR or from anywhere
# Do NOT: sudo ufw allow 8081/tcp

# SSH — prefer AV-LAN or a management jump host on AV
sudo ufw allow from 192.168.10.0/24 to any port 22 proto tcp
# If you must SSH on the venue NIC, restrict source (replace 10.20.30.0/24 / admin host):
# sudo ufw allow from 10.20.30.0/24 to any port 22 proto tcp
# Warn: exposing SSH on venue without a source limit is discouraged.

sudo ufw enable
sudo ufw status verbose
```

**Optional venue HTTPS `:8443` (fail-closed)**

Product default: **do not open 8443** until you actually use venue HTTPS tablets or room-to-room venue peers. When you need it, scope to a **known venue/admin CIDR** — never “any”.

```bash
# Only if you use venue HTTPS / venue peers — replace 10.20.30.0/24 with yours
# sudo ufw allow from 10.20.30.0/24 to any port 8443 proto tcp
# Prefer a tighter admin host list when you can:
# sudo ufw allow from 10.20.30.10 to any port 8443 proto tcp
```

HMAC peer over venue HTTPS still requires this CIDR allow (and PEMs + trusted peer CA). Firewall stays fail-closed. See also **Shared: what NOT to open** above.

**Verify**

```bash
ss -lptn 'sport = :8081'
# Expect: AV IPv4 only — never 0.0.0.0, never the venue IPv4

sudo ufw status verbose
# Expect: 8081 from AV CIDR only; 8443 absent unless you opted in with a scoped rule

# From an AV-LAN host (replace IPs):
curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.10.10:8081/

# From a venue-side host: 8081 must fail (timeout / blocked). Do not "fix" that by opening 8081 on venue.
```

Optional Foyer on the same host: `8080` / `8082` from **AV CIDR only** (commands in §A).

#### C. Shared checklist before tablets go live

- [ ] No forward/bridge; AV has **no** default route; venue has default **or** outbound **None**
- [ ] `ss` on `:8081` = **AV IPv4** (or loopback only if no scanned NICs) — never `0.0.0.0`
- [ ] ufw deny-incoming default; `8081` from **AV CIDR only** (never bare `allow 8081/tcp`); no WAN port-forward of `8080`/`8081`/`8082`/`8443`
- [ ] SSH from AV/mgmt (or knowingly scoped on venue); two-NIC `8443` closed or scoped (never “any”)
- [ ] After Apply / prefix change: ufw `Relay-AV-LAN` matches **new** CIDR (or soft-fail warned); co-hosted Foyer URLs updated when empty/loopback/old AV
- [ ] Using Apply? NM + netplan `renderer: NetworkManager` + `install-host-sudoers.sh` (nmcli + ufw + helper). Identify AV iface if both NICs share a subnet
- [ ] §4/`npm ci --include=dev` + §5 build before `install-host.sh`; §6a `relay` enabled; `relay-kiosk` disabled unless Relay-only HDMI (§7)
- [ ] Curl from AV reaches the panel; wrong net does not

#### D. Troubleshooting

| Symptom | Check |
|---|---|
| Tablets can’t reach panel | AV CIDR in ufw matches real tablet subnet; Room → **AV-LAN** is the iface tablets use; `ss` listen host is that AV IPv4 (not venue, not `0.0.0.0`); tablet URL is `http://<av-ip>:8081` |
| After **AV IP Apply**, NIC UP but no IPv4 / method stays `auto` | Ubuntu Server netplan merge: installer `dhcp4: true` won over nmcli `manual` on `netplan-<iface>`. Current Apply uses `relay-av-lan`; disable autoconnect on the old netplan profile or set `dhcp4: false` for that iface in netplan |
| After **AV IP Apply**, tablets die | Prefix/network changed — Apply soft-updates ufw when `sudoers.relay-ufw` + helper are installed; otherwise update ufw manually (`allow from <new-av-cidr> to any port 8081` with comment `Relay-AV-LAN`) and delete the old CIDR rule. Check Apply success message for soft-fail |
| Venue HTTPS works but AV panel broken | Must not be coupled. Confirm AV HTTP still listens (`ss` on `:8081`); venue PEM / `:8443` issues must soft-skip only |
| Accidentally allowed `8081` from anywhere | `sudo ufw status numbered` → `sudo ufw delete <n>` for the open rule; re-add CIDR-scoped allow |
| SSH locked out after ufw enable | Use console / HDMI / existing session; add a scoped SSH allow before enabling from a remote-only path |
| `nmcli` shows **unmanaged** (reason 76) after `apt install network-manager` | Netplan still on networkd — add `/etc/netplan/99-relay-network-manager.yaml` (`renderer: NetworkManager` only), then `netplan apply` from console / other NIC |
| SSH dropped during `netplan apply` / renderer switch | Expected if the session was on the AV NIC; reconnect via console, HDMI, or the other NIC |
| Foyer / tablets miss panel after DHCP / renderer switch | AV IPv4 likely changed — re-run **Apply** (updates ufw + co-hosted Foyer when safe) or manually set Foyer `relayUrl` / kiosk env / bookmarks to `http://<new-av-ip>:8081` (not `127.0.0.1`) |
| Apply succeeded but tablets blocked | ufw still on old CIDR — install `deploy/sudoers.relay-ufw` via `install-host-sudoers.sh`, re-Apply, or allow 8081 from new AV CIDR with comment `Relay-AV-LAN` |
| Wrong net can hit `8081` | Delete broad rules; ensure no venue-sourced allow for `8081`; confirm no WAN port-forward |

Delete a bad rule (example):

```bash
sudo ufw status numbered
# sudo ufw delete 3   # pick the number for the bad 8081-from-anywhere rule
sudo ufw allow from 192.168.10.0/24 to any port 8081 proto tcp   # replace CIDR
sudo ufw status verbose
```

#### Venue HTTPS (optional) + Foyer pointer

Optional venue face: `https://<outbound-ip>:8443` when Room → **LAN (internet)** is set **and** PEMs are present. One-NIC with outbound **None** has no venue face. ufw for `:8443` stays fail-closed (§B). PEM / Generate / peer-CA detail: [`SECURITY.md` Venue TLS inventory](SECURITY.md#venue-tls-inventory-c0). Missing venue PEMs soft-skip HTTPS only; **AV HTTP stays up**.

Foyer (optional) owns `:8080` / `:8082`; occupancy and day-one dual-head: [`FOYER-RELAY.md`](FOYER-RELAY.md). Room → Occupancy paste URL is `http://<av-lan-ipv4>:8081`. Lab only: `RELAY_LISTEN_HOST=127.0.0.1`. Outbound **None** ⇒ **Update from GitHub** unavailable until you pick a venue NIC.

---

## 6. Start on boot (systemd)

Linux starts background programs from **unit files**. Prefer the host installer (substitutes `User=` + checkout path from `deploy/`, `daemon-reload`, enables `relay.service`). It also installs `relay-kiosk.service` but **does not enable it** by default — Foyer dual-head prefers the kiosk off (§7a).

Stop the test server from §5 first (Ctrl+C) so port 8081 is free. Finish `npm ci --include=dev` (§4) + `npm run build` (§5) before enabling.

### 6a. Prefer the host installer (idempotent)

**One-time host step** — `git pull`, in-app **Update from GitHub**, and reboot do **not** install or refresh these units. Re-run if `User=` or the checkout path changes. Re-running **replaces** `/etc/systemd/system/relay.service` and `relay-kiosk.service` from `deploy/` (re-apply any local unit customizations afterward).

**Preflight (before any write):** the installer checks that `/usr/bin/npm` exists, that `node` on the unit PATH (`/usr/bin:/usr/local/bin`, same as `deploy/relay.service`) is **major ≥ 22**, and that `.vercel/output/nitro.json` exists from §5 `npm run build`. Failures leave the host untouched and point at §2 / §5. nvm under `~/.nvm` is invisible to that PATH — use NodeSource (or put Node 22 on `/usr/bin`). Escape hatch for unusual layouts: `--skip-preflight` (also on `install-host.sh`).

```bash
# From the repo checkout — User= from RELAY_USER / SUDO_USER / invoking account.
# WorkingDirectory = this checkout (not a hardcoded ~/… assumption).
sudo bash scripts/install-host.sh
# Units only:  sudo bash scripts/install-host-units.sh
# Units+sudoers is what install-host.sh does (same as --with-sudoers).
# Or: sudo RELAY_USER=ubuntu bash scripts/install-host.sh
#
# Relay-only HDMI kiosk (NOT for Foyer dual-head):
#   sudo bash scripts/install-host-units.sh --enable-kiosk
```

Templates: [`deploy/relay.service`](deploy/relay.service), [`deploy/relay-kiosk.service`](deploy/relay-kiosk.service). `install-host.sh` also runs [`scripts/install-host-sudoers.sh`](scripts/install-host-sudoers.sh) (§5b / §7c).

Check:

```bash
systemctl status relay --no-pager
cat /etc/systemd/system/relay.service
# User= must be your login; WorkingDirectory= this checkout.
systemctl is-enabled relay-kiosk || true   # expect: disabled (default)
```

`enable --now relay` means: start immediately and start again after every reboot. You want `Active: active (running)`. Open `http://<av-lan-ipv4>:8081/` after AV-LAN is set.

If it failed:

```bash
sudo journalctl -u relay -e --no-pager
```

Typical causes: the test server from §5 is still running, `WorkingDirectory` is wrong, or Node is not in `/usr/bin` (nvm users: put the nvm `bin` directory on the `Environment=PATH=` line in the unit, then re-run the installer or `daemon-reload` + restart).

Later:

```bash
sudo systemctl restart relay
sudo systemctl stop relay
# Prefer re-running the installer over hand-editing; or:
sudo nano /etc/systemd/system/relay.service
sudo systemctl daemon-reload
sudo systemctl restart relay
```

### 6b. Manual fallback (only if you cannot run the installer)

**Prefer §6a.** Hand-typed units drift from [`deploy/`](deploy/) and often hardcode the wrong checkout path.

1. Confirm account: `whoami` and `echo $HOME`.
2. Copy the template: `sudo cp deploy/relay.service /etc/systemd/system/relay.service` (from the §4 checkout).
3. Edit that file: replace `User=USER` with your login and `/home/USER/Relay-AV-Room-Control-` with the **absolute** checkout path. Do **not** leave `User=pi` unless that is the real account.
4. Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay
sudo systemctl status relay --no-pager
```

For `relay-kiosk.service`, prefer §7c / the installer — do not enable it on a Foyer dual-head box.

### 6c. Is it running?

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

## 7. Local panel display (HDMI)

Two supported layouts on a dual-head room PC (e.g. Wyse 5070 / Ubuntu Server, two DP/HDMI):

| Model | Display owner | Relay role | Use when |
|---|---|---|---|
| **Panel via Foyer** (preferred same-host dual display) | Foyer (`foyer-kiosk` / sway + up to two Chromiums) | Serves HTTP on AV-LAN only (`:8081`). No local compositor. | Welcome on one head + Relay control UI on the other, both under Foyer |
| **Relay local HDMI kiosk** (optional) | Relay (`relay-kiosk` / cage + Chromium on tty1) | Serves HTTP **and** paints the panel on one DRM connector | Relay-only box, or Foyer not driving a Room panel head |

**Do not run both compositors on the same host.** `relay-kiosk` and `foyer-kiosk` both take tty1 / DRM. When Foyer paints the Room panel head, leave Relay’s kiosk **off** (§7a).

HTTP listen is unchanged in either model: AV-LAN IPv4 only (`http://<av-lan-ipv4>:8081/`), never `0.0.0.0`.

### 7a. Panel via Foyer — disable Relay `relay-kiosk`

**Start here for same-host dual-head:** the ordered day-one checklist lives in [`FOYER-RELAY.md`](FOYER-RELAY.md) → **Day-one dual-head (same host)** (identical copy in the Foyer repo). Use that first; this section keeps the disable steps.

Supported path when Foyer and Relay share one PC and Foyer Setup has a **Room panel HDMI** pick. Foyer owns the displays; Relay only answers on AV-LAN.

Operator steps:

1. **Foyer Setup** — set **Welcome HDMI** and/or **Room panel HDMI** (different connectors if both). Room panel Relay URL = this PC’s AV-LAN base (`http://<av-lan-ipv4>:8081`). Lab checklist: Foyer [`INSTALL.md`](https://github.com/richardosseweijer/Foyer-Room-Signage/blob/main/INSTALL.md) §7b / §7c.
2. **Relay Configurator → Room → Local display (HDMI)** — leave **Enable local HDMI panel** unchecked (default), or **uncheck** it and **Save**. Unchecking and saving runs `systemctl disable --now relay-kiosk` (bare, then `sudo -n`) so the unit cannot fight Foyer’s dual-head seat. Needs `/etc/sudoers.d/relay-kiosk` (§7c / `scripts/install-host-sudoers.sh`); missing sudoers → clear operator error pointing here.
3. **CLI fallback** (optional if the unit was enabled before sudoers / Configurator save):

```bash
sudo systemctl disable --now relay-kiosk
systemctl is-enabled relay-kiosk || true   # expect: disabled / not-found
systemctl status relay-kiosk --no-pager || true
```

Temporary stop without clearing enablement: `sudo systemctl stop relay-kiosk`.

Confirm only Foyer’s unit owns the seat: `systemctl status foyer-kiosk --no-pager` (on the Foyer install). Wire / occupancy stay [`FOYER-RELAY.md`](FOYER-RELAY.md).

If you later need Relay’s own HDMI kiosk again (no Foyer Room panel on this host), re-enable with §7b / §7c after Foyer’s Room panel pick is cleared and `foyer-kiosk` is not claiming that head.

### 7b. Relay local HDMI kiosk (optional)

Same pattern as a single-head Foyer welcome kiosk: **cage** on tty1 + Chromium on Wayland, pinned to one DRM connector. The kiosk opens the **live AV-LAN panel URL** (`http://<av-lan-ipv4>:8081/`), not `127.0.0.1` and never `0.0.0.0`. HTTP listen stays AV-LAN only.

Skip until §5 answers on the AV IPv4 and §6 has `relay.service` enabled. Skip entirely when §7a applies (Foyer drives the Room panel head).

`seatd`, `cage`, and `wlr-randr` are in Ubuntu **universe** (noble). On a minimal Server image, if `apt-cache policy cage` shows no candidate, enable universe then update:

```bash
sudo apt-get install -y software-properties-common
sudo add-apt-repository -y universe
sudo apt-get update
```

```bash
sudo apt-get install -y seatd cage wlr-randr fonts-liberation fonts-noto-core mesa-vulkan-drivers libgl1-mesa-dri
sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
sudo systemctl enable --now seatd
sudo usermod -aG video,render,input,tty "$USER"
sudo loginctl enable-linger "$USER"
```

Log out and back in (or reboot) so the `video` / `render` groups apply. `echo $XDG_RUNTIME_DIR` should print `/run/user/$(id -u)`.

**Ubuntu 24.04 Chromium = snap** (`which chromium` → `/snap/bin/…`). On this appliance set `RELAY_KIOSK_NO_SANDBOX=1` in `data/relay-kiosk.env` when `journalctl -u relay-kiosk` shows namespace / sandbox errors under cage. Leave unset until then. Prefer a non-snap Chromium `.deb` on distros that ship one. Do not enable `NO_SANDBOX` on shared desktops. `unclutter` is X11 — skip under cage.

Disable blanking and sleep:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### 7c. Kiosk unit

Cage needs a real HDMI connected **before** start. This unit **takes tty1** from the Ubuntu login prompt so Chromium covers that console. SSH is unchanged.

**Prefer the host installer** (§6a). Default install leaves `relay-kiosk` **disabled** (safe for Foyer dual-head). Enable only for Relay-only HDMI:

```bash
# After §7b packages + groups + linger (and log out/in):
sudo bash scripts/install-host-units.sh --enable-kiosk
# Or first-boot with kiosk: sudo bash scripts/install-host.sh --enable-kiosk
sudo systemctl status relay-kiosk --no-pager
```

#### Manual fallback (only if you cannot run the installer)

**Prefer the installer above.** Copy [`deploy/relay-kiosk.service`](deploy/relay-kiosk.service) to `/etc/systemd/system/relay-kiosk.service`, replace `User=USER` and `/home/USER/Relay-AV-Room-Control-` with the service account and §4 checkout path (same idea as §6b), `chmod +x scripts/relay-kiosk.sh`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay-kiosk
sudo systemctl status relay-kiosk --no-pager
```

Room → **Local display (HDMI)** saves `data/relay-kiosk.env` (`RELAY_VIDEO_OUTPUT` + `RELAY_KIOSK_URL`) and can restart this unit. Wrong output can blank the console page; SSH stays up.

Configurator restart needs passwordless `systemctl` for this unit only. Relay stays non-root and runs `sudo -n systemctl restart relay-kiosk.service`. Missing sudoers → clear operator error pointing here (not raw polkit text).

**Required once on the appliance:** Local display **Save** can write `data/relay-kiosk.env` while **restart** still fails (polkit / Access denied) if `/etc/sudoers.d/relay-kiosk` is missing. Pull / Update / reboot do **not** install sudoers — run `install-host-sudoers.sh` (§5b) once; re-run if `User=` changes.

```bash
sudo bash scripts/install-host-sudoers.sh
# Or: sudo RELAY_USER=ubuntu bash scripts/install-host-sudoers.sh
sudo -u "$(whoami)" sudo -n /usr/bin/systemctl is-active relay-kiosk.service || true
```

**Relay-only HDMI** needs the kiosk drop-in for save/restart. **Foyer dual-head:** leave `relay-kiosk` off (§7a); sudoers is harmless while disabled. Do **not** merge drop-ins into `NOPASSWD: ALL`.

cage `-d` skips client decorations. It does **not** use `-s` (that flag allows switching back to the text console).

If the kiosk stays on the Ubuntu login TTY: the unit is the old one (no `Conflicts=getty@tty1`). Re-run this section, then `sudo systemctl daemon-reload && sudo systemctl restart relay-kiosk`. Next step: `sudo journalctl -u relay-kiosk -e`. Confirm the panel from a config laptop at `http://<av-lan-ipv4>:8081/` (not loopback once AV-LAN is set).

---

## 8. Update from GitHub

The application directory must be a clone of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all**, then **Update from GitHub**. Confirm the warning.

That fetches the release into a separate git worktree, runs `npm ci --include=dev`, builds it, and checks its `/api/room` response before changing the live checkout. A failed stage leaves the running release untouched. After the verified files are switched, systemd restarts Relay; without systemd the updater starts the release and restores and restarts the previous one if readiness fails. Log: `data/relay-update.log`. After a successful update, Room tab version should match `git log -1` (for example `0.9.65 (<sha>)`).

`NODE_ENV=production` (systemd) would otherwise skip Vite. `--include=dev` keeps it.

First install still needs a build before enabling the unit:

```bash
cd ~/Relay-AV-Room-Control-
npm ci --include=dev
npm run build
sudo bash scripts/install-host.sh   # or: sudo systemctl enable --now relay if unit already installed
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

**After Update / reboot — host units + sudoers checklist:** Update refreshes the checkout only. Units and sudoers under `/etc` are **not** installed by pull/Update/reboot. If `relay.service` is missing/stale, (re)run `sudo bash scripts/install-host-units.sh` (§6a). If Room → Local display **Save** still fails auth (polkit / Access denied), or **Apply AV-LAN IP** fails nmcli auth or ufw soft-fails, (re)run `sudo bash scripts/install-host-sudoers.sh` (§5b / §7c) — or `sudo bash scripts/install-host.sh` for both.

- [ ] Ran `sudo bash scripts/install-host.sh` (or verified units + drop-ins present)
- [ ] `/etc/systemd/system/relay.service` — boot unit (§6a); `relay-kiosk.service` present, enabled only if Relay-only HDMI
- [ ] `/etc/sudoers.d/relay-nmcli` — AV-LAN Apply (§5b)
- [ ] `/etc/sudoers.d/relay-ufw` + `/usr/local/sbin/relay-ufw-av-lan` — Apply soft-update of 8081 from AV CIDR (§5b)
- [ ] `/etc/sudoers.d/relay-kiosk` — Local display restart (`relay-kiosk.service`, §7c)

---

## 9. Data

Room configuration is stored in `data/relay-room.json` (layout, IPs) and `data/relay-secrets.json` (PINs, tokens). Copy both off the card before a re-image. Do not put the secrets file in an export or a git repo.

---

## 10. Uninstall / teardown (host units + sudoers)

The installers are **safe to re-run** (they overwrite units/sudoers from `deploy/`). To remove the host pieces only:

```bash
sudo systemctl disable --now relay.service relay-kiosk.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/relay.service /etc/systemd/system/relay-kiosk.service
sudo systemctl daemon-reload
sudo rm -f /etc/sudoers.d/relay-kiosk /etc/sudoers.d/relay-nmcli /etc/sudoers.d/relay-ufw
sudo rm -f /usr/local/sbin/relay-ufw-av-lan
# Optional lab-only drop-in from §8:
# sudo rm -f /etc/sudoers.d/relay
```

`data/` in the checkout holds room config + secrets (`relay-room.json`, `relay-secrets.json`, TLS PEMs). **Back it up before deleting the checkout** (see §4 / §9). Removing units does not delete `data/`.

## Notes

- Keep the panel on AV-LAN only. Do not port-forward 8081 to venue/WAN. Finish §5b before tablets live on the network.
- Serial, GPIO, and CEC only work on the machine that has the hardware.
- Supported run: `npm start` on AV-LAN `:8081` after `npm run build`. Dev is `npm run dev` on `:8080` (same listen rules).
- Check a driver file: `npm run driver:check -- data/library/samsung-qe50q65t.json`
- Samsung lab pair (TLS fail-closed): `node scripts/samsung-pair.mjs <tv-ip> 8002 --insecure` then re-run with `--fingerprint=<printed>` (or `--ca=<pem>`).
