/**
 * Local HDMI panel kiosk — restart relay-kiosk.service with fixed argv only.
 * Same privilege style as Foyer (systemctl, then sudo -n systemctl).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const KIOSK_UNIT = "relay-kiosk.service";

export const KIOSK_LINUX_ONLY =
  "Panel HDMI kiosk is Linux-only (cage / systemd). Windows lab: use a browser on the AV panel URL.";

export const KIOSK_UNIT_MISSING =
  "relay-kiosk.service is not installed or could not be restarted. See LINUX.md § Panel on local HDMI.";

/** @param {string} [platform] */
export function platformGate(platform = process.platform) {
  if (platform === "linux") return { ok: true };
  return { ok: false, message: KIOSK_LINUX_ONLY };
}

export function systemctlBin() {
  if (existsSync("/usr/bin/systemctl")) return "/usr/bin/systemctl";
  if (existsSync("/bin/systemctl")) return "/bin/systemctl";
  return "systemctl";
}

export function sudoBin() {
  if (existsSync("/usr/bin/sudo")) return "/usr/bin/sudo";
  if (existsSync("/bin/sudo")) return "/bin/sudo";
  return "sudo";
}

/** Fixed argv only — never interpolates room fields. */
export function kioskRestartCommands() {
  const systemctl = systemctlBin();
  return [
    { bin: systemctl, args: ["restart", KIOSK_UNIT] },
    { bin: sudoBin(), args: ["-n", systemctl, "restart", KIOSK_UNIT] },
  ];
}

/**
 * @param {{ spawnSync?: typeof spawnSync, platform?: string }} [opts]
 */
export function enableLocalOutput(opts = {}) {
  const plat = platformGate(opts.platform ?? process.platform);
  if (!plat.ok) return { ok: false, reason: "platform", detail: plat.message };

  const run = opts.spawnSync ?? spawnSync;
  const attempts = kioskRestartCommands();
  /** @type {string[]} */
  const errors = [];
  for (const step of attempts) {
    const result = run(step.bin, step.args, { encoding: "utf8", timeout: 20_000 });
    if (result.status === 0) return { ok: true, via: step.bin };
    const err = (result.stderr || result.stdout || result.error?.message || "failed").trim();
    errors.push(err);
  }
  return {
    ok: false,
    reason: "kiosk-unit",
    detail: errors.filter(Boolean)[0] ?? KIOSK_UNIT_MISSING,
  };
}
