/** Panel kiosk URL from live AV listen — re-export scripts/panel-kiosk-url.mjs. */
export { panelKioskUrlFrom } from "../../../scripts/panel-kiosk-url.mjs";

export type PanelKioskUrlResult =
  | { ok: true; url: string; host: string; warning?: string }
  | { ok: false; reason: string };
