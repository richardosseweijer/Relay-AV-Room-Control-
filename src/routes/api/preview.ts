/** Optional. Delete this route to drop the 720p preview stream. */
import { createFileRoute } from "@tanstack/react-router";
import { openPreviewStream, previewStepsOf, previewUrlForWidget } from "@/lib/control/preview-grab";
import { previewBindAddrs } from "@/lib/control/nics";
import { ensureLoaded, memory } from "@/lib/control/store.server";
import { validToken } from "@/lib/control/session.server";

export const Route = createFileRoute("/api/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        if (!validToken(token, "panel") && !validToken(token, "config")) {
          return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        }
        const id = new URL(request.url).searchParams.get("widget") ?? "";
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
          return Response.json({ ok: false, message: "Bad widget" }, { status: 400 });
        }
        const mem = memory();
        const widget = mem.config.pages.flatMap((page) => page.widgets).find((row) => row.id === id);
        if (!widget || widget.type !== "preview") {
          return Response.json({ ok: false, message: "Not a preview" }, { status: 404 });
        }
        const parsed = previewUrlForWidget(widget, mem.config.devices);
        if (!parsed.ok) return Response.json({ ok: false, message: parsed.message, steps: [parsed.message] }, { status: 400 });
        try {
          const dest = new URL(parsed.href).hostname;
          const body = await openPreviewStream(parsed.href, request.signal, previewBindAddrs(dest, mem.config));
          return new Response(body, {
            headers: {
              "content-type": "video/mp4",
              "cache-control": "no-store",
              "x-accel-buffering": "no",
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "grab failed";
          const steps = previewStepsOf(err);
          const status = message === "ffmpeg missing" ? 503 : message === "busy" ? 429 : 502;
          return Response.json({ ok: false, message, steps }, { status });
        }
      },
    },
  },
});
