# Security

## Report a vulnerability

Email the maintainer privately. Do not open a public issue with exploit details.

## Assumptions

Relay is meant for a **trusted local network** (one room / one VLAN), not the
public internet.

## Built-in limits

- Configurator actions require the config PIN session.
- A panel PIN, when set, must be verified before a panel session token is issued.
- `/api/room` does not include device traces. Traces are redacted and only returned to the configurator session.
- OS reboot is only available from the locked configurator, not from the
  room panel or macros.
- `/api/vars` writes require header `x-relay-pin` equal to the config PIN.
- Room export strips PINs, tokens and passwords.

## Operator checklist

- Change the default config PIN before any real deployment.
- Do not forward port 8081 to the internet.
- Keep pairing tokens off shared USB sticks; treat `data/relay-room.json`
  as a secret.
- Put guest Wi-Fi on another VLAN.
