/**
 * Image widget host media — GET (panel|config, like /api/preview) and DELETE (config).
 *
 * Auth: Bearer sessionStorage/localStorage tokens (no cookies). Panel ImageTile
 * (later MR) must fetch with Authorization like PreviewTile — bare <img src>
 * will not send the token.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded } from "@/lib/control/store.server";
import { validToken, validTokenAny } from "@/lib/control/session.server";
import { bearerToken, deleteMedia, mediaIdOk, readMedia } from "@/lib/control/media-store";

export const Route = createFileRoute("/api/media/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        await ensureLoaded();
        const token = bearerToken(request);
        if (!validTokenAny(token)) {
          return Response.json({ ok: false, message: "Auth failed" }, { status: 401 });
        }
        const id = params.id ?? "";
        if (!mediaIdOk(id)) {
          return Response.json({ ok: false, message: "Bad id" }, { status: 400 });
        }
        const row = await readMedia(id);
        if (!row) return Response.json({ ok: false, message: "Not found" }, { status: 404 });
        return new Response(new Uint8Array(row.bytes), {
          headers: {
            "content-type": row.mime,
            "content-length": String(row.bytes.length),
            "cache-control": "private, max-age=86400",
            "x-content-type-options": "nosniff",
          },
        });
      },
      DELETE: async ({ request, params }) => {
        await ensureLoaded();
        const token = bearerToken(request);
        if (!validToken(token, "config")) {
          return Response.json({ ok: false, message: "Config lock required" }, { status: 401 });
        }
        const id = params.id ?? "";
        if (!mediaIdOk(id)) {
          return Response.json({ ok: false, message: "Bad id" }, { status: 400 });
        }
        const removed = await deleteMedia(id);
        if (!removed) return Response.json({ ok: false, message: "Not found" }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
  },
});
