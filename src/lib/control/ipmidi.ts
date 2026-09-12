import type { CommandResult } from "./types";
import { sendUdp, sendUdpMulticast } from "./udp.ts";

export const IPMIDI_GROUP = "225.0.0.37";
export const IPMIDI_PORT = 21928;

export async function sendIpmidi(opts: {
  buf: Buffer;
  multicast?: boolean;
  host?: string;
  group?: string;
  port?: number;
}): Promise<CommandResult> {
  if (!opts.buf.length) return { ok: false, message: "ipMIDI empty payload" };
  const port = Number(opts.port || IPMIDI_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: "ipMIDI port 1–65535" };
  if (opts.multicast === false) {
    const host = String(opts.host || "").trim();
    if (!host) return { ok: false, message: "ipMIDI unicast needs host" };
    return sendUdp(host, port, opts.buf);
  }
  return sendUdpMulticast({
    group: opts.group || IPMIDI_GROUP,
    port,
    buf: opts.buf,
    ttl: 1,
  });
}
