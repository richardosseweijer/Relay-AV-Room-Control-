import { definePlugin } from "nitro";
import { ensureLoaded } from "../../src/lib/control/store.server";

export default definePlugin(async () => {
  try {
    await ensureLoaded();
  } catch (err) {
    console.error("[relay] startup initialization failed", err);
    throw err;
  }
});
