import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEDIA_MAX_BYTES,
  deleteMedia,
  mediaAbsPath,
  mediaIdOk,
  mediaMimeForId,
  mediaPublicUrl,
  readMedia,
  sniffMediaMime,
  validateMediaUpload,
  writeMedia,
} from "../src/lib/control/media-store.ts";

/** Minimal PNG (1x1). */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** Minimal JPEG (SOI + APP0-ish stub that still sniffs as JPEG). */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** Minimal WebP RIFF header (not a full decodeable file; sniff only). */
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const SVG_AS_XML = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test("sniffMediaMime: png/jpeg/webp", () => {
  assert.equal(sniffMediaMime(PNG), "image/png");
  assert.equal(sniffMediaMime(JPEG), "image/jpeg");
  assert.equal(sniffMediaMime(WEBP), "image/webp");
  assert.equal(sniffMediaMime(SVG_AS_XML), null);
  assert.equal(sniffMediaMime(new Uint8Array([1, 2, 3])), null);
});

test("validateMediaUpload: allowlist + size + SVG deny", () => {
  assert.equal(validateMediaUpload(PNG, "image/png").ok, true);
  assert.equal(validateMediaUpload(JPEG, "image/jpeg").ok, true);
  assert.equal(validateMediaUpload(WEBP, "image/webp").ok, true);

  const svg = validateMediaUpload(SVG_AS_XML, "image/svg+xml");
  assert.equal(svg.ok, false);
  assert.match(svg.message, /SVG denied/i);

  const mismatch = validateMediaUpload(PNG, "image/jpeg");
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /does not match/i);

  const tooBig = validateMediaUpload(new Uint8Array(MEDIA_MAX_BYTES + 1), "image/png");
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.message, /Too large/i);

  const badMime = validateMediaUpload(PNG, "application/octet-stream");
  assert.equal(badMime.ok, false);
});

test("mediaIdOk / mediaAbsPath / traversal", () => {
  assert.equal(mediaIdOk("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"), true);
  assert.equal(mediaIdOk("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"), true);
  assert.equal(mediaIdOk("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp"), true);
  assert.equal(mediaIdOk("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg"), false);
  assert.equal(mediaIdOk("../etc/passwd"), false);
  assert.equal(mediaIdOk("aa.png"), false);
  assert.equal(mediaMimeForId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"), "image/png");
  assert.equal(mediaPublicUrl("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"), "/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");

  const root = mkdtempSync(join(tmpdir(), "media-path-"));
  assert.equal(mediaAbsPath("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", root), join(root, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"));
  assert.equal(mediaAbsPath("../nope.png", root), null);
  assert.equal(mediaAbsPath("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg", root), null);
});

test("writeMedia / readMedia / deleteMedia round trip", async () => {
  const root = mkdtempSync(join(tmpdir(), "media-store-"));
  const written = await writeMedia(PNG, "image/png", root);
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.match(written.media.id, /^[a-f0-9]{32}\.png$/);
  assert.equal(written.media.url, `/api/media/${written.media.id}`);
  assert.equal(written.media.mime, "image/png");
  assert.ok(existsSync(written.media.path));
  assert.deepEqual(Uint8Array.from(readFileSync(written.media.path)), PNG);

  const read = await readMedia(written.media.id, root);
  assert.ok(read);
  assert.equal(read.mime, "image/png");
  assert.equal(read.bytes.length, PNG.length);

  assert.equal(await deleteMedia(written.media.id, root), true);
  assert.equal(await readMedia(written.media.id, root), null);
  assert.equal(await deleteMedia(written.media.id, root), false);
});

test("writeMedia rejects SVG bytes even with png Content-Type claim", async () => {
  const root = mkdtempSync(join(tmpdir(), "media-svg-"));
  const result = await writeMedia(SVG_AS_XML, "image/png", root);
  assert.equal(result.ok, false);
});
