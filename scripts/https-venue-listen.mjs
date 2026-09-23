/**
 * Phase B1 — optional HTTPS listener on the outbound/venue NIC IPv4 only.
 * Cert/key from env (RELAY_TLS_CERT / RELAY_TLS_KEY) or room tlsCertPath / tlsKeyPath.
 * No ACME/Let’s Encrypt (PARKED). Never binds 0.0.0.0.
 * Soft-skip when outbound is None, missing IPv4, or certs missing/unreadable —
 * AV-LAN HTTP listen must stay up.
 *
 * Plain .mjs so Vite plugin + node:test share one implementation.
 */
import { accessSync, readFileSync, constants as fsConstants } from "node:fs";
import https from "node:https";
import { listLanNicsFrom, readRoomStoreSync } from "./http-listen-host.mjs";

/** @typedef {{ name?: string | null, index?: number | null }} NicPick */
/** @typedef {{ index: number, name: string, ipv4: string | null, cidr?: string | null, label?: string }} LanNic */

export const DEFAULT_HTTPS_PORT = 8443;

/** Same sentinel as src/lib/control/nics.ts OUTBOUND_NONE_NAME. */
export const OUTBOUND_NONE_NAME = "__none__";

export const HTTPS_VENUE_SKIP_OUTBOUND_NONE =
  "HTTPS venue listener skipped: outbound NIC is None (air-gap / no venue NIC).";

export const HTTPS_VENUE_SKIP_NO_CERTS =
  "HTTPS venue listener skipped: TLS cert/key not configured (set RELAY_TLS_CERT + RELAY_TLS_KEY, or room tlsCertPath + tlsKeyPath). Let’s Encrypt is PARKED; in-box Generate is C1.";

/**
 * @typedef {{ listen: false, reason: string }} HttpsVenueSkip
 * @typedef {{ listen: true, host: string, port: number, certPath: string, keyPath: string }} HttpsVenuePlanListen
 * @typedef {HttpsVenueSkip | HttpsVenuePlanListen} HttpsVenuePlan
 * @typedef {{ listen: true, host: string, port: number, certPath: string, keyPath: string, cert: Buffer, key: Buffer }} HttpsVenueReadyListen
 * @typedef {HttpsVenueSkip | HttpsVenueReadyListen} HttpsVenueReady
 */

function pickSet(/** @type {NicPick} */ pick) {
  if (String(pick?.name ?? "").trim()) return true;
  return pick?.index != null && Number.isFinite(Number(pick.index));
}

/**
 * @param {LanNic[]} nics
 * @param {NicPick} pick
 * @returns {LanNic | null}
 */
function resolveNic(nics, pick) {
  const name = String(pick?.name ?? "").trim();
  if (name) {
    const hit = nics.find((nic) => nic.name === name);
    if (hit) return hit;
  }
  if (pick?.index != null && Number.isFinite(Number(pick.index))) {
    const hit = nics.find((nic) => nic.index === Number(pick.index));
    if (hit) return hit;
  }
  return null;
}

/**
 * Extract outbound pick from persisted relay-room.json shape.
 * @param {unknown} raw
 * @returns {NicPick}
 */
