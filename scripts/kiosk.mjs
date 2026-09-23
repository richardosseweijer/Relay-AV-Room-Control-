/**
 * Local HDMI panel kiosk — restart relay-kiosk.service with fixed argv only.
 * Same privilege style as Foyer / AV-LAN nmcli: try systemctl, then sudo -n systemctl.
 * Missing sudoers → clear operator error pointing at LINUX.md (not raw polkit text).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const KIOSK_UNIT = "relay-kiosk.service";

export const KIOSK_LINUX_ONLY =
  "Panel HDMI kiosk is Linux-only (cage / systemd). Windows lab: use a browser on the AV panel URL.";

export const KIOSK_UNIT_MISSING =
  "relay-kiosk.service is not installed or could not be restarted. See LINUX.md §7 (local panel display).";

export const KIOSK_SUDOERS =
  "sudo systemctl was refused (missing sudoers, password required, or polkit interactive auth). Install deploy/sudoers.relay-kiosk as /etc/sudoers.d/relay-kiosk (replace USER; visudo -cf; root:root mode 0440) per LINUX.md §7.";

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
 * Detect missing sudoers / polkit interactive auth vs unit-not-installed.
 * @param {string[]} errors
 */
export function classifyKioskRestartFailure(errors) {
  const text = (errors || []).filter(Boolean).join("\n").toLowerCase();
  if (!text.trim()) return { kind: "missing", message: KIOSK_UNIT_MISSING };
  if (
    /a password is required|sudo: a password is required|not allowed to execute|no password was provided|sorry, user .+ is not allowed|interactive authentication|authentication is required|access denied|polkit|sudoers/i.test(
      text,
    )
  ) {
    return { kind: "sudo", message: KIOSK_SUDOERS };
  }
  if (/not found|could not be found|unit .+ not loaded|failed to (find|get) unit/i.test(text)) {
    return { kind: "missing", message: KIOSK_UNIT_MISSING };
  }
  const detail = String(errors.filter(Boolean)[0] || "")
    .trim()
    .slice(0, 280);
  return { kind: "restart", message: detail || KIOSK_UNIT_MISSING };
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
  const classified = classifyKioskRestartFailure(errors);
  return {
    ok: false,
    reason: classified.kind === "sudo" ? "sudoers" : "kiosk-unit",
    detail: classified.message,
  };
}
