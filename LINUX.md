# Relay — Linux / Raspberry Pi

Works on Debian, Ubuntu, Raspberry Pi OS (64-bit), and similar.

Default login after first start: config PIN `1234`. Change it before a real room.

## 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v
```

On Raspberry Pi you can also use [nvm](https://github.com/nvm-sh/nvm) if you prefer not to use apt.

## 2. Get the project

```bash
git clone https://github.com/richardosseweijer/Relay-AV-Room-Control-.git
cd Relay-AV-Room-Control-
```

If you only have a zip, unpack it and `cd` into that folder instead.

## 3. Install and run

```bash
npm install
npx vite dev --host 0.0.0.0 --port 8081
```

Leave that terminal open.

## 4. Open the room

On this machine: [http://localhost:8081/](http://localhost:8081/)

From a phone on the same LAN: `http://PI-IP:8081/`  
Find the Pi address with `hostname -I`.

Configurator: [http://localhost:8081/config](http://localhost:8081/config) — PIN `1234`.

## 5. Keep it running (optional)

```bash
sudo npm install -g pm2
pm2 start "npx vite dev --host 0.0.0.0 --port 8081" --name relay --cwd "$PWD"
pm2 save
pm2 startup
```

Room data lives in `data/relay-room.json` and `data/drivers/`. Back those up if you rebuild the card.

## Notes

- Stay on a private LAN. Do not port-forward 8081 to the internet.
- Serial / GPIO / CEC only work on the machine that has the hardware (usually the Pi).
- To update: `git pull && npm install` then restart the process.
