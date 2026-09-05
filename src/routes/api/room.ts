import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, snapshot } from "@/lib/control/store.server";

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
          if (!room) return Response.json(snap);
          return Response.json({
            ...snap,
            traces: {},
            config: {
              ...snap.config,
              room: { ...room, configPin: "", panelPin: room.panelAccess === "pin" ? "" : null },
              devices: snap.config.devices.map((device) => ({ ...device, auth: redact(device.auth) })),
            },
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return new Response(null, { status: 204 });
          return Response.json({ error: "room unavailable" }, { status: 503 });
        }
      },
    },
  },
});
