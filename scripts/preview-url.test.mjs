import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openPreviewStream, parsePreviewUrl, previewFfmpegArgs, previewUrlForWidget } from "../src/lib/control/preview-grab.ts";

test("preview URL allowlist", () => {
  assert.equal(parsePreviewUrl("rtsp://10.0.10.40:8554/sub/av").ok, true);
  assert.equal(parsePreviewUrl("rtsp://10.0.25.242:554/sub/av").ok, true);
  assert.equal(parsePreviewUrl("rtsp://192.168.1.8:8554/main/av").ok, true);
  assert.equal(parsePreviewUrl("http://10.0.10.40/snap.jpg").ok, true);
  assert.equal(parsePreviewUrl("rtsp://8.8.8.8:8554/sub/av").ok, false);
  assert.equal(parsePreviewUrl("rtsp://evil.example:8554/sub/av").ok, false);
  assert.equal(parsePreviewUrl("file:///etc/passwd").ok, false);
  assert.equal(parsePreviewUrl("rtsp://127.0.0.1:8554/sub/av").ok, false);
  assert.equal(parsePreviewUrl("rtsp://user:pass@10.0.10.40:8554/sub/av").ok, false);
  assert.equal(parsePreviewUrl("rtsp://10.0.10.40:8554/sub/av?x=1").ok, false);
});

test("preview URL from bound device", () => {
  const widget = { id: "p1", type: "preview", streamUrl: "", bind: { kind: "macro", device: "box" } };
  const hit = previewUrlForWidget(widget, [{ id: "box", host: "10.0.25.40" }]);
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.href, "rtsp://10.0.25.40:554/sub/av");
});

test("typed stream URL wins over device host", () => {
  const widget = { id: "p1", type: "preview", streamUrl: "rtsp://10.0.10.9:8554/main/av", bind: { kind: "macro", device: "box" } };
  const hit = previewUrlForWidget(widget, [{ id: "box", host: "10.0.25.40" }]);
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.href, "rtsp://10.0.10.9:8554/main/av");
});

test("device host with a LAN port still builds :554", () => {
  const widget = { id: "p1", type: "preview", streamUrl: "", bind: { kind: "macro", device: "box" } };
  const hit = previewUrlForWidget(widget, [{ id: "box", host: "10.0.25.40:80" }]);
  assert.equal(hit.ok, true);
  if (hit.ok) assert.equal(hit.href, "rtsp://10.0.25.40:554/sub/av");
});

test("preview needs a URL or a device host", () => {
  const widget = { id: "p1", type: "preview", streamUrl: "", bind: { kind: "macro" } };
  assert.equal(previewUrlForWidget(widget, []).ok, false);
});

test("stream reports ffmpeg missing when binary is off PATH", async () => {
  const orig = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    await assert.rejects(() => openPreviewStream("rtsp://10.0.10.40:8554/sub/av"), /ffmpeg missing/);
  } finally {
    process.env.PATH = orig;
  }
});

test("ffmpeg args stay on flags every static build has", () => {
  const args = previewFfmpegArgs("rtsp://10.0.25.242:554/sub/av", "udp").join(" ");
  assert.ok(args.includes("-rtsp_transport udp"));
  assert.ok(args.includes("-probesize 32768"));
  assert.ok(args.includes("-muxdelay 0"));
  assert.ok(args.includes("-flush_packets 1"));
  assert.equal(args.includes("separate_moof"), false);
  assert.equal(args.includes("reset_timestamps"), false);
  assert.equal(args.includes("-nostdin"), false);
  assert.equal(args.includes("-localaddr"), false);
  const bound = previewFfmpegArgs("rtsp://10.0.25.242:554/sub/av", "tcp", "10.0.25.10").join(" ");
  assert.ok(bound.includes("-localaddr 10.0.25.10"));
});
