import dgram from "node:dgram";
import type { CommandResult } from "./types";

export function isMulticastV4(host: string): boolean {
  const parts = String(host ?? "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] >= 224 && parts[0] <= 239;
}

export async function sendUdp(host: string, port: number, buf: Buffer): Promise<CommandResult> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.send(buf, port, host, (err) => {
      sock.close();
      resolve(err ? { ok: false, message: err.message } : { ok: true, message: "udp sent" });
    });
  });
}

export async function sendUdpMulticast(opts: {
  group: string;
  port: number;
  buf: Buffer;
  ttl?: number;
}): Promise<CommandResult> {
  if (!isMulticastV4(opts.group)) return { ok: false, message: "Not a multicast group" };
  const ttl = opts.ttl ?? 1;
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.once("error", (err) => {
      try { sock.close(); } catch { /* ignore */ }
      resolve({ ok: false, message: err.message });
    });
    sock.bind(0, () => {
      try { sock.setMulticastTTL(ttl); } catch { /* ignore */ }
      sock.send(opts.buf, opts.port, opts.group, (err) => {
        sock.close();
        resolve(err ? { ok: false, message: err.message } : { ok: true, message: "udp multicast sent" });
      });
    });
  });
}

export async function listenUdpMulticast(opts: {
  group: string;
  port: number;
  onMessage: (buf: Buffer) => void;
}): Promise<{ close: () => void } | { error: string }> {
  if (!isMulticastV4(opts.group)) return { error: "Not a multicast group" };
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.once("error", (err) => resolve({ error: err.message }));
    sock.bind(opts.port, () => {
      try {
        sock.addMembership(opts.group);
      } catch (err) {
        try { sock.close(); } catch { /* ignore */ }
        resolve({ error: err instanceof Error ? err.message : "join failed" });
        return;
      }
      sock.on("message", (msg) => opts.onMessage(msg));
      resolve({
        close: () => {
          try { sock.dropMembership(opts.group); } catch { /* ignore */ }
          try { sock.close(); } catch { /* ignore */ }
        },
      });
    });
  });
}
