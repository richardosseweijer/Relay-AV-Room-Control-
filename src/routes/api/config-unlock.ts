import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, persist, reloadSecretsFromDisk } from "@/lib/control/store.server";
import { hashPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "@/lib/control/pins.server";
import { isHashedPin, isWeakPin } from "@/lib/control/pins";

function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/config-unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureLoaded();
        await reloadSecretsFromDisk();
        const body = await request.json().catch(() => ({})) as { pin?: string };
        const pin = String(body.pin ?? "").trim();
        const gate = checkLockout(lockoutKey("config"));
        if (gate.blocked) return Response.json({ ok: false, message: "Try again later" });
        if (!pin) return Response.json({ ok: false, message: "Enter a PIN" });
        const stored = memory().config.room.configPin;
        if (!verifyStoredPin(pin, stored)) {
          notePinFail(lockoutKey("config"));
          return Response.json({ ok: false, message: "Wrong PIN" });
        }
        clearPinFail(lockoutKey("config"));
        if (stored && !isHashedPin(stored)) {
          memory().config.room.configPin = hashPin(pin);
          persist();
        }
        const id = randomHex(8);
        const secret = `config-${randomHex(18)}`;
        const row = { id, secret, kind: "config" as const, exp: Date.now() + 30 * 24 * 60 * 60 * 1000, created: Date.now(), lastSeen: Date.now(), label: "config" };
        memory().sessions = memory().sessions ?? {};
        memory().sessions[id] = row;
        persist();
        return Response.json({ ok: true, token: secret, mustChange: isWeakPin(pin) });
      },
    },
  },
});
