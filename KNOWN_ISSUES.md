# Known issues

## Browsers / panel

- Fullscreen cannot start without a user gesture. After host reboot, enable **Keep tablets fullscreen** and tap the splash, or use **Push fullscreen** then tap.
- Screen Wake Lock dies when the tab is backgrounded, the device sleeps, or the OS battery-saver kills it. The sun control returns; tap again.
- iOS Safari does not implement `requestFullscreen` the same way. Add to Home Screen for a near-kiosk chrome.
- Panel poll of `/api/room` looks frozen if the browser parks the tab. Foreground the page.

## Host / deploy

- Grok/Vercel-style publish has no writable `data/`. The demo room is in-memory only. Saves do not survive that host.
- Default bind is `0.0.0.0`. Do not port-forward the panel to the public internet.
- External control is on unless turned off in Room. PIN is a UI lock, not an API firewall, unless external control is disabled.
- Default PIN is `1234`.
- `system.reboot` reboots the machine. `system.restart` respawns Vite only.
- Vite on Windows: copying files over a running `npx vite` yields `Invalid server function ID` or missing `@/` imports. Restart Vite after a replace. `ErrorEvent is not defined` was Node 24 + raw `ErrorEvent` in the WS path; current engine must not throw that.

## Devices / transports

- Samsung Tizen: pair with **Authenticate**, store the token, use port **8002**. Power-on from cold needs WOL + MAC. HTTP `:8001/api/v2/` is discovery, not key inject.
- Chromecast play/pause needs a live `mediaSessionId`; GET_STATUS can return idle while a phone still shows Netflix.
- Denon DN-500AV sources are BD / SAT/CBL / Game, not `HDMI1`. Map HDMI in the Denon menu. Volume is 00–98.
- Pi header UART is 3.3 V TTL. Enable serial hardware, disable serial console, use `/dev/serial0`. RS-232 gear needs a level shifter or USB adapter.
- GPIO / I2C / IR / CEC call host binaries (`gpioset`, `i2cset`, `irsend`, `cec-client`). Absent packages fail the command, not the room boot.
- Persistent MIDI/TCP sessions are not kept open; each command connect-write-close.

## Config / engine

- Corrupt `data/relay-room.json`: boot falls back to the bundled demo. The bad file is not auto-deleted.
- Empty schedule `days` means every day.
- Nested macros share one `runningMacro` lock; a change-trigger during a run is queued or skipped.
- Driver `pacing.minIntervalMs` is per device send, not a global bus scheduler.
