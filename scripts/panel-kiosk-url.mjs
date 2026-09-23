/**
 * Panel kiosk URL = live AV panel root (same host HTTP listens on).
 * Never 0.0.0.0 / ::. Soft-fail when AV unset / no IPv4 (unless RELAY_LISTEN_HOST).
 */
import { controlBaseUrlFrom, DEFAULT_PRODUCTION_CONTROL_PORT } from "./control-base-url.mjs";
import { isForbiddenKioskHost } from "./video-outputs.mjs";

/**
 * @param {{
 *   nics: { index: number, name: string, ipv4: string | null }[],
 *   pick?: { name?: string | null, index?: number | null },
 *   port?: number | string | null,
 *   envHost?: string | null,
 * }} opts
 * @returns {{ ok: true, url: string, host: string, warning?: string } | { ok: false, reason: string }}
 */
export function panelKioskUrlFrom(opts) {
  const base = controlBaseUrlFrom({
    nics: opts.nics,
    pick: opts.pick,
    port: opts.port ?? DEFAULT_PRODUCTION_CONTROL_PORT,
    envHost: opts.envHost,
    protocol: "http",
  });
  if (!base.ok) return base;
  if (isForbiddenKioskHost(base.host)) {
    return {
      ok: false,
      reason:
        "Kiosk URL refuses 0.0.0.0 / unspecified listen host — set AV-LAN IPv4 (or RELAY_LISTEN_HOST to a concrete address).",
    };
  }
  // Trailing slash = panel root (not /config).
  const url = base.url.endsWith("/") ? base.url : `${base.url}/`;
  return { ok: true, url, host: base.host, warning: base.warning };
}
