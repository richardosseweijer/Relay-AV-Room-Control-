/**
 * Vite plugin: attach optional venue HTTPS server sharing the same Connect app
 * as the AV-LAN HTTP listener (dev + preview). Soft-fail; never touches AV bind.
 */
import {
  bootPlanHttpsVenueListen,
  startHttpsVenueServer,
} from "./https-venue-listen.mjs";

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
    const httpServer = server.httpServer;
    if (httpServer && venueServer) {
      const closeVenue = () => {
        try {
          venueServer?.close();
        } catch {
          /* ignore */
        }
        venueServer = null;
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
