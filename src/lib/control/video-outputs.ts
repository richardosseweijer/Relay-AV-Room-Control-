/** Local DRM video connectors — re-export scripts/video-outputs.mjs. */
export {
  DRM_CLASS_PATH,
  isForbiddenKioskHost,
  isPhysicalConnector,
  kioskEnvBody,
  listVideoOutputs,
  resolveVideoOutput,
  scanDrmConnectors,
} from "../../../scripts/video-outputs.mjs";

export type VideoOutputRow = {
  index: number;
  name: string;
  connected: boolean;
  label: string;
};
