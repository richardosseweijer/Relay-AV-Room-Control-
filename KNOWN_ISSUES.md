# Known issues

## Browsers / panel

- Fullscreen cannot start without a user gesture. After host reboot, enable **Keep tablets fullscreen** and tap the splash, or use **Push fullscreen** then tap.
- Screen Wake Lock dies when the tab is backgrounded, the device sleeps, or the OS battery-saver kills it. The sun control returns; tap again.
- iOS Safari does not implement `requestFullscreen` the same way. Add to Home Screen for a near-kiosk chrome.
- Panel poll of `/api/room` looks frozen if the browser parks the tab. Foreground the page.

## Host / deploy

- Grok publish / serverless hosts are unsupported. No writable `data/`. Do not use them as a room.
- Default bind is `0.0.0.0`. Do not port-forward the panel to the public internet.
- HTTP only. No TLS. See issue #15.
- Open LAN control is **off** unless enabled on Security. Then `fireCommand` / `fireMacro` / `setVariable` accept unauthenticated LAN calls.
- Panel unlock uses the panel PIN. Config PIN works on the panel only if Security → `panelAcceptsConfigPin` is on (default off).
- PIN lockout (5 tries / 5 min) is process memory. A restart clears the counter.
- First start PIN is `1234`. The configurator blocks until you set a stronger one.
- `system.reboot` reboots the machine. `system.restart` exits the process; systemd (`Restart=always`) starts it again. Without systemd it respawns Vite preview.
- Vite on Windows: copying files over a running `npm run dev` yields `Invalid server function ID` or missing `@/` imports. Restart after a replace.

## Devices / transports

- Samsung Tizen: pair with **Authenticate**, store the token, use port **8002**. Power-on from cold needs WOL + MAC. HTTP `:8001/api/v2/` is discovery, not key inject.
- Chromecast Play/Pause now use the live `mediaSessionId` and app transport. They still need an app actually playing. Backdrop / idle → `No media session`. A phone UI can show Netflix after Cast already went idle.
- Generic PC driver (`wake-on-lan.json`): Wake is WOL (MAC). Shutdown is Windows RPC (`net rpc shutdown` on Linux needs `samba-common-bin`) or HTTP GET to `auth.path`. WOL does not confirm the PC left S5.
- Denon DN-500AV sources are BD / SAT/CBL / Game, not `HDMI1`. Map HDMI in the Denon menu. Volume is 00–98.
- Pi header UART is 3.3 V TTL. Enable serial hardware, disable serial console, use `/dev/serial0`. RS-232 gear needs a level shifter or USB adapter.
- GPIO / I2C / IR / CEC / SPI call host binaries (`gpioset`, `i2cset`, `irsend`, `cec-client`, `spidev_test`). Absent packages fail the command, not the room boot. Argv is allowlisted (chip, line, bus, address, scancode).
- Persistent MIDI/TCP sessions are not kept open; each command connect-write-close. See issue #4.

## Config / engine

- Corrupt primary room or secrets data makes boot try the matching `.good` pair, then an empty room if no valid pair remains. The bad room file is renamed `.bad`.
- Empty schedule `days` skips the job (never runs; pick at least one day).
- PINs are scrypt hashes. Peer secret, session secrets, and device tokens stay in `data/relay-secrets.json`. See issue #14.
