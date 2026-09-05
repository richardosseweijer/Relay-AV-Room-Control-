import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory, persist } from "@/lib/control/store.server";

export const Route = createFileRoute("/api/vars")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        const mem = memory();
        if (mem.config.room.externalControl === false) {
          const pin = request.headers.get("x-relay-pin") || "";
          if (!pin || pin !== mem.config.room.configPin) {
            return Response.json({ ok: false, message: "External control off" }, { status: 401 });
          }
        }
        const out: Record<string, { name: string; value: string | number }> = {};
        for (const item of mem.config.variables) {
          out[item.id] = { name: item.label, value: mem.vars[item.id] ?? item.default };
        }
        return Response.json(out);
      },
      PUT: async ({ request }) => {
        await ensureLoaded();
        const mem = memory();
        const pin = request.headers.get("x-relay-pin") || "";
        if (!pin || pin !== mem.config.room.configPin) {
          return Response.json({ ok: false, message: "Config lock required" }, { status: 401 });
        }
        const body = await request.json().catch(() => ({})) as { id?: string; value?: string | number };
        if (!body.id) return Response.json({ ok: false, message: "Missing id" }, { status: 400 });
        mem.vars[body.id] = body.value ?? "";
        await persist();
        return Response.json({ ok: true, id: body.id, value: mem.vars[body.id] });
      },
    },
  },
});
