/**
 * SSE stream of mem.host UI overlays (block / toast / locked / dim / pageId).
 * Same access model as GET /api/room: no PIN required for the host payload
 * (already public on the room snapshot); optional Bearer is accepted but unused
 * for redaction here; connect is rate-limited like /api/room.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ensureLoaded, memory } from "@/lib/control/store.server";
import { isLoopbackIp, tcpPeerAddress } from "@/lib/control/peer-auth";
import { roomRateLimited } from "@/lib/control/room-rate-limit";
import { hostUiPublic, subscribeHostUi } from "@/lib/control/host-ui-bus";

function clientIp(request: Request) {
  if (process.env.RELAY_TRUST_PROXY === "1") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
  }
  return tcpPeerAddress(request) || "unknown";
}

export const Route = createFileRoute("/api/host")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
          const ip = clientIp(request);
          if (!isLoopbackIp(ip) && roomRateLimited(token || ip)) {
            return Response.json({ error: "rate limited" }, { status: 429 });
          }
          await ensureLoaded();
          const enc = new TextEncoder();
          let closed = false;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const send = (data: string) => {
                if (closed) return;
                try {
                  controller.enqueue(enc.encode(data));
                } catch {
                  closed = true;
                }
              };
              const push = (host: ReturnType<typeof hostUiPublic>) => {
                send(`data: ${JSON.stringify(host)}\n\n`);
              };
              push(hostUiPublic(memory().host));
              const unsub = subscribeHostUi(push);
              const ping = setInterval(() => send(": ping\n\n"), 15000);
              const shut = () => {
                if (closed) return;
                closed = true;
                clearInterval(ping);
                unsub();
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              };
              request.signal.addEventListener("abort", shut);
              if (request.signal.aborted) shut();
            },
            cancel() {
              closed = true;
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-store, no-transform",
              connection: "keep-alive",
              "x-accel-buffering": "no",
            },
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return new Response(null, { status: 204 });
          return Response.json({ ok: false, error: "host stream unavailable" }, { status: 503 });
        }
      },
    },
  },
});
