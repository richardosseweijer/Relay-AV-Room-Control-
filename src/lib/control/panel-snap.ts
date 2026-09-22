import type { RoomSnapshot } from "./types";

/**
 * F5: cheap fingerprint of fields the control panel actually renders.
 * Omits poll noise (process, log, traces, drivers, library, monitors, …)
 * so unchanged rooms skip setSnap and avoid a full grid re-render.
 */
export function panelSnapFingerprint(snap: RoomSnapshot): string {
  return JSON.stringify([
    snap.vars,
    snap.state,
    snap.host ?? null,
    snap.latches,
    snap.activeScene,
    snap.health,
    snap.config,
  ]);
}

export function samePanelSnap(a: RoomSnapshot | null, b: RoomSnapshot): boolean {
  if (!a) return false;
  return panelSnapFingerprint(a) === panelSnapFingerprint(b);
}
