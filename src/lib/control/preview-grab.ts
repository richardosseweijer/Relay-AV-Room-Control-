/** Optional RTSP → fMP4 preview. Rip out: this file, src/routes/api/preview.ts,
 *  src/components/panel/preview-tile.tsx, WidgetType "preview" + streamUrl,
 *  pages-editor Preview fields, control-panel PreviewTile branch,
 *  scripts/preview-url.test.mjs (and its package.json test entry). */
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { allowedLanHost } from "./engine-policy.ts";
import type { DeviceInstance, Widget } from "./types";

const MAX_URL = 320;
const MAX_LIVE = 4;
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
  if (!allowedLanHost(parsed.hostname)) return { ok: false, message: "Host not on room LAN" };
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(parsed.pathname) || parsed.pathname.length > 128 || parsed.pathname.includes("..")) {
    return { ok: false, message: "Bad path" };
  }
  return { ok: true, href: parsed.href };
}

export function previewUrlForWidget(widget: Widget, devices: DeviceInstance[]): { ok: true; href: string } | { ok: false; message: string } {
  const typed = String(widget.streamUrl ?? "").trim();
  if (typed) return parsePreviewUrl(typed);
  const device = devices.find((row) => row.id === widget.bind.device);
  if (!device?.host) return { ok: false, message: "Set stream URL or bind a device" };
  return parsePreviewUrl(`rtsp://${device.host}:8554/sub/av`);
}

export function openPreviewStream(href: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (live >= MAX_LIVE) return Promise.reject(new Error("busy"));
  live += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    live = Math.max(0, live - 1);
  };
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-rw_timeout", "5000000"];
    if (href.startsWith("rtsp:")) args.push("-rtsp_transport", "tcp");
    args.push(
      "-fflags", "nobuffer",
      "-i", href,
      "-an",
      "-c:v", "copy",
      "-f", "mp4",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-reset_timestamps", "1",
      "pipe:1",
    );
    let handed = false;
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const fail = (err: Error) => {
      if (handed) return;
      handed = true;
      signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL");
      release();
      reject(err);
    };
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort);
    child.stderr?.resume();
    child.stdout?.on("error", () => child.kill("SIGKILL"));
    child.on("error", (err: NodeJS.ErrnoException) => {
      fail(err.code === "ENOENT" ? new Error("ffmpeg missing") : err);
    });
    child.on("spawn", () => {
      if (handed || !child.stdout) {
        fail(new Error("no frame"));
        return;
      }
      handed = true;
      child.on("close", () => {
        signal?.removeEventListener("abort", onAbort);
        release();
      });
      resolve(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
    });
    child.on("close", () => {
      if (!handed) fail(new Error("no frame"));
    });
  });
}
