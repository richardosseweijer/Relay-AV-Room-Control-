/**
 * Trust options for scripts/samsung-pair.mjs (manual Samsung Tizen pairing helper).
 * Fail-closed on TLS (port 8002) unless CA PEM path and/or sha256 pin is set.
 * --insecure is discover-only: print leaf fingerprint and require a re-run with --fingerprint.
 * Soft rejectUnauthorized:false is never the happy-path default.
 */
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

export const SAMSUNG_PAIR_NO_TRUST =
  "Samsung pair TLS refused: no trust material. Pass --ca=<pem> and/or --fingerprint=<sha256>, or env SAMSUNG_PAIR_CA / SAMSUNG_PAIR_FINGERPRINT. First connect: --insecure prints the leaf fingerprint (no pairing), then re-run with --fingerprint=…";

export const SAMSUNG_PAIR_BAD_TRUST =
  "Samsung pair TLS refused: CA PEM missing/unreadable/not a certificate, or sha256 fingerprint malformed (need 64 hex).";

export const SAMSUNG_PAIR_DISCOVER_HINT =
  "Discover mode (--insecure): connected once to read the leaf fingerprint. Re-run with --fingerprint=<sha256> (or --accept-fingerprint=…) to pair. Soft TLS is not used for pairing.";

/** @param {string | null | undefined} raw */
export function normalizeFingerprintSha256(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
  if (s.length !== 64) return null;
  return s;
}

/** @param {string} pem */
function looksLikeCertPem(pem) {
  return (
    pem.includes("BEGIN CERTIFICATE") &&
    !/BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY/i.test(pem)
  );
}

/**
 * @param {import('node:tls').PeerCertificate | { fingerprint256?: string } | null | undefined} cert
 */
export function fingerprintFromPeerCert(cert) {
  return normalizeFingerprintSha256(cert?.fingerprint256);
}

/**
 * Short --help for integrators.
 * @returns {string}
 */
export function samsungPairHelpText() {
  return `Usage: node scripts/samsung-pair.mjs <tv-ip> [8001|8002] [options]

Pair a Samsung Tizen TV (Allow on the set). Port 8002 = wss (TLS); 8001 = ws (no TLS).

TLS trust (required for 8002; fail-closed if missing):
  --ca=<path>                 Trusted CA / leaf PEM path
  --fingerprint=<sha256>      Pin leaf cert sha256 (colon-hex or bare)
  --accept-fingerprint=<sha256>
                              Same as --fingerprint (after --insecure)
  --insecure                  Discover only: soft-connect, print fingerprint, exit (no token)
  -h, --help                  This help

Env (same meaning as flags when flags omitted):
  SAMSUNG_PAIR_CA / RELAY_SAMSUNG_PAIR_CA
  SAMSUNG_PAIR_FINGERPRINT / RELAY_SAMSUNG_PAIR_FINGERPRINT

Example:
  node scripts/samsung-pair.mjs 10.0.25.234 8002 --insecure
  node scripts/samsung-pair.mjs 10.0.25.234 8002 --fingerprint=<printed>
`;
}

/**
 * @typedef {{
 *   help: boolean,
 *   host: string | null,
 *   port: number,
 *   caPath: string | null,
 *   fingerprint: string | null,
 *   insecure: boolean,
 *   unknown: string[],
 * }} SamsungPairArgs
 */

/**
 * Parse CLI argv (process.argv slice from index 2 is fine; also accepts full argv).
 * @param {string[]} argv
 * @returns {SamsungPairArgs}
 */
