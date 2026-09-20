/** Optional 720p RTSP tile (fMP4 + MSE). Delete this file + the control-panel PreviewTile branch. */
import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/control/types";
import { cn } from "@/lib/utils";

const MIMES = [
  'video/mp4; codecs="avc1.4D401F"',
  'video/mp4; codecs="avc1.4D4028"',
  'video/mp4; codecs="avc1.64001F"',
  'video/mp4; codecs="avc1.640028"',
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="avc1.42C01F"',
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
];

function mediaSourceType(): (new () => MediaSource) | undefined {
  const w = window as Window & { ManagedMediaSource?: new () => MediaSource };
  if (typeof w.ManagedMediaSource === "function") return w.ManagedMediaSource;
  if (typeof MediaSource === "function") return MediaSource;
  return undefined;
}

/** Safari SourceBuffer wants whole ISO-BMFF boxes, not TCP fragments. */
function takeBoxes(acc: Uint8Array): { emit: Uint8Array | null; rest: Uint8Array } {
  let offset = 0;
  while (offset + 8 <= acc.length) {
    const size = (acc[offset]! << 24) | (acc[offset + 1]! << 16) | (acc[offset + 2]! << 8) | acc[offset + 3]!;
    if (size < 8 || size > 4 * 1024 * 1024) break;
    if (offset + size > acc.length) break;
    offset += size;
  }
  if (!offset) return { emit: null, rest: acc };
  return { emit: acc.subarray(0, offset), rest: acc.subarray(offset) };
}

function hex2(n: number) {
  return n.toString(16).padStart(2, "0");
}

/** avcC in the init segment → actual H.264 mime (Main vs High vs Baseline). */
function codecFromInit(bytes: Uint8Array): string | undefined {
  for (let i = 0; i + 8 < bytes.length; i++) {
    if (bytes[i] === 0x61 && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x43) {
      const profile = bytes[i + 5]!;
      const compat = bytes[i + 6]!;
      const level = bytes[i + 7]!;
      return `video/mp4; codecs="avc1.${hex2(profile)}${hex2(compat)}${hex2(level)}"`;
    }
    if (bytes[i] === 0x68 && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x43) {
      return 'video/mp4; codecs="hvc1.1.6.L93.B0"';
    }
  }
}

