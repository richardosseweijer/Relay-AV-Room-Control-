import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, snapshot } from "@/lib/control/store.server";
import { scrubSecret } from "@/lib/control/engine";

function redact(auth?: Record<string, string>) {
  if (!auth) return {};
  const next = { ...auth };
  for (const key of Object.keys(next)) {
    if (/token|password|secret|key|username/i.test(key)) next[key] = "";
  }
  return next;
}

export const Route = createFileRoute("/api/room")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await ensureLoaded();
          const snap = snapshot();
          const room = snap.config?.room;
          if (!room) return Response.json({ ...snap, traces: {} });
          return Response.json({
            ...snap,
            traces: {},
            lastError: snap.lastError ? scrubSecret(snap.lastError) : null,
            log: (snap.log ?? []).map((row) => ({ ...row, detail: scrubSecret(row.detail), title: scrubSecret(row.title) })),
            health: Object.fromEntries(Object.entries(snap.health ?? {}).map(([id, row]) => [id, { ...row, message: scrubSecret(row.message ?? "") }])),
            config: {
              ...snap.config,
              room: { ...room, configPin: "", peerSecret: "", panelPin: room.panelAccess === "pin" ? "" : null },
              devices: snap.config.devices.map((device) => ({ ...device, auth: redact(device.auth) })),
            },
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return new Response(null, { status: 204 });
          try {
            const { emptyRoomConfig, bundledDrivers, defaultDeviceState } = await import("@/lib/control/defaults");
            const demo = emptyRoomConfig();
            return Response.json({
              config: { ...demo, room: { ...demo.room, configPin: "", panelPin: null } },
              drivers: bundledDrivers,
              library: bundledDrivers,
              state: defaultDeviceState(),
              vars: Object.fromEntries(demo.variables.map((v) => [v.id, v.value])),
              health: {},
              log: [],
              traces: {},
              monitorStatus: {},
              latches: {},
              lastError: "Demo host has no saved room file",
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
