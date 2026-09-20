import os from "node:os";
import type { RoomConfig } from "./types";
import { allowedLanHost } from "./engine-policy.ts";

/** Phase 0 inventory (bind later): udp.ts, wol.ts, engine tcp/session/ping, pjlink.ts, ws.ts (net+tls), rtp-midi.ts, http-client.ts, cast.ts tls.connect. listHostInterfaces = serial/GPIO/MIDI, not NICs. */

export type LanNic = {
  index: number;
  name: string;
  ipv4: string | null;
  cidr?: string | null;
  label: string;
};

export type NicAddr = {
  address?: string;
  family?: string | number;
  internal?: boolean;
  cidr?: string | null;
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
    const cidr = v4?.cidr?.trim() || null;
    return {
      index,
      name,
      ipv4,
      cidr,
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

export function cidrContains(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (text: string) => {
    const oct = text.split(".").map(Number);
    if (oct.length !== 4 || oct.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return (((oct[0]! << 24) | (oct[1]! << 16) | (oct[2]! << 8) | oct[3]!) >>> 0);
  };
  const host = toInt(ip);
  const net = toInt(base);
  if (host == null || net == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (host & mask) === (net & mask);
}

function nicHolds(nic: LanNic | null | undefined, ip: string): boolean {
  if (!nic?.ipv4) return false;
  if (nic.cidr) return cidrContains(ip, nic.cidr);
  return nic.ipv4 === ip;
}

/** Dest IPv4 is on a host NIC subnet (public NIC included) or RFC1918. */
export function hostLanContains(ip: string, nics = listLanNics()): boolean {
  if (allowedLanHost(ip)) return true;
  return nics.some((nic) => nicHolds(nic, ip));
}

/** Bind the NIC that holds dest. Routed RFC1918 uses the kernel. Public dest tries AV, then the other NIC. */
export function previewBindAddrsFrom(
  nics: LanNic[],
  destIp: string,
  av: NicPick,
  outbound: NicPick,
): Array<string | undefined> {
  const avNic = resolveNic(nics, av);
  const outNic = resolveNic(nics, outbound);
  if (nicHolds(avNic, destIp) && avNic?.ipv4) return [avNic.ipv4];
  if (nicHolds(outNic, destIp) && outNic?.ipv4) return [outNic.ipv4];
  if (allowedLanHost(destIp)) return [undefined];
  const tries: Array<string | undefined> = [];
  if (avNic?.ipv4) tries.push(avNic.ipv4);
  if (outNic?.ipv4 && outNic.ipv4 !== avNic?.ipv4) tries.push(outNic.ipv4);
  tries.push(undefined);
  return tries;
}

export function previewBindAddrs(destIp: string, config?: RoomConfig): Array<string | undefined> {
  const nics = listLanNics();
  if (!config) return [undefined];
  return previewBindAddrsFrom(
    nics,
    destIp,
    { name: config.room.avLanNicName, index: config.room.avLanNicIndex ?? null },
    { name: config.room.outboundNicName, index: config.room.outboundNicIndex ?? null },
  );
}

