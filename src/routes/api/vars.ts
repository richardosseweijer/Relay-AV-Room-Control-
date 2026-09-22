import { createFileRoute } from "@tanstack/react-router";
import { peerKey, varsRequestAllowed } from "@/lib/control/peer-auth";
import { ensureLoaded, memory, persist } from "@/lib/control/store.server";
import { writeConfiguredVar } from "@/lib/control/vars";

function allowed(request: Request, body: string) {
  const mem = memory();
  return varsRequestAllowed({
    key: peerKey(mem.config.room),
    method: request.method,
    externalControl: mem.config.room.externalControl === true,
    sig: request.headers.get("x-relay-auth") || "",
    ts: request.headers.get("x-relay-ts") || "",
    body,
  });
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
        // F5: allowlist to configured variables only (same as setVariable); clamp bounds/enum.
        const written = writeConfiguredVar(mem.config.variables, body.id, body.value);
        if (!written.ok) return Response.json({ ok: false, message: written.message }, { status: 400 });
        mem.vars[body.id] = written.value;
        await persist();
        return Response.json({ ok: true, id: body.id, value: mem.vars[body.id] });
      },
    },
  },
});
