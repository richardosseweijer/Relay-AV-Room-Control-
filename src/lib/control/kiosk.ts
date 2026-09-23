/** Local HDMI panel kiosk restart — re-export scripts/kiosk.mjs. */
export {
  KIOSK_LINUX_ONLY,
  KIOSK_UNIT,
  KIOSK_UNIT_MISSING,
  enableLocalOutput,
  kioskRestartCommands,
  platformGate,
  sudoBin,
  systemctlBin,
} from "../../../scripts/kiosk.mjs";
