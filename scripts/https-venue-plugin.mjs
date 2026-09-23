/**
 * Vite plugin: attach optional venue HTTPS server sharing the same Connect app
 * as the AV-LAN HTTP listener (dev + preview). Soft-fail; never touches AV bind.
 * C1: registers https-venue-runtime so Generate can reload PEMs without AV downtime.
 */
import {
  bootPlanHttpsVenueListen,
  startHttpsVenueServer,
} from "./https-venue-listen.mjs";
import { registerHttpsVenueRuntime } from "./https-venue-runtime.mjs";

/**
 * @returns {import("vite").Plugin}
 */
export function httpsVenuePlugin() {
  /** @type {import("node:https").Server | null} */
  let venueServer = null;

  /**
   * @param {{ middlewares: import("node:http").RequestListener, httpServer?: import("node:http").Server | null, config: { root: string } }} server
   */
  function attach(server) {
    const ready = bootPlanHttpsVenueListen(server.config.root, process.env);
    const started = startHttpsVenueServer({
      ready,
      requestListener: server.middlewares,
    });
    venueServer = started.server;
    registerHttpsVenueRuntime({
      server: venueServer,
      requestListener: server.middlewares,
      rootDir: server.config.root,
    });
    const httpServer = server.httpServer;
    if (httpServer && venueServer) {
      const closeVenue = () => {
        try {
          venueServer?.close();
        } catch {
          /* ignore */
        }
        venueServer = null;
        registerHttpsVenueRuntime({
          server: null,
          requestListener: server.middlewares,
          rootDir: server.config.root,
        });
      };
      httpServer.on("close", closeVenue);
    }
  }

  return {
    name: "relay-https-venue",
    configureServer(server) {
      return () => attach(server);
    },
    configurePreviewServer(server) {
      return () => attach(server);
    },
  };
}
