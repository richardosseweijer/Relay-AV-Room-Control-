import { spawn } from "node:child_process";
import type { CommandResult } from "./types";

export function midiPortOk(port: string): boolean {
  return /^[A-Za-z0-9:_,-]{1,32}$/.test(String(port ?? "").trim());
}

export function midiHexOk(payload: string): string | null {
  const hex = String(payload ?? "").replace(/[^0-9a-f]/gi, "");
  if (!hex.length || hex.length % 2) return null;
  if (hex.length > 128) return null;
  return hex.toUpperCase();
}

export async function sendUsbMidi(opts: { port: string; payload: string; timeoutMs?: number }): Promise<CommandResult> {
  if (process.platform === "win32") {
    return { ok: false, message: "USB MIDI is ALSA amidi on Linux" };
  }
  const port = String(opts.port ?? "").trim();
  if (!midiPortOk(port) || port === "COM1") return { ok: false, message: "Set Interface to hw:1,0,0 (amidi -l)" };
  const hex = midiHexOk(opts.payload);
  if (!hex) return { ok: false, message: "USB MIDI payload needs even hex (max 64 bytes)" };
  const timeout = opts.timeoutMs ?? 1500;
  return new Promise((resolve) => {
    const child = spawn("amidi", ["-p", port, "-S", hex], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: "amidi timeout" }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `amidi ${code}` });
    });
  });
}
