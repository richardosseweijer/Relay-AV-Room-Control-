import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, snapshot } from "@/lib/control/store.server";
import { validTokenAny } from "@/lib/control/session.server";
import { scrubSecret } from "@/lib/control/engine";

import { redactAuth } from "@/lib/control/secrets";
import { isLoopbackIp, tcpPeerAddress } from "@/lib/control/peer-auth";
import { roomRateLimited } from "@/lib/control/room-rate-limit";


function clientIp(request: Request) {
  if (process.env.RELAY_TRUST_PROXY === "1") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
  }
  // Same TCP peer path as peer-auth; missing peer must not look like loopback (#36).
  return tcpPeerAddress(request) || "unknown";
}

export const Route = createFileRoute("/api/room")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
          const ip = clientIp(request);
          if (!isLoopbackIp(ip) && roomRateLimited(token || ip)) return Response.json({ error: "rate limited" }, { status: 429 });
          await ensureLoaded();
          const snap = snapshot();
          const room = snap.config?.room;
          if (!room) return Response.json({ ...snap, traces: {}, drivers: {}, library: {} });
          // Same expiry + kind + sliding as /api/preview — local session lookup treated
          // missing exp as forever-authed for host/driver/log redaction (#audit).
          const authed = validTokenAny(token);
          const devices = (snap.config.devices ?? []).map((device) => ({
            ...device,
            host: authed ? device.host : "",
            port: authed ? device.port : undefined,
            auth: redactAuth(device.auth),
          }));
          return Response.json({
            ...snap,
            traces: {},
            sessionValid: token ? authed : undefined,
            drivers: authed ? snap.drivers : {},
            library: authed ? snap.library : {},
            lastError: snap.lastError ? scrubSecret(snap.lastError) : null,
            log: authed ? (snap.log ?? []).map((row) => ({ ...row, detail: scrubSecret(row.detail), title: scrubSecret(row.title) })) : [],
            health: Object.fromEntries(Object.entries(snap.health ?? {}).map(([id, row]) => [id, { ...row, message: scrubSecret(row.message ?? "") }])),
            config: {
              ...snap.config,
              room: {
                ...room,
                configPin: "",
                peerSecret: "",
                panelPin: room.panelAccess === "pin" ? "" : null,
                network: authed ? room.network : { ...room.network, address: "", gateway: "", dns: "" },
              },
              devices,
            },
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return new Response(null, { status: 204 });
          try {
            const { emptyRoomConfig, defaultDeviceState } = await import("@/lib/control/defaults");
            const demo = emptyRoomConfig();
            return Response.json({
              config: { ...demo, room: { ...demo.room, configPin: "", panelPin: "" } },
              drivers: {},
              library: {},
              state: defaultDeviceState(),
              vars: Object.fromEntries(demo.variables.map((v) => [v.id, v.default])),
              health: {},
              log: [],
              traces: {},
              monitorStatus: {},
              latches: {},
              lastError: scrubSecret(err instanceof Error ? err.message : "room unavailable"),
              runningMacro: null,
              activeScene: null,
              host: { dim: false, locked: false, toast: null, block: null, pageId: null },
            });
          } catch {
            return Response.json({ error: "room unavailable" }, { status: 503 });
          }
        }
      },
    },
  },
});
