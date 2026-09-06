import { createFileRoute } from "@tanstack/react-router";
import { pingReachable } from "@/lib/control/engine";
import { ensureLoaded, memory } from "@/lib/control/store.server";

export const Route = createFileRoute("/api/ping")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await ensureLoaded();
          const body = (await request.json().catch(() => ({}))) as { host?: string; port?: number; path?: string; token?: string };
          const token = body.token || request.headers.get("x-relay-token") || "";
          const row = Object.values(memory().sessions ?? {}).find((item) => item.secret === token && item.kind === "config");
          if (!row) return Response.json({ ok: false, message: "Config lock required" }, { status: 401 });
          const result = await pingReachable({
            host: body.host ?? "",
            port: body.port,
            path: body.path,
            timeoutMs: 2500,
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
