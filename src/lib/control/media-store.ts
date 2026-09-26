/**
 * Host media store for Image widget uploads (MR2).
 * Files live under data/media/; served at /api/media/<id>.
 *
 * SVG: denied. image/svg+xml can carry script if ever mis-served or embedded
 * as document/object; PNG/JPEG/WebP cannot. Prefer deny unless a later MR
 * adds a safe sanitizer + Content-Disposition attachment path.
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/** Max upload size (~2 MB). */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;

export const MEDIA_ALLOWED_MIME = Object.freeze(["image/png", "image/jpeg", "image/webp"] as const);
export type MediaMime = (typeof MEDIA_ALLOWED_MIME)[number];

const MIME_EXT: Record<MediaMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const EXT_MIME: Record<string, MediaMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Id shape: 32 hex chars + allowlisted extension (safeDriverName style). */
export const MEDIA_ID_RE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

export function isAllowedMediaMime(mime: string): mime is MediaMime {
  return (MEDIA_ALLOWED_MIME as readonly string[]).includes(mime);
}

export function mediaExtForMime(mime: string): string | null {
  if (!isAllowedMediaMime(mime)) return null;
  return MIME_EXT[mime];
}

export function mediaMimeForId(id: string): MediaMime | null {
  const ext = id.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

export function mediaIdOk(id: string): boolean {
  return MEDIA_ID_RE.test(id);
}

function randomMediaId(ext: string): string {
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex}.${ext}`;
}

/** Magic-byte sniff so Content-Type alone cannot smuggle SVG/HTML. */
export function sniffMediaMime(bytes: Uint8Array): MediaMime | null {
  if (bytes.length < 12) return null;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type MediaValidateOk = { ok: true; mime: MediaMime };
export type MediaValidateErr = { ok: false; message: string };
export type MediaValidateResult = MediaValidateOk | MediaValidateErr;

/**
 * Size + mime allowlist + magic-byte match.
 * Declared mime must be allowlisted; sniff must agree (or declared omitted → sniff only).
 */
export function validateMediaUpload(bytes: Uint8Array, declaredMime?: string | null): MediaValidateResult {
  if (!bytes.length) return { ok: false, message: "Empty body" };
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, message: `Too large (max ${MEDIA_MAX_BYTES} bytes)` };

  const sniffed = sniffMediaMime(bytes);
  if (!sniffed) return { ok: false, message: "Unsupported image (png/jpeg/webp only; SVG denied)" };

  if (declaredMime) {
    const normalized = declaredMime.split(";")[0]?.trim().toLowerCase() || "";
    if (normalized === "image/svg+xml" || normalized === "image/svg") {
      return { ok: false, message: "SVG denied (XSS risk if served inline)" };
    }
    if (!isAllowedMediaMime(normalized)) {
      return { ok: false, message: "MIME not allowed (image/png, image/jpeg, image/webp)" };
    }
    if (normalized !== sniffed) {
      return { ok: false, message: "MIME does not match file contents" };
    }
  }

  return { ok: true, mime: sniffed };
}

/** Absolute path under MEDIA_DIR, or null if id escapes / is invalid. */
export function mediaAbsPath(id: string, rootDir = MEDIA_DIR): string | null {
  if (!mediaIdOk(id)) return null;
  const abs = path.resolve(rootDir, id);
  const root = path.resolve(rootDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export function mediaPublicUrl(id: string): string {
  return `/api/media/${id}`;
}

export type MediaWriteResult = {
  id: string;
  url: string;
  mime: MediaMime;
  bytes: number;
  path: string;
};

export async function writeMedia(
  bytes: Uint8Array,
  declaredMime?: string | null,
  rootDir = MEDIA_DIR,
): Promise<{ ok: true; media: MediaWriteResult } | MediaValidateErr> {
  const checked = validateMediaUpload(bytes, declaredMime);
  if (!checked.ok) return checked;
  const ext = MIME_EXT[checked.mime];
  const id = randomMediaId(ext);
  await mkdir(rootDir, { recursive: true });
  const dest = path.join(rootDir, id);
  await writeFile(dest, bytes);
  return {
    ok: true,
    media: {
      id,
      url: mediaPublicUrl(id),
      mime: checked.mime,
      bytes: bytes.length,
      path: dest,
    },
  };
}

export async function readMedia(
  id: string,
  rootDir = MEDIA_DIR,
): Promise<{ id: string; mime: MediaMime; bytes: Buffer; path: string } | null> {
  const abs = mediaAbsPath(id, rootDir);
  const mime = mediaMimeForId(id);
  if (!abs || !mime) return null;
  try {
    const bytes = await readFile(abs);
    return { id, mime, bytes, path: abs };
  } catch {
    return null;
  }
}

export async function deleteMedia(id: string, rootDir = MEDIA_DIR): Promise<boolean> {
  const abs = mediaAbsPath(id, rootDir);
  if (!abs) return false;
  try {
    await unlink(abs);
    return true;
  } catch {
    return false;
  }
}

/** Bearer token from Authorization header (preview/room pattern). */
export function bearerToken(request: Request): string {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}
