/** Barrel façade — existing UI imports from `@/lib/control/actions` keep working (MR2). */

export {
  verifyConfigPin,
  verifyPanelPin,
  revokeSession,
  revokeAllSessions,
} from "./actions-auth";

export {
  getEditorConfig,
  saveConfig,
  saveDriver,
  addDriverFromLibrary,
  deleteDriver,
  clearConfig,
  importBundle,
} from "./actions-config";

export {
  setVariable,
  fireCommand,
  setLatch,
  fireMacro,
  authenticate,
  pullInventory,
  pingDevice,
  clearDeviceError,
} from "./actions-runtime";

export {
  restartHost,
  updateHost,
  rebootHost,
  listHostPorts,
  listLanNics,
  debugScan,
  debugSend,
  wipeLog,
} from "./actions-host";

export {
  getVenueTlsStatus,
  generateVenueTls,
} from "./actions-venue-tls";
