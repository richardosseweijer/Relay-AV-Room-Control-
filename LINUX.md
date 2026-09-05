# Relay — Linux / Raspberry Pi

Works on Debian, Ubuntu, Raspberry Pi OS (64-bit), and similar.

Default login after first start: config PIN `1234`. Change it before a real room.

## 1. Packages

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git gpiod i2c-tools cec-utils lirc
node -v   # expect v22.x
```

On Raspberry Pi you can use [nvm](https://github.com/nvm-sh/nvm) instead of the NodeSource apt repo. If you do, put the nvm `node` on `PATH` for the service user (see §4).

| Relay interface | Tool | Package |
|---|---|---|
| LAN | Node 22 | `nodejs` |
| GPIO | `gpioset` | `gpiod` |
| I2C | `i2cset` | `i2c-tools` |
| CEC | `cec-client` | `cec-utils` |
| IR | `ir-ctl` / `irsend` | `lirc` |
| Serial | `/dev/tty*` | kernel |
| SPI | `spidev_test` | not a standard apt package; add later if you use SPI |

On a Pi, enable I2C / Serial / SPI in `sudo raspi-config` → Interface Options, then reboot.

## 2. Get the project

```bash
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd Relay-AV-Room-Control-
npm install
```

If you only have a zip, unpack it and `cd` into that folder instead, then `npm install`.

## 3. Test once

```bash
npx vite dev --host 0.0.0.0 --port 8081
```

On this machine: [http://localhost:8081/](http://localhost:8081/)  
From a phone: `http://PI-IP:8081/` — `hostname -I` prints the address.  
Configurator: [http://localhost:8081/config](http://localhost:8081/config) — PIN `1234`.

Ctrl+C when it looks healthy.

## 4. Start on boot (systemd)

Replace `pi` and the path if your user or folder differ.

```bash
sudo tee /etc/systemd/system/relay.service >/dev/null <<'EOF'
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
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now relay
sudo systemctl status relay --no-pager
```

If Node came from nvm, set `User` to that account and add the nvm bin dir to `Environment=PATH=...`.

Useful later:

```bash
sudo systemctl restart relay
sudo journalctl -u relay -f
```

After `git pull && npm install`, run `sudo systemctl restart relay`.

## 5. Update from GitHub

The folder must be a `git clone` of [Relay-AV-Room-Control-](https://github.com/richardosseweijer/Relay-AV-Room-Control-).

Configurator → Room → **Save all**, then **Update from GitHub**. Confirm the warning.

That stops Relay, runs `git pull --ff-only` and `npm install`, then starts it again. Under systemd it runs `systemctl restart relay`. The room is down for a minute. Log: `data/relay-update.log`.

Local uncommitted edits can block the pull. Zip installs cannot use this button.

Manual:

```bash
cd Relay-AV-Room-Control-
git pull --ff-only
npm install
sudo systemctl restart relay
```

## 6. Data

Room data lives in `data/relay-room.json` and `data/drivers/`. Back those up if you rebuild the card.

## Notes

- Stay on a private LAN. Do not port-forward 8081 to the internet.
- Serial / GPIO / CEC only work on the machine that has the hardware.
- `vite dev` is the supported run mode today. Do not use `npm start` — there isn’t one.
