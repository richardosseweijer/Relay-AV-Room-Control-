# Relay — Linux / Raspberry Pi from a blank install

This guide assumes a newly installed 64-bit Debian, Ubuntu, or Raspberry Pi OS. No Node, Git, or extra packages are required beforehand. A network connection that can reach GitHub and deb.nodesource.com is required.

Default configurator PIN after first start: `1234`. Change it before a live room.

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
sudo apt-get install -y gpiod i2c-tools cec-utils lirc
```

| Function | Tool | Package |
|---|---|---|
| LAN | Node 22 | `nodejs` |
| GPIO | `gpioset` | `gpiod` |
| I2C | `i2cset` | `i2c-tools` |
| CEC | `cec-client` | `cec-utils` |
| IR | `ir-ctl` / `irsend` | `lirc` |
| Serial | `/dev/tty*` / `/dev/serial0` | kernel |

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

## 4. Clone Relay

```bash
cd ~
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd ~/Relay-AV-Room-Control-
npm install
```

`npm install` can take several minutes. Deprecation warnings from npm are normal.

A zip download works for a first run (`unzip`, then `cd` into the folder and `npm install`). The in-app **Update from GitHub** button only works on a `git clone`.

---

## 5. Start once and confirm

```bash
cd ~/Relay-AV-Room-Control-
npx vite dev --host 0.0.0.0 --port 8081
```

Leave that terminal open. You should see `Local: http://localhost:8081/`.

- This machine: [http://localhost:8081/](http://localhost:8081/)
- Another device on the same LAN: `http://HOST-IP:8081/`  
  Print the address with `hostname -I`.
- Configurator: [http://localhost:8081/config](http://localhost:8081/config) — PIN `1234`.

Stop the test process with Ctrl+C.

If the page never loads, check that nothing else is bound to 8081 (`ss -lptn | grep 8081`) and that a host firewall is not blocking the port (`sudo ufw allow 8081/tcp` when ufw is active). Do not forward 8081 to the public internet.

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

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${HOME_DIR}/Relay-AV-Room-Control-
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/npx vite dev --host 0.0.0.0 --port 8081
Restart=on-failure
RestartSec=5

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

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/Relay-AV-Room-Control-
Environment=PATH=/usr/bin:/usr/local/bin
ExecStart=/usr/bin/npx vite dev --host 0.0.0.0 --port 8081
Restart=on-failure
RestartSec=5

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

That stops Relay, runs `git pull --ff-only` and `npm install`, then starts it again. Under systemd it runs `systemctl restart relay`. The room is unavailable for about a minute. Log: `data/relay-update.log`.

Uncommitted local edits can block the pull. A zip-only copy cannot use the button.

Manual equivalent:

```bash
cd ~/Relay-AV-Room-Control-
git pull --ff-only
npm install
sudo systemctl restart relay
```

---

## 8. Data

Room configuration is stored in `data/relay-room.json` (layout, IPs) and `data/relay-secrets.json` (PINs, tokens). Copy both off the card before a re-image. Do not put the secrets file in an export or a git repo.

---

## Notes

- Keep Relay on a private LAN. Do not port-forward 8081.
- Serial, GPIO, and CEC only work on the machine that has the hardware.
- The supported run mode is `npx vite dev`. There is no `npm start` script.
- Check a driver file: `npm run driver:check -- data/drivers/samsung-qe50q65t.json`
