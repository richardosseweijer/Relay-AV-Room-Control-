/**
 * C2/C3 — pure UI/status helpers for venue TLS Networks panel.
 * No I/O; safe to unit-test. Never touches private keys.
 * C3 adds regenerate confirm copy, expiry days-left / warn, lifecycle banners.
 */

export const VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE =
  "Outbound NIC is None — pick a venue/internet NIC with an IPv4 first.";

export const VENUE_TLS_GENERATE_DISABLED_NO_IP =
  "LAN (internet) has no live IPv4 — Generate needs an address for the certificate SAN.";

export const VENUE_TLS_MISMATCH_PROMPT =
  "Live NIC2 IPv4 is not in the venue certificate SAN. Confirm Regenerate to issue a leaf for the current address (tablets must re-trust if the CA changes).";

/** Days before leaf notAfter when Networks should warn (integrator-light). */
export const VENUE_TLS_EXPIRY_WARN_DAYS = 30;

export const VENUE_TLS_EXPIRY_PROMPT =
  "Venue leaf certificate is nearing expiry. Confirm Regenerate to re-issue for the current live NIC2 IPv4 (venue HTTPS reloads; AV HTTP untouched).";

export const VENUE_TLS_EXPIRED_PROMPT =
  "Venue leaf certificate has expired. Confirm Regenerate to re-issue for the current live NIC2 IPv4 (venue HTTPS reloads; AV HTTP untouched).";

/**
 * Confirm dialog when replacing an existing CA/leaf — never wipe trust casually.
 * @param {{ liveIpv4?: string | null, mismatch?: boolean, expiryWarn?: boolean, expired?: boolean }} [opts]
 */
export function venueTlsRegenerateConfirmMessage(opts = {}) {
  const ip = String(opts.liveIpv4 ?? "").trim();
  const ipBit = ip ? ` for ${ip}` : " for the current live NIC2 IPv4";
  const why = opts.expired
    ? " The current leaf is expired."
    : opts.expiryWarn
      ? " The current leaf is nearing expiry."
      : opts.mismatch
        ? " The live NIC2 IPv4 is not in the current SAN."
        : "";
  return (
    `Replace the venue CA and leaf certificate${ipBit}?` +
    why +
    " Tablets that trusted the old CA may need to re-install Download CA." +
    " Venue HTTPS reloads only — AV HTTP stays up."
  );
}

/** Short OS install hints next to Download CA (integrator-light, not a novel). */
export const VENUE_TLS_CA_INSTALL_HINTS = Object.freeze({
  ios: "iOS: Settings → General → VPN & Device Management → Install the downloaded profile/cert → enable Full Trust for the CA under Certificate Trust Settings.",
  android: "Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate → pick the PEM.",
  windows: "Windows: double-click the PEM (or certmgr.msc) → Trusted Root Certification Authorities → Import.",
  macos: "macOS: open the PEM in Keychain Access → System (or login) → set Trust → Always Trust for SSL.",
});

/**
 * @param {{ outboundNone: boolean, liveIpv4?: string | null }} opts
 * @returns {{ allowed: boolean, reason: string | null }}
 */
export function venueTlsGenerateGate(opts) {
  if (opts.outboundNone) {
    return { allowed: false, reason: VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE };
  }
  const ip = String(opts.liveIpv4 ?? "").trim();
  if (!ip) {
    return { allowed: false, reason: VENUE_TLS_GENERATE_DISABLED_NO_IP };
  }
  return { allowed: true, reason: null };
}

/**
 * Detect live NIC2 IPv4 not covered by leaf SAN.
 * @param {{
 *   present?: boolean,
 *   sanIp?: string | null,
 *   liveIpv4?: string | null,
 * }} opts
 * @returns {{ mismatch: boolean, message: string | null }}
 */
export function venueTlsSanMismatch(opts) {
  if (!opts.present) return { mismatch: false, message: null };
  const san = String(opts.sanIp ?? "").trim();
  const live = String(opts.liveIpv4 ?? "").trim();
  if (!san || !live) return { mismatch: false, message: null };
  if (san === live) return { mismatch: false, message: null };
  return { mismatch: true, message: VENUE_TLS_MISMATCH_PROMPT };
}

/**
 * Whole days remaining until leaf notAfter (floor). Negative when expired.
 * @param {string | null | undefined} leafNotAfter
 * @param {Date | number} [now]
 * @returns {number | null}
 */
export function venueTlsLeafDaysLeft(leafNotAfter, now = Date.now()) {
  if (!leafNotAfter) return null;
  const end = new Date(leafNotAfter).getTime();
  if (!Number.isFinite(end)) return null;
  const t = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((end - t) / 86_400_000);
}

