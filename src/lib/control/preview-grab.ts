/** Optional RTSP → fMP4 preview. Rip out: this file, src/routes/api/preview.ts,
 *  src/components/panel/preview-tile.tsx, WidgetType "preview" + streamUrl,
 *  pages-editor Preview fields, control-panel PreviewTile branch,
 *  scripts/preview-url.test.mjs (and its package.json test entry). */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { PassThrough, Readable } from "node:stream";
import { hostLanContains } from "./nics.ts";
import type { DeviceInstance, Widget } from "./types";

const MAX_URL = 320;
const MAX_LIVE = 4;
const FIRST_BYTE_MS = 12000;
let live = 0;
let ffmpegCaps: { version: string; localaddr: boolean } | null = null;

export class PreviewError extends Error {
  steps: string[];
  constructor(message: string, steps: string[]) {
    super(message);
    this.steps = steps;
  }
}

export function previewStepsOf(err: unknown): string[] {
  return err instanceof PreviewError ? err.steps : [];
}

export function parsePreviewUrl(raw: string): { ok: true; href: string } | { ok: false; message: string } {
  const text = String(raw ?? "").trim();
  if (!text || text.length > MAX_URL) return { ok: false, message: "Bad stream URL" };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, message: "Bad stream URL" };
  }
  if (parsed.protocol !== "rtsp:" && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "rtsp/http only" };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, message: "Bad stream URL" };
  }
  if (parsed.port) {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: "Bad port" };
  }
  if (!hostLanContains(parsed.hostname)) return { ok: false, message: "Host not on room LAN" };
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(parsed.pathname) || parsed.pathname.length > 128 || parsed.pathname.includes("..")) {
    return { ok: false, message: "Bad path" };
  }
  return { ok: true, href: parsed.href };
}

function deviceLanIp(host: string): string {
  const raw = String(host ?? "").trim().split("/")[0];
  const m = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/);
  return m ? m[1] : raw;
}

export function previewUrlForWidget(widget: Widget, devices: DeviceInstance[]): { ok: true; href: string } | { ok: false; message: string } {
  const typed = String(widget.streamUrl ?? "").trim();
  if (typed) return parsePreviewUrl(typed);
  const device = devices.find((row) => row.id === widget.bind.device);
  if (!device?.host) return { ok: false, message: "Set stream URL or bind a device" };
  return parsePreviewUrl(`rtsp://${deviceLanIp(device.host)}:554/sub/av`);
}

export function previewRtspTransports(widget?: Widget): Array<"tcp" | "udp"> {
  const raw = widget?.previewTransport;
  if (raw === "tcp") return ["tcp"];
  if (raw === "udp") return ["udp"];
  return ["udp", "tcp"];
}

export function readFfmpegCaps() {
  if (ffmpegCaps) return ffmpegCaps;
  const ver = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", timeout: 5000 });
  if (ver.error) return null;
  const blob = `${ver.stdout || ""}\n${ver.stderr || ""}`;
  const version = blob.split("\n").find((line) => /ffmpeg version/i.test(line))?.replace(/^ffmpeg version /i, "").split(/\s+/)[0] || "ok";
  const help = spawnSync("ffmpeg", ["-hide_banner", "-h", "demuxer=rtsp"], { encoding: "utf8", timeout: 5000 });
  const text = `${help.stdout || ""}\n${help.stderr || ""}`;
  ffmpegCaps = { version: version.slice(0, 24), localaddr: text.includes("-localaddr") };
  return ffmpegCaps;
}

export function tcpReachable(host: string, port: number, ms = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, ms);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function stderrNote(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString("utf8").replace(/\s+/g, " ").trim();
  const opt = text.match(/Unrecognized option '([^']+)'/i) || text.match(/Option(?:\s+(\S+))? not found/i);
  if (opt) return `Option ${opt[1] || "?"} not found`;
  return text.slice(0, 80) || "exit";
}

function ffmpegHint(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString("utf8").slice(0, 240);
  if (/401 Unauthorized/i.test(text)) return "auth";
  if (/404 Not Found/i.test(text) && !/Option/i.test(text)) return "404";
  if (/Connection refused/i.test(text)) return "refused";
  if (/Protocol not found|Invalid data found/i.test(text)) return "bad codec";
  if (/Option .* not found|Unrecognized option/i.test(text)) return "ffmpeg flags";
  return "no signal";
}

export function previewFfmpegArgs(href: string, transport?: "tcp" | "udp", localaddr?: string) {
  const args = ["-hide_banner", "-loglevel", "error"];
  if (href.startsWith("rtsp:") && transport) args.push("-rtsp_transport", transport);
  if (localaddr) args.push("-localaddr", localaddr);
  args.push(
    "-fflags", "nobuffer+discardcorrupt",
    "-flags", "low_delay",
    "-probesize", "32768",
    "-analyzeduration", "500000",
    "-i", href,
    "-an",
    "-c:v", "copy",
    "-bsf:v", "dump_extra",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-flush_packets", "1",
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  );
  return args;
}