export function parseSamsungPairArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  // Drop node + script if present
  if (args[0] && /node(?:\.exe)?$/i.test(args[0])) args.shift();
  if (args[0] && /samsung-pair\.mjs$/.test(args[0])) args.shift();

  /** @type {SamsungPairArgs} */
  const out = {
    help: false,
    host: null,
    port: 8002,
    caPath: null,
    fingerprint: null,
    insecure: false,
    unknown: [],
  };

  const positionals = [];
  for (const raw of args) {
    const a = String(raw);
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a === "--insecure") {
      out.insecure = true;
      continue;
    }
    if (a.startsWith("--ca=") || a.startsWith("--ca-pem=")) {
      out.caPath = a.slice(a.indexOf("=") + 1).trim() || null;
      continue;
    }
    if (a.startsWith("--fingerprint=") || a.startsWith("--accept-fingerprint=")) {
      out.fingerprint = a.slice(a.indexOf("=") + 1).trim() || null;
      continue;
    }
    if (a.startsWith("-")) {
      out.unknown.push(a);
      continue;
    }
    positionals.push(a);
  }

  if (positionals[0]) out.host = positionals[0];
  if (positionals[1] != null && String(positionals[1]).trim() !== "") {
    const n = Number(positionals[1]);
    if (Number.isFinite(n) && n > 0) out.port = Math.floor(n);
  }
  return out;
}

/**
 * @typedef {{
 *   ok: true,
 *   mode: "plain" | "ca" | "pin" | "discover",
 *   tlsOptions: null | {
 *     rejectUnauthorized: boolean,
 *     ca?: string,
 *     checkServerIdentity?: (host: string, cert: import('node:tls').PeerCertificate) => Error | undefined,
 *   },
 *   fingerprintSha256?: string,
 *   message?: string,
 * } | {
 *   ok: false,
 *   message: string,
 *   reason: "missing" | "bad" | "unknown-flag",
 * }} SamsungPairTlsResult
 */

/**
 * Resolve TLS connect options for the pairing helper.
 * Precedence: --insecure (discover) → CA path → fingerprint pin → fail-closed on TLS.
 * @param {{
 *   secure: boolean,
 *   caPath?: string | null,
 *   fingerprint?: string | null,
 *   insecure?: boolean,
 *   env?: Record<string, string | undefined> | NodeJS.ProcessEnv,
 *   readFile?: (path: string) => string | null,
 * }} opts
 * @returns {SamsungPairTlsResult}
 */
export function resolveSamsungPairTls(opts) {
  if (!opts.secure) {
    return { ok: true, mode: "plain", tlsOptions: null };
  }

  const env = opts.env ?? {};
  const readFile =
    opts.readFile ??
    ((p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });

  if (opts.insecure) {
    return {
      ok: true,
      mode: "discover",
      tlsOptions: { rejectUnauthorized: false },
      message: SAMSUNG_PAIR_DISCOVER_HINT,
    };
  }

  const caPath =
    String(opts.caPath ?? "").trim() ||
    String(env.SAMSUNG_PAIR_CA ?? env.RELAY_SAMSUNG_PAIR_CA ?? "").trim() ||
    null;

  if (caPath) {
    const body = readFile(caPath);
    if (!body || !looksLikeCertPem(body)) {
      return { ok: false, message: SAMSUNG_PAIR_BAD_TRUST, reason: "bad" };
    }
    try {
      new X509Certificate(body);
    } catch {
      return { ok: false, message: SAMSUNG_PAIR_BAD_TRUST, reason: "bad" };
    }
    return {
      ok: true,
      mode: "ca",
      tlsOptions: { rejectUnauthorized: true, ca: body },
    };
  }

  const pinRaw =
    String(opts.fingerprint ?? "").trim() ||
    String(env.SAMSUNG_PAIR_FINGERPRINT ?? env.RELAY_SAMSUNG_PAIR_FINGERPRINT ?? "").trim() ||
    null;
  if (pinRaw) {
    const pin = normalizeFingerprintSha256(pinRaw);
    if (!pin) {
      return { ok: false, message: SAMSUNG_PAIR_BAD_TRUST, reason: "bad" };
    }
    return {
      ok: true,
      mode: "pin",
      fingerprintSha256: pin,
      // Self-signed Samsung leaves fail chain verify; pin checker is the trust.
      tlsOptions: {
        rejectUnauthorized: false,
        checkServerIdentity: (_host, cert) => {
          const got = fingerprintFromPeerCert(cert);
          if (!got || got !== pin) {
            return new Error(
              `TLS certificate pin mismatch (expected sha256 ${pin.slice(0, 12)}…, got ${got ? got.slice(0, 12) + "…" : "none"})`,
            );
          }
          return undefined;
        },
      },
    };
  }

  return { ok: false, message: SAMSUNG_PAIR_NO_TRUST, reason: "missing" };
}
