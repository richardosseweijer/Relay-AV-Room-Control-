export function actionPermitted(opts: {
  externalControl: boolean;
  tokenKind: "config" | "panel" | null;
  commandId?: string;
}) {
  const authed = opts.tokenKind === "panel" || opts.tokenKind === "config";
  if (!opts.externalControl && !authed) return false;
  if (opts.commandId && /^system\.(restart|update|reboot)$/.test(opts.commandId) && opts.tokenKind !== "config") {
    return false;
  }
  return true;
}