export function outboundPickFromRoomStore(raw) {
  if (!raw || typeof raw !== "object") return {};
  const root = /** @type {Record<string, unknown>} */ (raw);
  const config =
    root.config && typeof root.config === "object"
      ? /** @type {Record<string, unknown>} */ (root.config)
      : root;
  const room =
    config.room && typeof config.room === "object"
      ? /** @type {Record<string, unknown>} */ (config.room)
      : null;
  if (!room) return {};
  const name = room.outboundNicName;
  const index = room.outboundNicIndex;
  return {
    name: typeof name === "string" || name == null ? /** @type {string | null} */ (name ?? null) : null,
    index: typeof index === "number" || index == null ? /** @type {number | null} */ (index ?? null) : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {{ certPath: string | null, keyPath: string | null }}
 */
export function tlsPathsFromRoomStore(raw) {
  if (!raw || typeof raw !== "object") return { certPath: null, keyPath: null };
  const root = /** @type {Record<string, unknown>} */ (raw);
  const config =
    root.config && typeof root.config === "object"
      ? /** @type {Record<string, unknown>} */ (root.config)
      : root;
  const room =
    config.room && typeof config.room === "object"
      ? /** @type {Record<string, unknown>} */ (config.room)
      : null;
  if (!room) return { certPath: null, keyPath: null };
  const certPath = typeof room.tlsCertPath === "string" ? room.tlsCertPath.trim() : "";
  const keyPath = typeof room.tlsKeyPath === "string" ? room.tlsKeyPath.trim() : "";
  return { certPath: certPath || null, keyPath: keyPath || null };
}

/**
 * Env wins over room. Both cert and key required together.
 * @param {{ env?: NodeJS.ProcessEnv, roomJson?: unknown }} opts
 * @returns {{ certPath: string, keyPath: string, source: "env" | "room" } | null}
 */
export function resolveTlsPaths(opts = {}) {
  const env = opts.env ?? process.env;
  const envCert = String(env.RELAY_TLS_CERT ?? "").trim();
  const envKey = String(env.RELAY_TLS_KEY ?? "").trim();
  if (envCert && envKey) return { certPath: envCert, keyPath: envKey, source: "env" };
  // Partial env: do not fall through to a room half-pair.
  if (envCert || envKey) return null;
  const roomPaths = tlsPathsFromRoomStore(opts.roomJson);
  if (roomPaths.certPath && roomPaths.keyPath) {
    return { certPath: roomPaths.certPath, keyPath: roomPaths.keyPath, source: "room" };
  }
  return null;
}

/**
 * @param {string | undefined | null} raw
 * @returns {number}
 */
export function resolveHttpsPort(raw) {
  const n = Number(String(raw ?? "").trim() || DEFAULT_HTTPS_PORT);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_HTTPS_PORT;
  return n;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function pathReadable(path) {
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure plan: outbound IPv4 host + cert paths + port. Never returns host 0.0.0.0.
 * Soft-skip for None / missing IPv4 / missing or unreadable certs.
 * @param {{
 *   nics: LanNic[],
 *   outboundPick?: NicPick,
 *   env?: NodeJS.ProcessEnv,
 *   roomJson?: unknown,
 *   readable?: (path: string) => boolean,
 * }} opts
 * @returns {HttpsVenuePlan}
 */
export function planHttpsVenueListen(opts) {
  const pick = opts.outboundPick ?? outboundPickFromRoomStore(opts.roomJson);
  const name = String(pick?.name ?? "").trim();
  if (name === OUTBOUND_NONE_NAME || !pickSet(pick)) {
    return { listen: false, reason: HTTPS_VENUE_SKIP_OUTBOUND_NONE };
  }

  const nic = resolveNic(opts.nics, pick);
  if (!nic) {
    return {
      listen: false,
      reason: "HTTPS venue listener skipped: outbound NIC not found (AV HTTP unaffected).",
    };
  }
  if (!nic.ipv4) {
    return {
      listen: false,
      reason: `HTTPS venue listener skipped: outbound NIC ${nic.name} has no IPv4 (AV HTTP unaffected).`,
    };
  }
  if (nic.ipv4 === "0.0.0.0") {
    return {
      listen: false,
      reason: "HTTPS venue listener skipped: refusing to bind 0.0.0.0.",
    };
  }

  const paths = resolveTlsPaths({ env: opts.env, roomJson: opts.roomJson });
  if (!paths) {
    return { listen: false, reason: HTTPS_VENUE_SKIP_NO_CERTS };
  }

  const readable = opts.readable ?? pathReadable;
  if (!readable(paths.certPath)) {
    return {
      listen: false,
      reason: `HTTPS venue listener skipped: cert not readable at ${paths.certPath} (AV HTTP unaffected).`,
    };
  }
  if (!readable(paths.keyPath)) {
    return {
      listen: false,
      reason: `HTTPS venue listener skipped: key not readable at ${paths.keyPath} (AV HTTP unaffected).`,
    };
  }

  return {
    listen: true,
    host: nic.ipv4,
    port: resolveHttpsPort(opts.env?.RELAY_HTTPS_PORT),
    certPath: paths.certPath,
    keyPath: paths.keyPath,
  };
}

/**
 * @param {HttpsVenuePlan} plan
 * @param {{ readFile?: (path: string) => Buffer | string }} [io]
 * @returns {HttpsVenueReady}
 */
export function loadHttpsVenueMaterial(plan, io = {}) {
  if (!plan.listen) return plan;
  const readFile = io.readFile ?? ((p) => readFileSync(p));
  try {
    const certRaw = readFile(plan.certPath);
    const keyRaw = readFile(plan.keyPath);
    return {
      listen: true,
      host: plan.host,
      port: plan.port,
      certPath: plan.certPath,
      keyPath: plan.keyPath,
      cert: Buffer.isBuffer(certRaw) ? certRaw : Buffer.from(certRaw),
      key: Buffer.isBuffer(keyRaw) ? keyRaw : Buffer.from(keyRaw),
    };
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    return {
      listen: false,
      reason: `HTTPS venue listener skipped: failed to read TLS files (${msg}) (AV HTTP unaffected).`,
    };
  }
}

/**
 * Boot helper: room store + live NICs + env → ready material or skip.
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {HttpsVenueReady}
 */
export function bootPlanHttpsVenueListen(rootDir, env = process.env) {
  const roomJson = readRoomStoreSync(rootDir);
  const plan = planHttpsVenueListen({
    nics: listLanNicsFrom(),
    roomJson,
    env,
  });
  return loadHttpsVenueMaterial(plan);
}

/**
 * Second https.Server sharing Vite's Connect `requestListener`.
 * Fail soft: create/listen errors never take down AV HTTP.
 * @param {{
 *   ready: HttpsVenueReady,
 *   requestListener: import("node:http").RequestListener,
 *   createServer?: typeof https.createServer,
 *   log?: { info?: Function, warn?: Function, error?: Function },
 * }} opts
 * @returns {{ server: import("node:https").Server | null, skipped: boolean, reason?: string }}
 */
export function startHttpsVenueServer(opts) {
  const log = opts.log ?? console;
  const ready = opts.ready;
  if (!ready.listen) {
    log.info?.(`[https-venue] ${ready.reason}`);
    return { server: null, skipped: true, reason: ready.reason };
  }
  if (ready.host === "0.0.0.0") {
    const reason = "HTTPS venue listener skipped: refusing to bind 0.0.0.0.";
    log.warn?.(`[https-venue] ${reason}`);
    return { server: null, skipped: true, reason };
  }

  const createServer = opts.createServer ?? https.createServer;
  /** @type {import("node:https").Server | null} */
  let server = null;
  try {
    server = createServer({ cert: ready.cert, key: ready.key }, opts.requestListener);
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    const reason = `HTTPS venue listener failed to create server (${msg}) — AV HTTP unaffected.`;
    log.error?.(`[https-venue] ${reason}`);
    return { server: null, skipped: true, reason };
  }

  server.on("error", (err) => {
    log.error?.(
      `[https-venue] listen error on ${ready.host}:${ready.port} (${err?.message || err}) — AV HTTP unaffected.`,
    );
  });

  try {
    server.listen(ready.port, ready.host, () => {
      log.info?.(
        `[https-venue] HTTPS listening on https://${ready.host}:${ready.port} (venue NIC; file-based TLS)`,
      );
    });
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    const reason = `HTTPS venue listener listen() threw (${msg}) — AV HTTP unaffected.`;
    log.error?.(`[https-venue] ${reason}`);
    try {
      server.close();
    } catch {
      /* ignore */
    }
    return { server: null, skipped: true, reason };
  }

  return { server, skipped: false };
}