/**
 * Expiry warn when leaf present and days-left ≤ warnDays (default 30).
 * @param {{
 *   present?: boolean,
 *   leafNotAfter?: string | null,
 *   now?: Date | number,
 *   warnDays?: number,
 * }} opts
 * @returns {{
 *   warn: boolean,
 *   expired: boolean,
 *   daysLeft: number | null,
 *   message: string | null,
 * }}
 */
export function venueTlsExpiryWarn(opts) {
  if (!opts.present) {
    return { warn: false, expired: false, daysLeft: null, message: null };
  }
  const daysLeft = venueTlsLeafDaysLeft(opts.leafNotAfter, opts.now);
  if (daysLeft == null) {
    return { warn: false, expired: false, daysLeft: null, message: null };
  }
  const limit =
    typeof opts.warnDays === "number" && Number.isFinite(opts.warnDays)
      ? opts.warnDays
      : VENUE_TLS_EXPIRY_WARN_DAYS;
  if (daysLeft < 0) {
    return {
      warn: true,
      expired: true,
      daysLeft,
      message: VENUE_TLS_EXPIRED_PROMPT,
    };
  }
  if (daysLeft <= limit) {
    return {
      warn: true,
      expired: false,
      daysLeft,
      message: VENUE_TLS_EXPIRY_PROMPT,
    };
  }
  return { warn: false, expired: false, daysLeft, message: null };
}

/**
 * Combined mismatch + expiry flags for Networks banners / auto-check on load+NIC refresh.
 * Never auto-reissues — flags only (explicit Regenerate + confirm).
 * @param {{
 *   present?: boolean,
 *   sanIp?: string | null,
 *   liveIpv4?: string | null,
 *   leafNotAfter?: string | null,
 *   now?: Date | number,
 *   warnDays?: number,
 * }} opts
 */
export function venueTlsLifecycleFlags(opts) {
  const mismatch = venueTlsSanMismatch(opts);
  const expiry = venueTlsExpiryWarn(opts);
  const needsAction = Boolean(mismatch.mismatch || expiry.warn);
  return {
    mismatch: mismatch.mismatch,
    mismatchMessage: mismatch.message,
    expiryWarn: expiry.warn,
    expired: expiry.expired,
    daysLeft: expiry.daysLeft,
    expiryMessage: expiry.message,
    needsAction,
    /** True when PEMs already on disk — UI must confirm before Generate replaces them. */
    needsConfirm: Boolean(opts.present),
  };
}

/**
 * Compact status lines for Networks UI.
 * @param {{
 *   present?: boolean,
 *   active?: boolean,
 *   sanIp?: string | null,
 *   leafNotAfter?: string | null,
 *   leafFingerprint256?: string | null,
 *   now?: Date | number,
 * }} status
 */
export function venueTlsStatusLines(status) {
  if (!status?.present) {
    return {
      activeLabel: "No",
      sanIp: "—",
      expiry: "—",
      fingerprint: "—",
      daysLeft: null,
    };
  }
  const active = status.active ?? status.present;
  const daysLeft = venueTlsLeafDaysLeft(status.leafNotAfter, status.now);
  let expiry = "—";
  if (status.leafNotAfter) {
    try {
      const date = new Date(status.leafNotAfter).toISOString().slice(0, 10);
      if (daysLeft == null) {
        expiry = date;
      } else if (daysLeft < 0) {
        expiry = `${date} (expired ${Math.abs(daysLeft)}d)`;
      } else {
        expiry = `${date} (${daysLeft}d left)`;
      }
    } catch {
      expiry = String(status.leafNotAfter);
    }
  }
  const fp = String(status.leafFingerprint256 ?? "").trim();
  const fingerprint = fp
    ? fp.length > 27
      ? `${fp.slice(0, 12)}…${fp.slice(-8)}`
      : fp
    : "—";
  return {
    activeLabel: active ? "Yes" : "Certs on disk (listener idle)",
    sanIp: String(status.sanIp ?? "").trim() || "—",
    expiry,
    fingerprint,
    daysLeft,
  };
}

/**
 * Flatten install hints for UI list.
 * @returns {{ id: string, text: string }[]}
 */
export function venueTlsCaInstallHintList() {
  return [
    { id: "ios", text: VENUE_TLS_CA_INSTALL_HINTS.ios },
    { id: "android", text: VENUE_TLS_CA_INSTALL_HINTS.android },
    { id: "windows", text: VENUE_TLS_CA_INSTALL_HINTS.windows },
    { id: "macos", text: VENUE_TLS_CA_INSTALL_HINTS.macos },
  ];
}
