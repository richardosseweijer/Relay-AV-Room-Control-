# Run Relay on your PC (same Wi‑Fi as the TV)

Needs Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the printed URL from that same PC, or from a phone: `http://YOUR-PC-IP:8080`

Config PIN for the demo room is `1234`.

## Talk to the Q65T

1. Config → Devices → Add device
2. Driver: `samsung-qe50q65t.json`
3. Host: the TV’s IP
4. Uncheck Simulate
5. Save all (PIN `1234`)
6. Probe — accept **Allow** on the TV

If Probe stays red, the TV and PC are on different networks, or the set wants port `8002` plus a pairing token.

## Raspberry Pi

Same commands. After install you can keep it up with:

```bash
npm run build
npx vite preview --host 0.0.0.0 --port 8080
```
