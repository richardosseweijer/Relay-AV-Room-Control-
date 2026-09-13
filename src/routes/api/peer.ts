import { createFileRoute } from "@tanstack/react-router";
import { runMacro } from "@/lib/control/engine";
import { peerKey, verifyPeerRequest } from "@/lib/control/peer-auth";
import { buildPeerGet } from "@/lib/control/peer-payload";
import { ensureLoaded, memory, persist, pushLog } from "@/lib/control/store.server";

async function authorized(request: Request, body: string, path = "/api/peer") {
  const mem = memory();
  const key = peerKey(mem.config.room);
  const sig = request.headers.get("x-relay-auth") || "";
  const ts = request.headers.get("x-relay-ts") || "";
  if (key) return verifyPeerRequest({ key, method: request.method, path, ts, body, sig });
  return false;
}

export const Route = createFileRoute("/api/peer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        if (!await authorized(request, "", "/api/peer")) return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        const mem = memory();
        return Response.json(buildPeerGet({
          room: mem.config.room,
          host: mem.host,
          variables: mem.config.variables,
          vars: mem.vars,
          macros: mem.config.macros,
        }));
      },
      POST: async ({ request }) => {
        await ensureLoaded();
        const raw = await request.text();
        if (!await authorized(request, raw, "/api/peer")) return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        const body = (() => { try { return JSON.parse(raw) as { command?: string; value?: string | number; macroId?: string }; } catch { return {}; } })();
        const mem = memory();
        if (!body.macroId) return Response.json({ ok: false, message: "Peers may only run allow-listed macros" }, { status: 403 });
        const allowed = mem.config.room.peerMacroIds ?? [];
        const macro = mem.config.macros.find((m) => m.id === body.macroId || m.label === body.macroId);
        if (!macro || !allowed.includes(macro.id)) return Response.json({ ok: false, message: "Macro not allowed" }, { status: 403 });
        mem.runningMacro = macro.id;
        const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro, host: mem.host });
        mem.runningMacro = null;
        if (result.ok) mem.activeScene = macro.id;
        pushLog({ kind: "macro", ok: result.ok, title: `Peer ${macro.label}`, detail: result.message });
        await persist();
        return Response.json(result);
      },
    },
  },
});