function playStream(video: HTMLVideoElement, widgetId: string, token: string, setErr: (msg: string) => void): () => void {
  const Ctor = mediaSourceType();
  const isTypeSupported = (Ctor as typeof MediaSource | undefined)?.isTypeSupported?.bind(Ctor) ?? MediaSource.isTypeSupported?.bind(MediaSource);
  if (!Ctor || !MIMES.some((row) => isTypeSupported?.(row))) {
    setErr(Ctor ? "codec" : "no mse");
    return () => undefined;
  }
  const Source = Ctor;
  const stop = new AbortController();
  let objectUrl = "";

  async function attempt() {
    const ac = new AbortController();
    const onStop = () => ac.abort();
    stop.signal.addEventListener("abort", onStop);
    const started = Date.now();
    let lastProgress = Date.now();
    let gotPlaying = false;
    const onPlaying = () => {
      gotPlaying = true;
      lastProgress = Date.now();
    };
    const onTime = () => { lastProgress = Date.now(); };
    const onFail = () => ac.abort();
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("error", onFail);
    const stall = setInterval(() => {
      if (ac.signal.aborted) return;
      if (!gotPlaying && Date.now() - started > 15000) ac.abort();
      if (gotPlaying && Date.now() - lastProgress > 5000) ac.abort();
    }, 1000);
    const cleanup = () => {
      clearInterval(stall);
      stop.signal.removeEventListener("abort", onStop);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("error", onFail);
    };
    try {
    const ms = new Source();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(ms);
    video.disableRemotePlayback = true;
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      ms.addEventListener("sourceopen", () => resolve(), { once: true });
      ms.addEventListener("error", () => reject(new Error("mse")), { once: true });
    });
    if (ac.signal.aborted) return;
    let sb: SourceBuffer | undefined;
    const queue: Uint8Array[] = [];
    const pump = () => {
      if (!sb || sb.updating || !queue.length) return;
      const chunk = queue.shift()!;
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      try {
        sb.appendBuffer(copy as BufferSource);
      } catch {
        ac.abort();
      }
    };
    function onUpdateEnd() {
      if (ac.signal.aborted || !sb) return;
      lastProgress = Date.now();
      if (video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        // Copy remux can only decode from an IDR. GOP 30 @ 30fps = 1s — seeking
        // 120ms behind live is mid-GOP and paints black.
        if (end - video.currentTime > 2.5) video.currentTime = Math.max(0, end - 1.2);
        const start = video.buffered.start(0);
        if (video.currentTime - start > 8 && !sb.updating) {
          try {
            sb.remove(start, video.currentTime - 2);
            return;
          } catch { /* keep going */ }
        }
      }
      void video.play().catch(() => undefined);
      pump();
    }
    function ensureSb(init: Uint8Array) {
      if (sb) return true;
      const parsed = codecFromInit(init);
      const mime = [parsed, ...MIMES].filter((row): row is string => Boolean(row)).find((row) => isTypeSupported?.(row));
      if (!mime) {
        setErr("codec");
        ac.abort();
        return false;
      }
      sb = ms.addSourceBuffer(mime);
      sb.mode = "sequence";
      sb.addEventListener("updateend", onUpdateEnd);
      sb.addEventListener("error", onFail);
      return true;
    }
    const res = await fetch(`/api/preview?widget=${encodeURIComponent(widgetId)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      let msg = res.status === 503 ? "ffmpeg?" : "no signal";
      try {
        const body = await res.json() as { message?: string; steps?: string[] };
        if (res.status === 429) return;
        if (body?.steps?.length) msg = body.steps.join("\n");
        else if (body?.message) msg = body.message === "ffmpeg missing" ? "ffmpeg?" : body.message;
      } catch { /* keep msg */ }
      setErr(msg);
      return;
    }
    setErr("");
    const reader = res.body.getReader();
    let acc = new Uint8Array(0);
    while (!ac.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      lastProgress = Date.now();
      const next = new Uint8Array(acc.length + value.length);
      next.set(acc);
      next.set(value, acc.length);
      const split = takeBoxes(next);
      acc = new Uint8Array(split.rest);
      if (split.emit) {
        if (!ensureSb(split.emit)) return;
        queue.push(new Uint8Array(split.emit));
        pump();
      }
    }
    } finally {
      cleanup();
    }
  }

  void (async () => {
    while (!stop.signal.aborted) {
      try {
        await attempt();
      } catch (err) {
        if (stop.signal.aborted) break;
        if (!(err instanceof Error && err.name === "AbortError")) setErr("no signal");
      }
      if (stop.signal.aborted) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();

  return () => {
    stop.abort();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

export function PreviewTile({
  widget,
  token,
  disabled,
  onClick,
}: {
  widget: Widget;
  token: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("…");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!token) {
      setErr("locked");
      return;
    }
    let stop = () => undefined as void;
    function start() {
      if (!videoRef.current) return;
      setPlaying(false);
      stop();
      stop = playStream(videoRef.current, widget.id, token, setErr);
    }
    function onVis() {
      if (document.visibilityState === "hidden") {
        stop();
        setPlaying(false);
      } else start();
    }
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [widget.id, token]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 w-full overflow-hidden rounded-2xl border border-border bg-black text-left",
        disabled && "opacity-50",
      )}
    >
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        onPlaying={() => { setPlaying(true); setErr(""); }}
        onPause={() => setPlaying(false)}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain object-center"
      />
      <span className="relative z-10 m-2 rounded-md bg-bg/70 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-fg">
        {widget.label || "Preview"}
      </span>
      {err && !playing ? (
        <span className="absolute inset-0 z-10 flex items-center justify-center whitespace-pre-wrap px-3 text-center text-[11px] leading-snug text-muted">{err}</span>
      ) : null}
    </button>
  );
}
