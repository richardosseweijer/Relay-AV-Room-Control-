import os from "node:os";
import type { RoomConfig } from "./types";

/** Phase 0 inventory (bind later): udp.ts, wol.ts, engine tcp/session/ping, pjlink.ts, ws.ts (net+tls), rtp-midi.ts, http-client.ts, cast.ts tls.connect. listHostInterfaces = serial/GPIO/MIDI, not NICs. */

export type LanNic = {
  index: number;
  name: string;
  ipv4: string | null;
  label: string;
};

export type NicAddr = {
  address?: string;
  family?: string | number;
  internal?: boolean;
};

export type NicPick = {
  name?: string | null;
  index?: number | null;
};

const EM = "\u2014";

function isInternal(addr: NicAddr) {
  return addr.internal === true;
}

function isIpv4(addr: NicAddr) {
  return addr.family === "IPv4" || addr.family === 4;
}

export function listLanNicsFrom(ifaces: Record<string, NicAddr[] | undefined>): LanNic[] {
  const names = Object.keys(ifaces).filter((name) => {
    const addrs = ifaces[name] ?? [];
    if (!addrs.length) return false;
    return !addrs.every(isInternal);
  });
  names.sort((a, b) => a.localeCompare(b, "en"));
  return names.map((name, index) => {
    const addrs = ifaces[name] ?? [];
    const v4 = addrs.find((addr) => isIpv4(addr) && !isInternal(addr));
    const ipv4 = v4?.address?.trim() || null;
    return {
      index,
      name,
      ipv4,
      label: `${index} ${EM} ${name} (${ipv4 ?? "no IPv4"})`,
    };
  });
}

export function listLanNics(): LanNic[] {
  return listLanNicsFrom(os.networkInterfaces() as Record<string, NicAddr[] | undefined>);
}

function pickSet(pick: NicPick) {
  if (String(pick.name ?? "").trim()) return true;
  return pick.index != null && Number.isFinite(Number(pick.index));
}

export function resolveNic(nics: LanNic[], pick: NicPick): LanNic | null {
  const name = String(pick.name ?? "").trim();
  if (name) {
    const hit = nics.find((nic) => nic.name === name);
    if (hit) return hit;
  }
  if (pick.index != null && Number.isFinite(Number(pick.index))) {
    const hit = nics.find((nic) => nic.index === Number(pick.index));
    if (hit) return hit;
  }
  return null;
}

export function outboundAddress(
  nics: LanNic[],
  pick: NicPick,
): { ok: true; ipv4?: string; nic?: LanNic } | { ok: false; message: string } {
  if (!pickSet(pick)) return { ok: true };
  const nic = resolveNic(nics, pick);
  if (!nic) return { ok: false, message: "NIC not found" };
  if (!nic.ipv4) return { ok: false, message: `No IPv4 on ${nic.name}` };
  return { ok: true, ipv4: nic.ipv4, nic };
}

export function avLanBind(
  nics: LanNic[],
  pick: NicPick,
): { ok: true; localAddress?: string } | { ok: false; message: string } {
  const resolved = outboundAddress(nics, pick);
  if (!resolved.ok) return resolved;
  if (!resolved.ipv4) return { ok: true };
  return { ok: true, localAddress: resolved.ipv4 };
}

export function roomLanBind(config?: RoomConfig): { ok: true; localAddress?: string } | { ok: false; message: string } {
  if (!config) return { ok: true };
  return avLanBind(listLanNics(), { name: config.room.avLanNicName, index: config.room.avLanNicIndex ?? null });
}

export function roomOutboundBind(config?: RoomConfig): { ok: true; localAddress?: string } | { ok: false; message: string } {
  if (!config) return { ok: true };
  return avLanBind(listLanNics(), { name: config.room.outboundNicName, index: config.room.outboundNicIndex ?? null });
}
