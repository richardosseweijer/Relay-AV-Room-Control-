import { createFileRoute } from "@tanstack/react-router";
import { pingReachable } from "@/lib/control/engine";
import { roomLanBind } from "@/lib/control/nics";
import { ensureLoaded, memory } from "@/lib/control/store.server";
import { validToken } from "@/lib/control/session.server";

export const Route = createFileRoute("/api/ping")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await ensureLoaded();
          const body = (await request.json().catch(() => ({}))) as { host?: string; port?: number; path?: string; token?: string };
          const token = body.token || request.headers.get("x-relay-token") || "";
          // Same expiry + kind gate as /api/preview and server actions — raw session
          // lookup used to accept expired config tokens (#audit).
          if (!validToken(token, "config")) {
            return Response.json({ ok: false, message: "Config lock required" }, { status: 401 });
          }
          const bind = roomLanBind(memory().config);
          if (!bind.ok) return Response.json(bind);
          const result = await pingReachable({
            host: body.host ?? "",
            port: body.port,
            path: body.path,
            timeoutMs: 2500,
            localAddress: bind.localAddress,
          });
          return Response.json(result);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return Response.json({ ok: false, message: "aborted" });
          throw err;
        }
      },
    },
  },
});
