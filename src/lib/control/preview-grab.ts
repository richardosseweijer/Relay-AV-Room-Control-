/** Optional RTSP → fMP4 preview. Rip out: this file, src/routes/api/preview.ts,
 *  src/components/panel/preview-tile.tsx, WidgetType "preview" + streamUrl,
 *  pages-editor Preview fields, control-panel PreviewTile branch,
 *  scripts/preview-url.test.mjs (and its package.json test entry). */
import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import { hostLanContains } from "./nics.ts";
import type { DeviceInstance, Widget } from "./types";

const MAX_URL = 320;
const MAX_LIVE = 4;
const FIRST_BYTE_MS = 12000;
let live = 0;

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
  return parsePreviewUrl(`rtsp://${deviceLanIp(device.host)}:8554/sub/av`);
}

function ffmpegHint(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).toString("utf8").slice(0, 240);
  if (/401 Unauthorized/i.test(text)) return "auth";
  if (/404 Not Found/i.test(text)) return "404";
  if (/Connection refused/i.test(text)) return "refused";
  if (/Protocol not found|Invalid data found/i.test(text)) return "bad codec";
  if (/Option .* not found/i.test(text)) return "ffmpeg flags";
  return "no signal";
}

function spawnFfmpeg(
  href: string,
  signal: AbortSignal | undefined,
  localaddr: string | undefined,
  waitMs: number,
): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-nostdin", "-loglevel", "error"];
    if (href.startsWith("rtsp:")) {
      // VLC uses UDP RTP. Forcing TCP-only hangs on boxes that don't interleave (ZowieBox :554).
      args.push("-rtsp_flags", "prefer_tcp", "-allowed_media_types", "video");
    }
    if (localaddr) args.push("-localaddr", localaddr);
    args.push(
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-i", href,
      "-an",
      "-c:v", "copy",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof+separate_moof",
      "-reset_timestamps", "1",
      "pipe:1",
    );
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
      if (!handed) fail(new Error(ffmpegHint(errChunks)));
    });
  });
}

export async function openPreviewStream(
  href: string,
  signal?: AbortSignal,
  localAddrs?: Array<string | undefined>,
): Promise<ReadableStream<Uint8Array>> {
  if (live >= MAX_LIVE) return Promise.reject(new Error("busy"));
  live += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    live = Math.max(0, live - 1);
  };
  const tries = localAddrs?.length ? localAddrs : [undefined];
  const waitMs = tries.length > 1 ? 6000 : FIRST_BYTE_MS;
  let last: Error = new Error("no signal");
  try {
    for (const addr of tries) {
      if (signal?.aborted) throw new Error("no signal");
      try {
        const body = await spawnFfmpeg(href, signal, addr, waitMs);
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
        last = err instanceof Error ? err : new Error("no signal");
        if (last.message === "ffmpeg missing") throw last;
      }
    }
    throw last;
  } catch (err) {
    release();
    throw err;
  }
}
