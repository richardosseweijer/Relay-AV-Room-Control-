import { createServerFn } from "@tanstack/react-start";
import { isWeakPin, isHashedPin } from "./pins";
import { loadControl } from "./actions-context";

export const verifyConfigPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, hashPin, verifyStoredPin,
    checkLockout, notePinFail, clearPinFail, lockoutKey, mint,
    reloadSecretsFromDisk
  } = await loadControl();
    await ensureLoaded();
    await reloadSecretsFromDisk();
    const gate = checkLockout(lockoutKey("config"));
    if (gate.blocked) return { ok: false, token: null as string | null, mustChange: false, message: "Try again later" };
    const stored = memory().config.room.configPin;
    const ok = verifyStoredPin(data.pin, stored);
    if (!ok) {
      notePinFail(lockoutKey("config"));
      return { ok: false, token: null as string | null, mustChange: false };
    }
    clearPinFail(lockoutKey("config"));
    const weak = isWeakPin(data.pin) || (!isHashedPin(stored) && isWeakPin(stored));
    if (stored && !isHashedPin(stored)) {
      memory().config.room.configPin = hashPin(data.pin);
    }
    if (weak) memory().pinChangeRequired = true;
    if ((stored && !isHashedPin(stored)) || weak) persist();
    return { ok: true, token: mint("config"), mustChange: weak || memory().pinChangeRequired === true };
  });

export const verifyPanelPin = createServerFn({ method: "POST" })
  .validator((data: { pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persist, hashPin, verifyStoredPin,
    checkLockout, notePinFail, clearPinFail, lockoutKey, mint
  } = await loadControl();
    await ensureLoaded();
    const cfg = memory().config;
    const host = memory().host ?? (memory().host = { dim: false, locked: false, toast: null, block: null, pageId: null });
    const gate = checkLockout(lockoutKey("panel"));
    if (gate.blocked) return { ok: false, token: null as string | null };
    const panelStored = cfg.room.panelPin?.trim();
    const configStored = cfg.room.configPin;
    const ok = verifyStoredPin(data.pin, panelStored) || (cfg.room.panelAcceptsConfigPin === true && verifyStoredPin(data.pin, configStored));
    if (!ok) {
      notePinFail(lockoutKey("panel"));
      return { ok: false, token: null };
    }
    clearPinFail(lockoutKey("panel"));
    if (cfg.room.panelPin && !isHashedPin(cfg.room.panelPin)) {
      cfg.room.panelPin = hashPin(cfg.room.panelPin);
      persist();
    }
    host.locked = false;
    return { ok: true, token: mint("panel") };
  });

export const revokeSession = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persistNow, validToken, tokenStore
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const row = memory().sessions?.[data.id];
    if (row?.secret) tokenStore().delete(row.secret);
    tokenStore().delete(data.id);
    if (memory().sessions) delete memory().sessions[data.id];
    await persistNow();
    return { ok: true, message: "Device forgotten" };
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, persistNow, validToken, tokenStore
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    for (const [id, row] of Object.entries(memory().sessions ?? {})) {
      if (row.kind !== "panel") continue;
      if (row.secret) tokenStore().delete(row.secret);
      delete memory().sessions[id];
    }
    await persistNow();
    return { ok: true, message: "Panel devices forgotten" };
  });
