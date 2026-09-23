/**
 * Phase B4 — per-device nicFace: av | outbound (default av).
 *
 * peerFace (B3, peer-venue.ts) remains the narrow relay-host HMAC transport
 * selector (auto | av | outbound) and switches HTTP↔HTTPS for peers.
 * nicFace is the general device I/O bind face: which NIC supplies localAddress.
 * It has no auto (unset = av for back-compat). It does not rewrite peerFace.
 *
 * Venue rules (same soft-fail spirit as B3):
 * - outbound None / no IPv4 → soft-fail that device only; AV devices keep working.
 * - No cleartext HTTP/WS on venue (http / websocket → clear error).
 * - Multicast AV protocols (sACN, ipMIDI multicast) stay AV-only.
 * - Cast / https / tls-websocket may use outbound bind (TLS already).
 * - LE/ACME PARKED (was B2). No IP forward. No 0.0.0.0 listen.
 */
import type { DeviceInstance, LanProtocol, RoomConfig } from "./types";
import { allowedLanHost } from "./engine-policy.ts";
import {
  type LanNic,
  type NicPick,
  OUTBOUND_NONE_NAME,
  isOutboundNonePick,
  listLanNics,
  outboundBindFrom,
  avLanBind,
} from "./nics.ts";
import { isIpv4Literal } from "./peer-venue.ts";

export type NicFace = "av" | "outbound";

export const DEVICE_VENUE_SKIP_OUTBOUND_NONE =
  "Device venue face skipped: outbound NIC is None (air-gap / no venue NIC). AV-face devices still work.";

export const DEVICE_VENUE_SKIP_NO_BIND =
  "Device venue face skipped: outbound NIC has no usable IPv4 bind. AV-face devices still work.";

export const DEVICE_VENUE_SKIP_CLEARTEXT =
  "nicFace=outbound forbids cleartext on venue; use https / tls-websocket / cast, or relay-host Peer face (peerFace) for HMAC peers.";

/** Inventory resource.httpPath is always cleartext HTTP today — refuse on venue with a pointed reason. */
export const DEVICE_VENUE_SKIP_INVENTORY_CLEARTEXT =
  "Inventory httpPath is cleartext HTTP — nicFace=outbound forbids cleartext on venue. Use nicFace=av for inventory HTTP, or an HTTPS / Peer-face path for venue.";

export const DEVICE_VENUE_AV_ONLY =
  "Protocol stays on AV-LAN (multicast / AV-only by design); nicFace=outbound is invalid for this driver.";

export const DEVICE_VENUE_SKIP_BAD_HOST =
  "Venue device face: host must be an IPv4 address (no DNS; LE/FQDN PARKED).";

/** Normalize device.nicFace / auth.nicFace. Empty = av (back-compat). */
export function readNicFace(device: {
  nicFace?: string | null;
  auth?: Record<string, string>;
}): NicFace {
  const raw = String(device.nicFace ?? device.auth?.nicFace ?? "").trim().toLowerCase();
  if (raw === "outbound" || raw === "venue" || raw === "nic2") return "outbound";
  return "av";
}

export type DeviceBindPlan =
  | {
      ok: true;
      face: NicFace;
      localAddress?: string;
      /** Soft TLS verify for venue HTTPS (LE PARKED; mirrors peer-venue). */
      rejectUnauthorized: boolean;
    }
  | { ok: false; face: NicFace; message: string };

/**
 * Resolve bind localAddress for one device. Soft-fail outbound when None / no IPv4.
 * Does not change HTTP listen or peerFace planning.
 */
export function planDeviceBind(opts: {
  face: NicFace;
  nics: LanNic[];
  avPick: NicPick;
  outboundPick: NicPick;
}): DeviceBindPlan {
  if (opts.face === "outbound") {
    const name = String(opts.outboundPick?.name ?? "").trim();
    if (isOutboundNonePick(opts.outboundPick) || name === OUTBOUND_NONE_NAME) {
      return { ok: false, face: "outbound", message: DEVICE_VENUE_SKIP_OUTBOUND_NONE };
    }
    const bind = outboundBindFrom(opts.nics, opts.outboundPick);
    if (!bind.ok) {
      // Normalize "No IPv4 on …" into the soft-skip copy so AV devices stay the story.
      const msg = /no ipv4/i.test(bind.message) ? DEVICE_VENUE_SKIP_NO_BIND : bind.message;
      return { ok: false, face: "outbound", message: msg };
    }
    if (bind.none || !bind.localAddress) {
      return { ok: false, face: "outbound", message: DEVICE_VENUE_SKIP_NO_BIND };
    }
    return {
      ok: true,
      face: "outbound",
      localAddress: bind.localAddress,
      rejectUnauthorized: false,
    };
  }

  const bind = avLanBind(opts.nics, opts.avPick);
  if (!bind.ok) return { ok: false, face: "av", message: bind.message };
  return {
    ok: true,
    face: "av",
    localAddress: bind.localAddress,
    rejectUnauthorized: true,
  };
}

export function planDeviceBindForDevice(
  device: Pick<DeviceInstance, "nicFace" | "auth">,
  config?: RoomConfig,
  nics: LanNic[] = listLanNics(),
): DeviceBindPlan {
  const avPick: NicPick = {
    name: config?.room.avLanNicName,
    index: config?.room.avLanNicIndex ?? null,
  };
  const outboundPick: NicPick = {
    name: config?.room.outboundNicName,
    index: config?.room.outboundNicIndex ?? null,
  };
  return planDeviceBind({
    face: readNicFace(device),
    nics,
    avPick,
    outboundPick,
  });
}

/**
 * Protocols that must not be forced onto the venue face.
 * Multicast lighting/MIDI stay AV; cleartext HTTP/WS never on venue.
 */
export function nicFaceProtocolGate(
  face: NicFace,
  protocol: string | undefined,
  lan?: { multicast?: boolean },
): { ok: true } | { ok: false; message: string } {
  if (face !== "outbound") return { ok: true };
  const proto = String(protocol || "").toLowerCase() as LanProtocol | string;
  if (proto === "sacn") {
    return { ok: false, message: `${DEVICE_VENUE_AV_ONLY} (sACN multicast)` };
  }
  if (proto === "ipmidi" && lan?.multicast !== false) {
    return { ok: false, message: `${DEVICE_VENUE_AV_ONLY} (ipMIDI multicast)` };
  }
  if (proto === "http" || proto === "websocket") {
    return { ok: false, message: DEVICE_VENUE_SKIP_CLEARTEXT };
  }
  return { ok: true };
}

/**
 * Host allow for device I/O. AV face = existing RFC1918 gate.
 * Outbound face = IPv4 literal (public or private) like B3 venue peer; no DNS (LE/FQDN PARKED).
 */
export function deviceHostAllowed(
  face: NicFace,
  host: string | undefined,
  opts?: { localOk?: boolean },
): { ok: true } | { ok: false; message: string } {
  const raw = String(host ?? "").trim();
  if (face === "av") {
    if (!allowedLanHost(raw, opts)) {
      return { ok: false, message: "Host not on room LAN" };
    }
    return { ok: true };
  }
  if (opts?.localOk && /^(localhost|127\.0\.0\.1|::1)$/i.test(raw)) return { ok: true };
  if (!isIpv4Literal(raw)) {
    return { ok: false, message: DEVICE_VENUE_SKIP_BAD_HOST };
  }
  return { ok: true };
}
