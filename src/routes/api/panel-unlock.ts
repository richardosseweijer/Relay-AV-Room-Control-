import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, persistNow, reloadSecretsFromDisk } from "@/lib/control/store.server";
import { hashPin, checkLockout, notePinFail, clearPinFail, lockoutKey } from "@/lib/control/pins.server";
import { isHashedPin } from "@/lib/control/pins";
import { panelUnlockAllowed } from "@/lib/control/panel-unlock-rule";
import { mint } from "@/lib/control/session.server";

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
        const openLan = cfg.room.panelAccess === "open";
        if (!openLan && !pin) return Response.json({ ok: false, message: "Enter a PIN" });
        const ok = panelUnlockAllowed(pin, cfg.room);
        if (!ok) {
          notePinFail(lockoutKey("panel"));
          return Response.json({ ok: false, message: "Wrong PIN" });
        }
        clearPinFail(lockoutKey("panel"));
        if (!openLan && cfg.room.panelPin && !isHashedPin(cfg.room.panelPin)) {
          cfg.room.panelPin = hashPin(cfg.room.panelPin);
        }
        if (openLan) {
          const existing = Object.values(memory().sessions ?? {}).find((row) => row.kind === "panel" && row.label === "open-lan" && (!row.exp || row.exp > Date.now()));
          if (existing?.secret) {
            existing.lastSeen = Date.now();
            existing.exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
            host.locked = false;
            return Response.json({ ok: true, token: existing.secret });
          }
        }
        const secret = mint("panel", openLan ? "open-lan" : undefined);
        host.locked = false;
        await persistNow();
        return Response.json({ ok: true, token: secret });
      },
    },
  },
});
