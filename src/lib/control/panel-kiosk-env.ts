import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { kioskEnvBody, listVideoOutputs, resolveVideoOutput } from "./video-outputs";
import { panelKioskUrlFrom } from "./panel-kiosk-url";
import { listLanNics } from "./nics";
import type { RoomConfig } from "./types";
import { DEFAULT_PRODUCTION_CONTROL_PORT } from "./nics";

export const RELAY_KIOSK_ENV_REL = path.join("data", "relay-kiosk.env");

export function relayKioskEnvPath(cwd = process.cwd()) {
  return path.join(cwd, RELAY_KIOSK_ENV_REL);
}

/** Live panel root URL for Chromium kiosk (AV-LAN IPv4 / RELAY_LISTEN_HOST). Never 0.0.0.0. */
export function livePanelKioskUrl(room: RoomConfig["room"], port?: number | string | null) {
  const portRaw = port ?? process.env.PORT ?? DEFAULT_PRODUCTION_CONTROL_PORT;
  return panelKioskUrlFrom({
    nics: listLanNics(),
    pick: { name: room.avLanNicName, index: room.avLanNicIndex ?? null },
    port: portRaw,
    envHost: process.env.RELAY_LISTEN_HOST ?? null,
  });
}

/**
 * Write data/relay-kiosk.env from room HDMI pick + live AV panel URL.
 * Returns the URL used, or a soft-fail reason (does not throw on missing AV).
 */
export function writeRelayKioskEnv(
  room: RoomConfig["room"],
  opts?: { cwd?: string; outputs?: ReturnType<typeof listVideoOutputs>; port?: number | string | null },
):
  | { ok: true; path: string; url: string; outputName: string }
  | { ok: false; reason: string } {
  const urlRes = livePanelKioskUrl(room, opts?.port);
  if (!urlRes.ok) return { ok: false, reason: urlRes.reason };

  const outputs = opts?.outputs ?? listVideoOutputs();
  const row = resolveVideoOutput(
    {
      panelHdmiOutputName: room.panelHdmiOutputName ?? null,
      panelHdmiOutputIndex: room.panelHdmiOutputIndex ?? null,
    },
    outputs,
  );
  const body = kioskEnvBody(
    {
      panelHdmiOutputName: row?.name ?? room.panelHdmiOutputName ?? null,
      panelHdmiOutputIndex: row?.index ?? room.panelHdmiOutputIndex ?? null,
    },
    urlRes.url,
    outputs,
  );
  const dest = relayKioskEnvPath(opts?.cwd);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, body, { encoding: "utf8", mode: 0o644 });
  return {
    ok: true,
    path: dest,
    url: urlRes.url,
    outputName: row && row.name !== "local" ? row.name : "",
  };
}
