/** Optional 720p RTSP tile (fMP4 + MSE). Delete this file + the control-panel PreviewTile branch. */
import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/control/types";
import { cn } from "@/lib/utils";

const MIMES = [
  'video/mp4; codecs="avc1.64001F"',
  'video/mp4; codecs="avc1.4D401F"',
  'video/mp4; codecs="avc1.42E01E"',
  'video/mp4; codecs="avc1.640028"',
];

function mediaSourceType(): (new () => MediaSource) | undefined {
  const w = window as Window & { ManagedMediaSource?: new () => MediaSource };
  if (typeof w.ManagedMediaSource === "function") return w.ManagedMediaSource;
  if (typeof MediaSource === "function") return MediaSource;
  return undefined;
}

function playStream(video: HTMLVideoElement, widgetId: string, token: string, setErr: (msg: string) => void): () => void {
  const Ctor = mediaSourceType();
  const isTypeSupported = (Ctor as typeof MediaSource | undefined)?.isTypeSupported?.bind(Ctor) ?? MediaSource.isTypeSupported?.bind(MediaSource);
  const mime = MIMES.find((row) => isTypeSupported?.(row));
  if (!Ctor || !mime) {
    setErr(Ctor ? "codec" : "no mse");
    return () => undefined;
  }
  const Source = Ctor;
  const chosenMime = mime;
  const ac = new AbortController();
  let objectUrl = "";

  async function attempt() {
    const ms = new Source();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(ms);
    video.disableRemotePlayback = true;
    video.src = objectUrl;
    const queue: Uint8Array[] = [];
    let sb: SourceBuffer | null = null;
    await new Promise<void>((resolve, reject) => {
      ms.addEventListener("sourceopen", () => resolve(), { once: true });
      ms.addEventListener("error", () => reject(new Error("mse")), { once: true });
    });
    if (ac.signal.aborted) return;
    sb = ms.addSourceBuffer(chosenMime);
    sb.mode = "sequence";
    const pump = () => {
      if (!sb || sb.updating || !queue.length) return;
      const chunk = queue.shift()!;
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      try {
        sb.appendBuffer(copy as BufferSource);
      } catch {
        setErr("no signal");
        ac.abort();
      }
    };
    sb.addEventListener("updateend", () => {
      if (!sb || ac.signal.aborted) return;
      if (video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1);
        if (end - video.currentTime > 2) video.currentTime = Math.max(0, end - 0.25);
        const start = video.buffered.start(0);
        if (video.currentTime - start > 20 && !sb.updating) {
          try {
            sb.remove(start, video.currentTime - 8);
            return;
          } catch { /* keep going */ }
        }
      }
      void video.play().catch(() => undefined);
      pump();
    });
    const res = await fetch(`/api/preview?widget=${encodeURIComponent(widgetId)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      setErr(res.status === 503 ? "ffmpeg?" : "no signal");
      return;
    }
    setErr("");
    const reader = res.body.getReader();
    while (!ac.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        queue.push(value);
        pump();
      }
    }
  }

  void (async () => {
    while (!ac.signal.aborted) {
      try {
        await attempt();
      } catch (err) {
        if (ac.signal.aborted) break;
        setErr(err instanceof Error && err.name === "AbortError" ? "" : "no signal");
      }
      if (ac.signal.aborted) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();

  return () => {
    ac.abort();
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
        "relative flex h-full min-h-0 min-w-0 w-full overflow-hidden rounded-2xl border border-border bg-raised text-left",
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
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <span className="relative z-10 m-2 rounded-md bg-bg/70 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-fg">
        {widget.label || "Preview"}
      </span>
      {err && !playing ? (
        <span className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted">{err}</span>
      ) : null}
    </button>
  );
}
