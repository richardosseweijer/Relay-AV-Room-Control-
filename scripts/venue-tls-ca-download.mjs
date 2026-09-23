/**
 * C2 — pure helpers for admin-authenticated CA cert download.
 * Serves ca.cert.pem only — never private keys.
 */
import { readFileSync, existsSync } from "node:fs";
import { venueTlsPaths } from "./venue-tls-paths.mjs";

export const VENUE_TLS_CA_DOWNLOAD_FILENAME = "relay-venue-ca.cert.pem";
export const VENUE_TLS_CA_CONTENT_TYPE = "application/x-pem-file";

/**
 * Read CA cert PEM only. Returns null if missing/unreadable.
 * Never reads or returns ca.key / server.key.
 * @param {string} rootDir
 * @returns {string | null}
 */
export function readVenueTlsCaCertPem(rootDir) {
  const { caCertPath, caKeyPath, serverKeyPath } = venueTlsPaths(rootDir);
  // Hard guard: refuse if caller somehow pointed us at a key path.
  if (caCertPath === caKeyPath || caCertPath === serverKeyPath) return null;
  if (!existsSync(caCertPath)) return null;
  try {
    const pem = readFileSync(caCertPath, "utf8");
    if (!pem.includes("BEGIN CERTIFICATE")) return null;
    if (/BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY/i.test(pem)) return null;
    return pem;
  } catch {
    return null;
  }
}

/**
 * Build download response parts (status / headers / body) for tests + route.
 * @param {{
 *   authorized: boolean,
 *   caPem: string | null,
 * }} opts
 * @returns {{
 *   status: number,
 *   headers: Record<string, string>,
 *   body: string,
 *   json?: boolean,
 * }}
 */
export function planVenueTlsCaDownload(opts) {
  if (!opts.authorized) {
    return {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, message: "Config lock required" }),
      json: true,
    };
  }
  if (!opts.caPem) {
    return {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: false,
        message: "Venue CA cert not found — Generate first",
      }),
      json: true,
    };
  }
  return {
    status: 200,
    headers: {
      "content-type": VENUE_TLS_CA_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${VENUE_TLS_CA_DOWNLOAD_FILENAME}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: opts.caPem,
    json: false,
  };
}

/**
 * Extract config token from Authorization Bearer or ?token= query.
 * @param {Request} request
 * @returns {string}
 */
export function venueTlsCaTokenFromRequest(request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get("token") || "").trim();
  } catch {
    return "";
  }
}
