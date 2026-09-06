# Privacy

Relay does not send room data to a cloud service as part of the controller
itself. Configuration, device tokens, traces and variable values stay on the
machine that runs the app (`data/relay-room.json`, `data/relay-secrets.json`, and, if enabled, a local
database).

## What is stored

- Room layout, macros, schedules
- Device addresses and pairing tokens
- Configurator / panel PINs (stored on disk, not hashed)
- Recent command traces and a capped action log

## What is not done

- No advertising cookies
- No analytics beacon in the controller code
- Session PIN is kept in `sessionStorage` on the browser that unlocked config
  or the panel

## Your rights (GDPR-style)

You are the controller of data on your Pi/PC. Wipe the room from the
configurator, or delete `data/relay-room.json` and `data/relay-secrets.json`, to erase stored configuration.
There is no user account and no cross-border transfer by Relay itself.

If you expose the UI beyond your LAN, you take on extra GDPR duties (security
of processing, access control). That deployment mode is not supported.
