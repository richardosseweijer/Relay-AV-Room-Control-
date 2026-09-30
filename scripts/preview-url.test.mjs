import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openPreviewStream, parsePreviewUrl, previewFfmpegArgs, previewLiveFfmpegArgs, previewRtspTransports, previewUrlForWidget } from "../src/lib/control/preview-grab.ts";
import { avcCFromSpsPps, createAnnexParser, dropLateUnits, pushAnnexB } from "../src/lib/control/preview-live.ts";

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

test("preview transport auto is UDP then TCP", () => {
  assert.deepEqual(previewRtspTransports({ bind: { kind: "macro" } }), ["udp", "tcp"]);
  assert.deepEqual(previewRtspTransports({ bind: { kind: "macro" }, previewTransport: "tcp" }), ["tcp"]);
  assert.deepEqual(previewRtspTransports({ bind: { kind: "macro" }, previewTransport: "udp" }), ["udp"]);
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
  assert.ok(args.includes("-c:v copy"));
  assert.ok(args.includes("-bsf:v dump_extra"));
  assert.ok(args.includes("-probesize 32768"));
  assert.ok(args.includes("-muxdelay 0"));
  assert.ok(args.includes("-flush_packets 1"));
  assert.equal(args.includes("libx264"), false);
  assert.equal(args.includes("separate_moof"), false);
  assert.equal(args.includes("reset_timestamps"), false);
  assert.equal(args.includes("-nostdin"), false);
  assert.equal(args.includes("-localaddr"), false);
  const bound = previewFfmpegArgs("rtsp://10.0.25.242:554/sub/av", "tcp", "10.0.25.10").join(" ");
  assert.ok(bound.includes("-localaddr 10.0.25.10"));
});

function annex(...nals) {
  const parts = [0, 0, 0, 1];
  for (let i = 0; i < nals.length; i++) {
    if (i) parts.push(0, 0, 0, 1);
    for (const byte of nals[i]) parts.push(byte);
  }
  return new Uint8Array(parts);
}

test("live ffmpeg args stay a copy, in Annex-B", () => {
  const args = previewLiveFfmpegArgs("rtsp://10.0.25.242:554/sub/av", "udp").join(" ");
  assert.ok(args.includes("-c:v copy"));
  assert.ok(args.includes("-f h264"));
  assert.ok(args.includes("-bsf:v dump_extra"));
  assert.equal(args.includes("libx264"), false);
  assert.equal(args.includes("frag_keyframe"), false);
  assert.equal(args.includes("-f mp4"), false);
});

test("annex-b IDR then P yields a key unit and an avcC", () => {
  const sps = [0x67, 0x42, 0x00, 0x1e, 0x01];
  const bytes = annex(
    sps,
    [0x68, 0xee, 0x00],
    [0x65, 0x88, 0x80],
    [0x41, 0x9a, 0x00],
    [0x09, 0xf0],
    [0x09, 0xf0],
  );
  const parsed = pushAnnexB(createAnnexParser(), bytes);
  assert.equal(parsed.reject, undefined);
  assert.equal(parsed.units.length, 2);
  assert.equal(parsed.units[0].key, true);
  assert.equal(parsed.units[1].key, false);
  assert.equal(parsed.avcC[0], 1);
  assert.ok(parsed.avcC.includes(0x67));
  assert.ok(parsed.avcC.includes(0x42));
  const built = avcCFromSpsPps(new Uint8Array(sps), new Uint8Array([0x68, 0xee, 0x00]));
  assert.deepEqual(parsed.avcC, built);
});

test("annex-b rejects HEVC", () => {
  const parsed = pushAnnexB(createAnnexParser(), annex([0x40, 0x01], [0x09, 0xf0]));
  assert.equal(parsed.reject, "hevc");
  assert.equal(parsed.units.length, 0);
});

test("dropLateUnits keeps the later picture", () => {
  assert.deepEqual(dropLateUnits(["old", "new"]), ["new"]);
  assert.deepEqual(dropLateUnits([]), []);
});

test("preview route keeps fMP4 unless codec=h264, and the tile asks only with VideoDecoder", () => {
  const route = fs.readFileSync("src/routes/api/preview.ts", "utf8");
  const tile = fs.readFileSync("src/components/panel/preview-tile.tsx", "utf8");
  assert.match(route, /video\/mp4/);
  assert.match(route, /codec === "h264"/);
  assert.match(route, /video\/h264/);
  assert.match(tile, /typeof VideoDecoder/);
  assert.match(tile, /codec=h264/);
  assert.match(tile, /playStream\(/);
  assert.match(tile, /frag_keyframe|playStream/);
});
