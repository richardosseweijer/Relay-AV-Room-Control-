import { createFileRoute } from "@tanstack/react-router";
import { applyHost, runMacro } from "@/lib/control/engine";
import { peerKey, verifyPeerRequest } from "@/lib/control/peer-auth";
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
        const vars: Record<string, { name: string; value: string | number }> = {};
        for (const item of mem.config.variables) {
          vars[item.id] = { name: item.label, value: mem.vars[item.id] ?? item.default };
        }
        const macros: Record<string, { name: string }> = {};
        for (const item of mem.config.macros) macros[item.id] = { name: item.label };
        return Response.json({
          ok: true,
          room: mem.config.room.name,
          host: { dim: mem.host.dim, locked: mem.host.locked, pageId: mem.host.pageId },
          vars,
          macros,
        });
      },
      POST: async ({ request }) => {
        await ensureLoaded();
        const raw = await request.text();
        if (!await authorized(request, raw, "/api/peer")) return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        const body = (() => { try { return JSON.parse(raw) as { command?: string; value?: string | number; macroId?: string }; } catch { return {}; } })();
        const dangerous = /system\.(reboot|update|restart)/.test(body.command || "");
        const mem = memory();
        if (body.macroId) {
          const macro = mem.config.macros.find((m) => m.id === body.macroId || m.label === body.macroId);
          if (!macro) return Response.json({ ok: false, message: "Unknown macro" }, { status: 404 });
          mem.runningMacro = macro.id;
          const result = await runMacro({ config: mem.config, drivers: mem.drivers, state: mem.state, vars: mem.vars, health: mem.health ?? (mem.health = {}), macro, host: mem.host });
          mem.runningMacro = null;
          if (result.ok) mem.activeScene = macro.id;
          pushLog({ kind: "macro", ok: result.ok, title: `Peer ${macro.label}`, detail: result.message });
          await persist();
          return Response.json(result);
        }
        if (!body.command) return Response.json({ ok: false, message: "Missing command" }, { status: 400 });
        const result = await applyHost(body.command, body.value, mem.host, mem.vars, { allowReboot: dangerous });
        pushLog({ kind: "system", ok: result.ok, title: `Peer ${body.command}`, detail: result.message });
        await persist();
        return Response.json(result);
      },
    },
  },
});
