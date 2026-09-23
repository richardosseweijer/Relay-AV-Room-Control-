export {
  DEFAULT_PRODUCTION_CONTROL_PORT,
  AV_UNSET_CONTROL_URL_REASON,
  avNoIpv4ControlUrlReason,
  controlBaseUrlFrom,
  resolveControlBaseUrl,
  normalizePeerIp,
  isListenHostPeer,
} from "../../../scripts/control-base-url.mjs";

export type ControlBaseUrlResult =
  | { ok: true; url: string; host: string; warning?: string }
  | { ok: false; reason: string };
