import { createFileRoute } from "@tanstack/react-router";
import { pingReachable } from "@/lib/control/engine";

export const Route = createFileRoute("/api/ping")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { host?: string; port?: number; path?: string };
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
