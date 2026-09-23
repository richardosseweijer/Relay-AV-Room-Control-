import { createServerFn } from "@tanstack/react-start";
import path from "node:path";
import { loadControl } from "./actions-context";

/**
 * C1 — auth-gated venue TLS Generate + status.
 * Soft-skips when outbound is None / no IPv4; never takes down AV HTTP.
 * Wires room tlsCertPath/tlsKeyPath to generated server PEMs and reloads venue HTTPS.
 */

export const getVenueTlsStatus = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { ensureLoaded, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) {
      return { ok: false as const, message: "Config lock required", status: null };
    }
    const { readVenueTlsStatus } = await import("../../../scripts/venue-tls-generate.mjs");
    const status = readVenueTlsStatus(process.cwd());
    return { ok: true as const, status };
  });

export const generateVenueTls = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const {
      ensureLoaded,
      memory,
      validToken,
      installRoomConfig,
      persistNow,
    } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) {
      return { ok: false as const, message: "Config lock required" };
    }

    const mem = memory();
    const outboundName = mem.config.room.outboundNicName ?? null;
    const { roomOutboundBind, OUTBOUND_NONE_NAME } = await import("./nics");
    const bind = roomOutboundBind(mem.config);

    let outboundIpv4: string | null = null;
    if (bind.ok && !("none" in bind && bind.none) && "localAddress" in bind && bind.localAddress) {
      outboundIpv4 = bind.localAddress;
    }

    const { generateAndPersistVenueTls } = await import(
      "../../../scripts/venue-tls-generate.mjs"
    );
    const result = generateAndPersistVenueTls({
      rootDir: process.cwd(),
      outboundName:
        outboundName ?? (bind.ok && "none" in bind && bind.none ? OUTBOUND_NONE_NAME : outboundName),
      outboundIpv4,
    });

    if (!result.ok) {
      return {
        ok: false as const,
        skipped: true as const,
        message: result.reason,
        status: null,
      };
    }

    // Wire B1 paths (room fields; env RELAY_TLS_* still wins if set).
    const nextConfig = {
      ...mem.config,
      room: {
        ...mem.config.room,
        tlsCertPath: result.tlsCertPath,
        tlsKeyPath: result.tlsKeyPath,
      },
    };
    installRoomConfig(nextConfig);
    try {
      await persistNow();
    } catch {
      return { ok: false as const, message: "Generate wrote PEMs but room save failed on disk" };
    }

    // Reload venue HTTPS only (AV HTTP untouched). Soft if plugin not attached.
    let reload: { reloaded: boolean; skipped: boolean; reason?: string } = {
      reloaded: false,
      skipped: true,
      reason: "reload not attempted",
    };
    try {
      const {
        reloadHttpsVenue,
        registerHttpsVenueRuntime,
        getHttpsVenueRuntime,
      } = await import("../../../scripts/https-venue-runtime.mjs");
      const current = getHttpsVenueRuntime();
      if (!current.rootDir) {
        registerHttpsVenueRuntime({
          server: current.server,
          requestListener:
            current.requestListener ??
            ((_req, res) => {
              res.statusCode = 503;
              res.end("venue runtime not ready");
            }),
          rootDir: process.cwd(),
        });
      }
      reload = reloadHttpsVenue(process.env);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
      reload = { reloaded: false, skipped: true, reason: `reload error: ${msg}` };
    }

    return {
      ok: true as const,
      status: result.status,
      tlsCertPath: result.tlsCertPath,
      tlsKeyPath: result.tlsKeyPath,
      lifetimes: result.lifetimes,
      reload,
      pathsRelative: {
        cert: path.relative(process.cwd(), result.tlsCertPath),
        key: path.relative(process.cwd(), result.tlsKeyPath),
      },
    };
  });
