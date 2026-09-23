/**
 * C1 — fixed venue TLS paths under data/tls/venue/ and secure PEM writes.
 * Keys mode 0600; CA cert readable for later C2 download. Never commit keys.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const VENUE_TLS_SUBDIR = join("data", "tls", "venue");

export const VENUE_TLS_FILENAMES = Object.freeze({
  caKey: "ca.key.pem",
  caCert: "ca.cert.pem",
  serverKey: "server.key.pem",
  serverCert: "server.cert.pem",
});

/** @param {string} rootDir @returns {string} */
export function venueTlsDir(rootDir) {
  return join(rootDir, VENUE_TLS_SUBDIR);
}

/**
 * Absolute paths for the in-box venue PEMs (B1 wires server cert+key).
 * @param {string} rootDir
 */
export function venueTlsPaths(rootDir) {
  const dir = venueTlsDir(rootDir);
  return {
    dir,
    caKeyPath: join(dir, VENUE_TLS_FILENAMES.caKey),
    caCertPath: join(dir, VENUE_TLS_FILENAMES.caCert),
    serverKeyPath: join(dir, VENUE_TLS_FILENAMES.serverKey),
    serverCertPath: join(dir, VENUE_TLS_FILENAMES.serverCert),
  };
}

/** @param {string} path @param {number} mode */
export function chmodSecure(path, mode) {
  chmodSync(path, mode);
}

/**
 * Atomic-ish write: write .tmp, fsync, rename, chmod.
 * @param {string} target
 * @param {string} body
 * @param {number} mode
 */
export function writePemFile(target, body, mode) {
  mkdirSync(dirname(target), { recursive: true });
  const staged = `${target}.tmp`;
  const fd = openSync(staged, "w", mode);
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(staged, target);
  } catch (err) {
    try {
      unlinkSync(staged);
    } catch {
      /* ignore */
    }
    throw err;
  }
  chmodSecure(target, mode);
}

/**
 * Persist generated material. Keys 0600; certs 0644 (CA readable for C2 download).
 * @param {string} rootDir
 * @param {{ caCertPem: string, caKeyPem: string, leafCertPem: string, leafKeyPem: string }} material
 */
export function writeVenueTlsPems(rootDir, material) {
  const paths = venueTlsPaths(rootDir);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  try {
    chmodSecure(paths.dir, 0o700);
  } catch {
    /* best-effort */
  }
  writePemFile(paths.caKeyPath, material.caKeyPem, 0o600);
  writePemFile(paths.caCertPath, material.caCertPem, 0o644);
  writePemFile(paths.serverKeyPath, material.leafKeyPem, 0o600);
  writePemFile(paths.serverCertPath, material.leafCertPem, 0o644);
  return paths;
}

/** @param {string} path @returns {number | null} */
export function fileModeBits(path) {
  if (!existsSync(path)) return null;
  return statSync(path).mode & 0o777;
}

/** @param {string} rootDir @returns {boolean} */
export function venueTlsPemsPresent(rootDir) {
  const p = venueTlsPaths(rootDir);
  return (
    existsSync(p.caCertPath) &&
    existsSync(p.caKeyPath) &&
    existsSync(p.serverCertPath) &&
    existsSync(p.serverKeyPath)
  );
}

/** @param {string} path @returns {string | null} */
export function readPemIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
