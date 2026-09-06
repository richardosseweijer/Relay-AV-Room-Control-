import { createFileRoute } from "@tanstack/react-router";
import { peerKey, verifyPeerRequest } from "@/lib/control/peer-auth";
import { ensureLoaded, memory, persist } from "@/lib/control/store.server";

function allowed(request: Request, body: string) {
  const mem = memory();
  const key = peerKey(mem.config.room);
  const sig = request.headers.get("x-relay-auth") || "";
  const ts = request.headers.get("x-relay-ts") || "";
  if (key && sig) return verifyPeerRequest({ key, method: request.method, path: "/api/vars", ts, body, sig });
  if (mem.config.room.externalControl !== false && request.method === "GET" && !sig) return true;
  const pin = request.headers.get("x-relay-pin") || "";
  return Boolean(pin && pin === mem.config.room.configPin);
}

export const Route = createFileRoute("/api/vars")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        if (!allowed(request, "")) return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        const mem = memory();
        const out: Record<string, { name: string; value: string | number }> = {};
        for (const item of mem.config.variables) {
          out[item.id] = { name: item.label, value: mem.vars[item.id] ?? item.default };
        }
        return Response.json(out);
      },
      PUT: async ({ request }) => {
        await ensureLoaded();
        const raw = await request.text();
        if (!allowed(request, raw)) return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        const body = (() => { try { return JSON.parse(raw) as { id?: string; value?: string | number }; } catch { return {}; } })();
        if (!body.id) return Response.json({ ok: false, message: "Missing id" }, { status: 400 });
        const mem = memory();
        mem.vars[body.id] = body.value ?? "";
        await persist();
        return Response.json({ ok: true, id: body.id, value: mem.vars[body.id] });
      },
    },
  },
});
