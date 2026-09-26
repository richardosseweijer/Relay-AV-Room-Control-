/**
 * Image widget host media — POST upload (config session).
 * GET/DELETE by id live on /api/media/$id.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded } from "@/lib/control/store.server";
import { validToken } from "@/lib/control/session.server";
import { bearerToken, writeMedia } from "@/lib/control/media-store";

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await ensureLoaded();
        const token = bearerToken(request);
        if (!validToken(token, "config")) {
          return Response.json({ ok: false, message: "Config lock required" }, { status: 401 });
        }

        const declared = request.headers.get("content-type");
        // Multipart: field "file". Else raw body with image/* Content-Type.
        let bytes: Uint8Array;
        let mimeHint: string | null = declared;

        if (declared?.toLowerCase().startsWith("multipart/form-data")) {
          const form = await request.formData().catch(() => null);
          const file = form?.get("file");
          if (!(file instanceof Blob)) {
            return Response.json({ ok: false, message: "Expected multipart field 'file'" }, { status: 400 });
          }
          bytes = new Uint8Array(await file.arrayBuffer());
          mimeHint = file.type || null;
        } else {
          const buf = await request.arrayBuffer().catch(() => null);
          if (!buf) return Response.json({ ok: false, message: "Bad body" }, { status: 400 });
          bytes = new Uint8Array(buf);
        }

        const result = await writeMedia(bytes, mimeHint);
        if (!result.ok) {
          return Response.json({ ok: false, message: result.message }, { status: 400 });
        }
        return Response.json({
          ok: true,
          id: result.media.id,
          url: result.media.url,
          mime: result.media.mime,
          bytes: result.media.bytes,
        });
      },
    },
  },
});
