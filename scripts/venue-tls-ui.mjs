/**
 * C2 — pure UI/status helpers for venue TLS Networks panel.
 * No I/O; safe to unit-test. Never touches private keys.
 */

export const VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE =
  "Outbound NIC is None — pick a venue/internet NIC with an IPv4 first.";

export const VENUE_TLS_GENERATE_DISABLED_NO_IP =
  "LAN (internet) has no live IPv4 — Generate needs an address for the certificate SAN.";

export const VENUE_TLS_MISMATCH_PROMPT =
  "Live NIC2 IPv4 is not in the venue certificate SAN. Generate again to issue a leaf for the current address.";

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
 * Compact status lines for Networks UI.
 * @param {{
 *   present?: boolean,
 *   active?: boolean,
 *   sanIp?: string | null,
 *   leafNotAfter?: string | null,
 *   leafFingerprint256?: string | null,
 * }} status
 */
export function venueTlsStatusLines(status) {
  if (!status?.present) {
    return {
      activeLabel: "No",
      sanIp: "—",
      expiry: "—",
      fingerprint: "—",
    };
  }
  const active = status.active ?? status.present;
  let expiry = "—";
  if (status.leafNotAfter) {
    try {
      expiry = new Date(status.leafNotAfter).toISOString().slice(0, 10);
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
