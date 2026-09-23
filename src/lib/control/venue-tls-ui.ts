/** C2/C3 — re-export pure venue TLS UI helpers for the Networks panel. */
export {
  venueTlsGenerateGate,
  venueTlsSanMismatch,
  venueTlsStatusLines,
  venueTlsCaInstallHintList,
  venueTlsLeafDaysLeft,
  venueTlsExpiryWarn,
  venueTlsLifecycleFlags,
  venueTlsRegenerateConfirmMessage,
  VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE,
  VENUE_TLS_GENERATE_DISABLED_NO_IP,
  VENUE_TLS_MISMATCH_PROMPT,
  VENUE_TLS_EXPIRY_WARN_DAYS,
  VENUE_TLS_EXPIRY_PROMPT,
  VENUE_TLS_EXPIRED_PROMPT,
  VENUE_TLS_CA_INSTALL_HINTS,
} from "../../../scripts/venue-tls-ui.mjs";
