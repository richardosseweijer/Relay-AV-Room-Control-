import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, persist, reloadSecretsFromDisk } from "@/lib/control/store.server";
import { hashPin, verifyStoredPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "@/lib/control/pins.server";
import { isHashedPin } from "@/lib/control/pins";

function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/panel-unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureLoaded();
        await reloadSecretsFromDisk();
        const body = await request.json().catch(() => ({})) as { pin?: string };
        const pin = String(body.pin ?? "").trim();
        const cfg = memory().config;
        const host = memory().host ?? (memory().host = { dim: false, locked: false, toast: null, block: null, pageId: null });
        const gate = checkLockout(lockoutKey("panel"));
        if (gate.blocked) return Response.json({ ok: false, message: "Try again later" });
        if (!pin) return Response.json({ ok: false, message: "Enter a PIN" });
        const ok = verifyStoredPin(pin, cfg.room.panelPin) || verifyStoredPin(pin, cfg.room.configPin);
        if (!ok) {
          notePinFail(lockoutKey("panel"));
          return Response.json({ ok: false, message: "Wrong PIN" });
        }
        clearPinFail(lockoutKey("panel"));
        if (cfg.room.panelPin && !isHashedPin(cfg.room.panelPin)) {
          cfg.room.panelPin = hashPin(pin);
        }
        const id = randomHex(8);
        const secret = `panel-${randomHex(18)}`;
        const row = { id, secret, kind: "panel" as const, exp: Date.now() + 30 * 24 * 60 * 60 * 1000, created: Date.now(), lastSeen: Date.now(), label: "panel" };
        memory().sessions = memory().sessions ?? {};
        memory().sessions[id] = row;
        host.locked = false;
        persist();
        return Response.json({ ok: true, token: secret });
      },
    },
  },
});