function spawnFfmpeg(
  href: string,
  signal: AbortSignal | undefined,
  localaddr: string | undefined,
  waitMs: number,
  transport?: "tcp" | "udp",
): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const args = previewFfmpegArgs(href, transport, localaddr);
    let handed = false;
    const errChunks: Buffer[] = [];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const fail = (err: Error) => {
      if (handed) return;
      handed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL");
      reject(err);
    };
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => fail(new Error("no keyframe")), waitMs);
    child.stderr?.on("data", (buf: Buffer) => {
      if (errChunks.length < 8) errChunks.push(buf);
    });
    child.stdout?.on("error", () => child.kill("SIGKILL"));
    child.on("error", (err: NodeJS.ErrnoException) => {
      fail(err.code === "ENOENT" ? new Error("ffmpeg missing") : err);
    });
    child.stdout?.on("readable", function onReadable() {
      const buf = child.stdout?.read() as Buffer | null;
      if (!buf || handed) return;
      handed = true;
      clearTimeout(timer);
      child.stdout?.off("readable", onReadable);
      const out = new PassThrough();
      out.write(buf);
      child.stdout?.pipe(out);
      child.on("close", () => {
        signal?.removeEventListener("abort", onAbort);
        out.end();
      });
      resolve(Readable.toWeb(out) as ReadableStream<Uint8Array>);
    });
    child.on("close", () => {
      if (handed) return;
      const err = new Error(ffmpegHint(errChunks)) as Error & { note?: string };
      err.note = stderrNote(errChunks);
      fail(err);
    });
  });
}

export async function openPreviewStream(
  href: string,
  signal?: AbortSignal,
  localAddrs?: Array<string | undefined>,
  widget?: Widget,
): Promise<ReadableStream<Uint8Array>> {
  if (live >= MAX_LIVE) return Promise.reject(new PreviewError("busy", ["busy"]));
  live += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    live = Math.max(0, live - 1);
  };
  const steps: string[] = [`url ${href}`];
  try {
    const caps = readFfmpegCaps();
    if (!caps) throw new PreviewError("ffmpeg missing", [...steps, "ffmpeg missing"]);
    steps.push(`ffmpeg ${caps.version}`);
    if (href.startsWith("rtsp:") || href.startsWith("http:") || href.startsWith("https:")) {
      const parsed = new URL(href);
      const port = Number(parsed.port || (href.startsWith("rtsp:") ? 554 : 80));
      const up = await tcpReachable(parsed.hostname, port);
      steps.push(up ? `encoder ${parsed.hostname}:${port} open` : `encoder ${parsed.hostname}:${port} closed`);
      if (!up && href.startsWith("rtsp:")) throw new PreviewError("refused", steps);
    }
    const binds = caps.localaddr && localAddrs?.length ? localAddrs : [undefined];
    if (!caps.localaddr) steps.push("bind kernel (no -localaddr)");
    steps.push("copy");
    const transports: Array<"tcp" | "udp" | undefined> = href.startsWith("rtsp:") ? previewRtspTransports(widget) : [undefined];
    steps.push(`transport ${transports.filter(Boolean).join(">") || "in"}`);
    const waitMs = binds.length * transports.length > 2 ? 5000 : FIRST_BYTE_MS;
    let last = "no signal";
    for (const addr of binds) {
      for (const transport of transports) {
        if (signal?.aborted) throw new PreviewError("no signal", steps);
        const label = [transport || "in", addr || "kernel"].join("@");
        try {
          const body = await spawnFfmpeg(href, signal, caps.localaddr ? addr : undefined, waitMs, transport);
          const reader = body.getReader();
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              const { done, value } = await reader.read();
              if (done) {
                release();
                controller.close();
                return;
              }
              if (value) controller.enqueue(value);
            },
            cancel() {
              release();
              return reader.cancel();
            },
          });
        } catch (err) {
          const caught = err instanceof Error ? err : new Error("no signal");
          last = caught.message;
          const note = (caught as Error & { note?: string }).note;
          steps.push(note ? `${label}: ${caught.message} (${note})` : `${label}: ${caught.message}`);
          if (caught.message === "ffmpeg missing") throw new PreviewError("ffmpeg missing", steps);
        }
      }
    }
    throw new PreviewError(last, steps);
  } catch (err) {
    release();
    if (err instanceof PreviewError) throw err;
    throw new PreviewError(err instanceof Error ? err.message : "no signal", steps);
  }
}
