import { createFileRoute } from "@tanstack/react-router";
import { applyHost, runMacro } from "@/lib/control/engine";
import { ensureLoaded, memory, persist, pushLog } from "@/lib/control/store.server";

function pinOk(request: Request) {
  const mem = memory();
  const pin = request.headers.get("x-relay-pin") || "";
  if (mem.config.room.externalControl !== false) return true;
  return Boolean(pin && (pin === mem.config.room.configPin || pin === mem.config.room.panelPin));
}

function pinStrict(request: Request) {
  const pin = request.headers.get("x-relay-pin") || "";
  return Boolean(pin && pin === memory().config.room.configPin);
}

export const Route = createFileRoute("/api/peer")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        if (!pinOk(request)) return Response.json({ ok: false, message: "External control off" }, { status: 401 });
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
          host: {
            dim: mem.host.dim,
            locked: mem.host.locked,
            pageId: mem.host.pageId,
          },
          vars,
          macros,
        });
      },
      POST: async ({ request }) => {
        await ensureLoaded();
        const body = await request.json().catch(() => ({})) as { command?: string; value?: string | number; macroId?: string };
        const dangerous = /system\.(reboot|update|restart)/.test(body.command || "");
        if (dangerous && !pinStrict(request)) return Response.json({ ok: false, message: "Config PIN required" }, { status: 401 });
        if (!pinOk(request)) return Response.json({ ok: false, message: "External control off" }, { status: 401 });
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
        const result = await applyHost(body.command, body.value, mem.host, mem.vars, { allowReboot: dangerous && pinStrict(request) });
        pushLog({ kind: "system", ok: result.ok, title: `Peer ${body.command}`, detail: result.message });
        await persist();
        return Response.json(result);
      },
    },
  },
});
