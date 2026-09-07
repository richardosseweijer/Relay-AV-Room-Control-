import { verifyStoredPin } from "./pins.server.ts";

export function panelUnlockAllowed(
  pin: string,
  room: { panelPin?: string | null; configPin?: string | null; panelAcceptsConfigPin?: boolean },
) {
  if (verifyStoredPin(pin, room.panelPin)) return true;
  if (room.panelAcceptsConfigPin === true && verifyStoredPin(pin, room.configPin)) return true;
  return false;
}
