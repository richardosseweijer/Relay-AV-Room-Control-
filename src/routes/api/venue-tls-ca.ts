import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded } from "@/lib/control/store.server";
import { validToken } from "@/lib/control/session.server";
import {
  planVenueTlsCaDownload,
  readVenueTlsCaCertPem,
  venueTlsCaTokenFromRequest,
} from "../../../scripts/venue-tls-ca-download.mjs";

/**
 * C2 — admin-authenticated download of venue CA cert (PEM) only.
 * Same-origin on NIC2 HTTPS after click-through; never serves private keys.
 */
export const Route = createFileRoute("/api/venue-tls-ca")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureLoaded();
        const token = venueTlsCaTokenFromRequest(request);
        const authorized = validToken(token, "config");
        const caPem = authorized ? readVenueTlsCaCertPem(process.cwd()) : null;
        const planned = planVenueTlsCaDownload({ authorized, caPem });
        return new Response(planned.body, {
          status: planned.status,
          headers: planned.headers,
        });
      },
    },
  },
});
