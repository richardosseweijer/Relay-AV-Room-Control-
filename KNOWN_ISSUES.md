# Known issues

## Browsers / panel

- Fullscreen cannot start without a user gesture. After host reboot, enable **Keep tablets fullscreen** and tap the splash, or use **Push fullscreen** then tap.
- Screen Wake Lock dies when the tab is backgrounded, the device sleeps, or the OS battery-saver kills it. The sun control returns; tap again.
- iOS Safari does not implement `requestFullscreen` the same way. Add to Home Screen for a near-kiosk chrome.
- Panel poll of `/api/room` looks frozen if the browser parks the tab. Foreground the page.
- Security → Forget drops the server row only. The browser still holds `localStorage`. Open panel then reuses the remaining (or next) session. See issue #17.

## Host / deploy

- Grok publish / serverless hosts are unsupported. No writable `data/`. Do not use them as a room.
- Default bind is `0.0.0.0`. Do not port-forward the panel to the public internet.
- HTTP only. No TLS. See issue #15.
- Open LAN control is **off** unless enabled on Security. Then `fireCommand` / `fireMacro` / `setVariable` accept unauthenticated LAN calls.
- Room unlock accepts the configurator PIN as well as the panel PIN. Split them on Security if that is unwanted.
- PIN lockout (5 tries / 5 min) is process memory. A restart clears the counter.
- First start PIN is `1234`. The configurator blocks until you set a stronger one.
- `system.reboot` reboots the machine. `system.restart` respawns Vite only.
- Vite on Windows: copying files over a running `npx vite` yields `Invalid server function ID` or missing `@/` imports. Restart Vite after a replace.

## Devices / transports

- Samsung Tizen: pair with **Authenticate**, store the token, use port **8002**. Power-on from cold needs WOL + MAC. HTTP `:8001/api/v2/` is discovery, not key inject.
- Chromecast play/pause needs a live `mediaSessionId`; GET_STATUS can return idle while a phone still shows Netflix.
- Denon DN-500AV sources are BD / SAT/CBL / Game, not `HDMI1`. Map HDMI in the Denon menu. Volume is 00–98.
- Pi header UART is 3.3 V TTL. Enable serial hardware, disable serial console, use `/dev/serial0`. RS-232 gear needs a level shifter or USB adapter.
- GPIO / I2C / IR / CEC call host binaries (`gpioset`, `i2cset`, `irsend`, `cec-client`). Absent packages fail the command, not the room boot.
- Persistent MIDI/TCP sessions are not kept open; each command connect-write-close. See issue #4.

## Config / engine

- Corrupt `data/relay-room.json`: boot falls back to an empty room. The bad file is not auto-deleted.
- Empty schedule `days` skips the job (never runs; pick at least one day).
- PINs are scrypt hashes. Peer secret, session secrets, and device tokens stay in `data/relay-secrets.json`. See issue #14.
- Room file and secrets file are two renames; a crash between them can desync. See issue #18.
- `npm ci` may reject the lockfile (missing AJV). Use `npm install`. See issue #19.
- No in-repo tests for HMAC / triggers / persist. See issue #20.
- Nine framework PWA/title tests still fail. See issue #21.
- Config nav labels are raw ids. See issue #16.
