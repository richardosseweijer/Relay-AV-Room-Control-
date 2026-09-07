export const PANEL_TOKEN_KEY = "relay-panel-token";

export function clearPanelToken(storage: { removeItem: (key: string) => void }) {
  storage.removeItem(PANEL_TOKEN_KEY);
}

export function applyRoomSession(storage: { removeItem: (key: string) => void }, sessionValid: boolean) {
  if (!sessionValid) clearPanelToken(storage);
}
