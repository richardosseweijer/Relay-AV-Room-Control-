import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, persistNow, reloadSecretsFromDisk } from "@/lib/control/store.server";
import { hashPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "@/lib/control/pins.server";
import { isHashedPin, isWeakPin } from "@/lib/control/pins";
import { mint } from "@/lib/control/session.server";

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
        const weak = isWeakPin(pin) || (!isHashedPin(stored) && isWeakPin(stored));
        if (stored && !isHashedPin(stored)) {
          memory().config.room.configPin = hashPin(pin);
        }
        if (weak) memory().pinChangeRequired = true;
        const secret = mint("config");
        await persistNow();
        return Response.json({ ok: true, token: secret, mustChange: weak || memory().pinChangeRequired === true });
      },
    },
  },
});
