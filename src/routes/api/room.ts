import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, snapshot } from "@/lib/control/store.server";
import { scrubSecret } from "@/lib/control/engine";

function redact(auth?: Record<string, string>) {
  if (!auth) return {};
  const next = { ...auth };
  for (const key of Object.keys(next)) {
    if (/token|password|secret|key|username/i.test(key)) next[key] = "";
  }
  return next;
}

const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < 10_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 40;
}

function clientIp(request: Request) {
  if (process.env.RELAY_TRUST_PROXY === "1") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "proxy";
  }
  const sock = (request as Request & { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  return sock || "local";
}

function hasSession(token: string) {
  if (!token) return false;
  const row = Object.values(memory().sessions ?? {}).find((item) => item.secret === token);
  if (!row) return false;
  if (row.exp && row.exp < Date.now()) return false;
  return true;
}

export const Route = createFileRoute("/api/room")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ip = clientIp(request);
          if (limited(ip)) return Response.json({ error: "rate limited" }, { status: 429 });
          await ensureLoaded();
          const snap = snapshot();
          const room = snap.config?.room;
          if (!room) return Response.json({ ...snap, traces: {}, drivers: {}, library: {} });
          const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
          const authed = hasSession(token);
          const devices = (snap.config.devices ?? []).map((device) => ({
            ...device,
            host: authed ? device.host : "",
            port: authed ? device.port : undefined,
            auth: redact(device.auth),
          }));
          return Response.json({
            ...snap,
            traces: {},
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
              lastError: err instanceof Error ? err.message : "room unavailable",
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
