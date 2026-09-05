# Relay — Linux / Raspberry Pi

Works on Debian, Ubuntu, Raspberry Pi OS (64-bit), and similar.

Default login after first start: config PIN `1234`. Change it before a real room.

## 1. Packages

**Required** (LAN control only):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # expect v22.x
```

On Raspberry Pi you can use [nvm](https://github.com/nvm-sh/nvm) instead of the NodeSource apt repo. If you do, put the nvm `node` on `PATH` for the service user (see §5).

**Optional hardware tools** — only if you will drive local ports from Relay. Skip on a VM or a LAN-only PC.

```bash
sudo apt-get install -y gpiod i2c-tools cec-utils lirc
```

| Relay interface | Tool the engine calls | Package |
|---|---|---|
| GPIO | `gpioset` | `gpiod` |
| I2C | `i2cset` | `i2c-tools` |
| CEC | `cec-client` | `cec-utils` |
| IR | `ir-ctl` / `irsend` | `lirc` |
| Serial | `/dev/tty*` or `COMn` | kernel only |
| SPI | `spidev_test` | often missing; install later if you use SPI |

Enable buses on a Pi with `sudo raspi-config` → Interface Options (I2C / Serial / SPI) then reboot.

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

## 5. Data

Room data lives in `data/relay-room.json` and `data/drivers/`. Back those up if you rebuild the card.

## Notes

- Stay on a private LAN. Do not port-forward 8081 to the internet.
- Serial / GPIO / CEC only work on the machine that has the hardware.
- `vite dev` is the supported run mode today. Do not use `npm start` — there isn’t one.
