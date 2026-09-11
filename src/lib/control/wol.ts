import type { CommandResult } from "./types";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function subnetBroadcast(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return "255.255.255.255";
  return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
}

export async function sendWol(mac: string, host: string): Promise<CommandResult> {
  const clean = mac.replace(/[^0-9a-f]/gi, "");
  if (clean.length !== 12) return { ok: false, message: "Need the device MAC in the mac field (wired MAC if the device is on Ethernet)" };
  const dgram = await import("node:dgram");
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  const macBuf = Buffer.from(clean, "hex");
  for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  const targets = [...new Set([host, subnetBroadcast(host), "255.255.255.255"].filter(Boolean))];
  const ports = [9, 7];
  try {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      sock.once("error", reject);
      sock.bind(0, "0.0.0.0", () => {
        try { sock.setBroadcast(true); } catch { /* ignore */ }
        resolve();
      });
    });
    for (let n = 0; n < 8; n++) {
      for (const dest of targets) {
        for (const port of ports) {
          await new Promise<void>((resolve) => sock.send(packet, port, dest, () => resolve()));
        }
      }
      await sleep(60);
    }
    sock.close();
    return { ok: true, message: `WOL ${clean} → ${targets.join(", ")}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "WOL failed" };
  }
}
