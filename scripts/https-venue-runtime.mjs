/**
 * C1 — hold the live venue HTTPS server so Generate can reload PEMs
 * without touching the AV HTTP listener.
 */
import {
  bootPlanHttpsVenueListen,
  startHttpsVenueServer,
} from "./https-venue-listen.mjs";

/**
 * @typedef {{
 *   server: import("node:https").Server | null,
 *   requestListener: import("node:http").RequestListener | null,
 *   rootDir: string | null,
 * }} HttpsVenueRuntime
 */

/** @type {HttpsVenueRuntime} */
const runtime = {
  server: null,
  requestListener: null,
  rootDir: null,
};

/**
 * @param {{
 *   server: import("node:https").Server | null,
 *   requestListener: import("node:http").RequestListener,
 *   rootDir: string,
 * }} opts
 */
export function registerHttpsVenueRuntime(opts) {
  runtime.server = opts.server;
  runtime.requestListener = opts.requestListener;
  runtime.rootDir = opts.rootDir;
}

/** @returns {HttpsVenueRuntime} */
export function getHttpsVenueRuntime() {
  return runtime;
}

/**
 * Close current venue HTTPS (if any) and start again from room/env PEMs.
 * Soft-fail: never throws into AV paths.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ log?: { info?: Function, warn?: Function, error?: Function } }} [opts]
 * @returns {{ reloaded: boolean, skipped: boolean, reason?: string }}
 */
export function reloadHttpsVenue(env = process.env, opts = {}) {
  const log = opts.log ?? console;
  const requestListener = runtime.requestListener;
  const rootDir = runtime.rootDir;
  if (!requestListener || !rootDir) {
    const reason =
      "HTTPS venue reload skipped: venue runtime not registered (dev/preview plugin not attached).";
    log.info?.(`[https-venue] ${reason}`);
    return { reloaded: false, skipped: true, reason };
  }

  const prev = runtime.server;
  if (prev) {
    try {
      prev.close();
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
      log.warn?.(`[https-venue] previous venue server close: ${msg}`);
    }
    runtime.server = null;
  }

  const ready = bootPlanHttpsVenueListen(rootDir, env);
  const started = startHttpsVenueServer({
    ready,
    requestListener,
    log,
  });
  runtime.server = started.server;
  if (started.skipped) {
    return { reloaded: false, skipped: true, reason: started.reason };
  }
  log.info?.("[https-venue] venue HTTPS reloaded after TLS Generate.");
  return { reloaded: true, skipped: false };
}
