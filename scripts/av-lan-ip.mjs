/**
 * MR1 — Apply AV-LAN IPv4 via NetworkManager (nmcli) on Linux.
 * Pure helpers + injectable runners. No shell; argv allowlist only.
 * Never sets a gateway / default route on AV. Never targets outbound NIC.
 */

export const AV_LAN_IP_LINUX_ONLY =
  "AV-LAN IP apply is Linux-only (NetworkManager / nmcli). Set the address in the OS or via SSH.";

export const AV_LAN_IP_NMCLI_MISSING =
  "NetworkManager (nmcli) is not available. Install/enable NetworkManager, or set AV-LAN IP via OS/SSH.";

export const AV_LAN_IP_UNMANAGED =
  "AV-LAN interface is unmanaged by NetworkManager. Manage it in NM (or set the IP via OS/SSH).";

export const AV_LAN_IP_NO_CONNECTION =
  "No NetworkManager connection profile for the AV-LAN interface. Create one in nmtui/nmcli, or set the IP via OS/SSH.";

export const AV_LAN_IP_AV_UNSET =
  "AV-LAN NIC is not set. Pick AV-LAN under Room → Networks, Save all, then Apply.";

export const AV_LAN_IP_AV_MISSING =
  "AV-LAN NIC not found on this host. Refresh NICs or pick a listed interface.";

export const AV_LAN_IP_SUDOERS =
  "sudo nmcli was refused (missing sudoers or password required). Add NOPASSWD for /usr/bin/nmcli per LINUX.md.";

export const AV_LAN_IP_LISTEN_OVERRIDE =
  "RELAY_LISTEN_HOST is set and would keep HTTP on a different address after Apply. Clear or update RELAY_LISTEN_HOST to match the new AV IPv4, then retry.";

export const AV_LAN_IP_LISTEN_OVERRIDE_DHCP =
  "RELAY_LISTEN_HOST is set; DHCP Apply cannot guarantee the listen host will match. Clear RELAY_LISTEN_HOST (or set it after DHCP assigns an address), then retry.";

export const AV_LAN_IP_ADDRESS_ON_OTHER =
  "That IPv4 is already on another interface. Choose a free address on the AV-LAN subnet.";

export const AV_LAN_IP_VERIFY_FAILED =
  "nmcli reported success but AV-LAN did not end up with the requested IPv4 (netplan DHCP merge?). Re-check NetworkManager / netplan, or set the address via SSH.";

/** Relay-owned NM profile — avoids Ubuntu Server installer dhcp4:true merging back onto netplan-<iface>. */
export const RELAY_AV_LAN_CONNECTION_ID = "relay-av-lan";

/** @param {string} raw */
export function parseIpv4Octets(raw) {
  const s = String(raw ?? "").trim();
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    if (p.length > 1 && p.startsWith("0")) return null;
    nums.push(n);
  }
  return nums;
}

/**
 * IPv4 unicast for room AV-LAN. Rejects unspecified, loopback, multicast, broadcast, link-local.
 * @param {string} raw
 * @returns {{ ok: true, address: string } | { ok: false, message: string }}
 */
export function validateIpv4Unicast(raw) {
  const octets = parseIpv4Octets(raw);
  if (!octets) return { ok: false, message: "Enter a valid IPv4 address (e.g. 10.0.25.10)." };
  const [a, b, c, d] = octets;
  if (a === 0 && b === 0 && c === 0 && d === 0) {
    return { ok: false, message: "0.0.0.0 is not allowed." };
  }
  if (a === 127) return { ok: false, message: "Loopback addresses are not allowed on AV-LAN." };
  if (a >= 224 && a <= 239) return { ok: false, message: "Multicast addresses are not allowed." };
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    return { ok: false, message: "Broadcast address is not allowed." };
  }
  if (a === 169 && b === 254) return { ok: false, message: "Link-local addresses are not allowed on AV-LAN." };
  return { ok: true, address: `${a}.${b}.${c}.${d}` };
}

/**
 * Prefix 1–32 (rooms typically 8–30).
 * @param {unknown} raw
 * @returns {{ ok: true, prefix: number } | { ok: false, message: string }}
 */
export function validatePrefix(raw) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > 32) {
    return { ok: false, message: "Prefix must be an integer from 1 to 32 (rooms usually 8–30)." };
  }
  return { ok: true, prefix: n };
}

/**
 * @param {string} [platform]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function platformGate(platform = process.platform) {
  if (platform !== "linux") return { ok: false, message: AV_LAN_IP_LINUX_ONLY };
  return { ok: true };
}

/**
 * Refuse when an *explicit* RELAY_LISTEN_HOST override conflicts with the address
 * we are about to apply. Boot wrappers must not stamp the resolved AV IPv4 into
 * process.env — only a real systemd/lab override should reach this check.
 * @param {string | null | undefined} envListenHost
 * @param {"static" | "dhcp"} mode
 * @param {string | null | undefined} newAddress
 */
export function listenHostConflict(envListenHost, mode, newAddress) {
  const override = String(envListenHost ?? "").trim();
  if (!override) return { ok: true };
  if (mode === "dhcp") return { ok: false, message: AV_LAN_IP_LISTEN_OVERRIDE_DHCP };
  const addr = String(newAddress ?? "").trim();
  if (override === addr) return { ok: true };
  return { ok: false, message: AV_LAN_IP_LISTEN_OVERRIDE };
}

/**
 * @param {{ name?: string | null, index?: number | null }} pick
 * @param {Array<{ name: string, index: number, ipv4?: string | null }>} nics
 * @param {(nics: any[], pick: any) => any | null} resolveNic
 */
export function resolveAvTarget(pick, nics, resolveNic) {
  const name = String(pick?.name ?? "").trim();
  const indexSet = pick?.index != null && Number.isFinite(Number(pick.index));
  if (!name && !indexSet) return { ok: false, message: AV_LAN_IP_AV_UNSET };
  const nic = resolveNic(nics, { name: name || null, index: indexSet ? Number(pick.index) : null });
  if (!nic) return { ok: false, message: AV_LAN_IP_AV_MISSING };
  return { ok: true, nic };
}

/**
 * @param {Array<{ name: string, ipv4?: string | null }>} nics
 * @param {string} address
 * @param {string} targetName
 */
export function addressOnOtherIface(nics, address, targetName) {
  const want = String(address).trim();
  return (nics || []).some((n) => n.name !== targetName && String(n.ipv4 ?? "").trim() === want);
}

/**
 * nmcli argv after `nmcli` for static modify (no sudo prefix).
 * Clears gateway; sets never-default; no DNS touch.
 * @param {string} connectionId
 * @param {string} address
 * @param {number} prefix
 */
export function buildNmcliStaticModifyArgv(connectionId, address, prefix) {
  const id = String(connectionId);
  return [
    "connection",
    "modify",
    id,
    "ipv4.method",
    "manual",
    "ipv4.addresses",
    `${address}/${prefix}`,
    "ipv4.gateway",
    "",
    "ipv4.never-default",
    "yes",
    "connection.autoconnect",
    "yes",
  ];
}

/**
 * @param {string} connectionId
 */
export function buildNmcliDhcpModifyArgv(connectionId) {
  const id = String(connectionId);
  return [
    "connection",
    "modify",
    id,
    "ipv4.method",
    "auto",
    "ipv4.addresses",
    "",
    "ipv4.gateway",
    "",
    "ipv4.never-default",
    "yes",
    "connection.autoconnect",
    "yes",
  ];
}

/** @param {string} connectionId */
export function buildNmcliConnectionUpArgv(connectionId) {
  return ["connection", "up", String(connectionId)];
}

/** @param {string} connectionId */
export function buildNmcliConnectionDownArgv(connectionId) {
  return ["connection", "down", String(connectionId)];
}

/** @param {string} connectionId */
export function buildNmcliAutoconnectNoArgv(connectionId) {
  return ["connection", "modify", String(connectionId), "connection.autoconnect", "no"];
}

/** List NAME:DEVICE rows (tabular). */
export function buildNmcliConnectionListArgv() {
  return ["-t", "-f", "NAME,DEVICE", "connection", "show"];
}

/** @param {string} connectionId */
export function buildNmcliConnectionExistsArgv(connectionId) {
  return ["-t", "-f", "NAME", "connection", "show", String(connectionId)];
}

/**
 * Create Relay-owned ethernet profile (separate netplan NM-* key — does not merge
 * with installer `ethernets.<iface>.dhcp4: true`).
 * @param {string} device
 * @param {string} [connectionId]
 */
export function buildNmcliConnectionAddAvArgv(device, connectionId = RELAY_AV_LAN_CONNECTION_ID) {
  return [
    "connection",
    "add",
    "type",
    "ethernet",
    "con-name",
    String(connectionId),
    "ifname",
    String(device),
    "connection.autoconnect",
    "yes",
    "connection.autoconnect-priority",
    "100",
    "ipv4.method",
    "disabled",
    "ipv6.method",
    "ignore",
  ];
}

/** @param {string} connectionId */
export function buildNmcliConnectionIpv4ShowArgv(connectionId) {
  return ["-g", "ipv4.method,ipv4.addresses,ipv4.never-default", "connection", "show", String(connectionId)];
}

/** @param {string} device */
export function buildNmcliDeviceIpShowArgv(device) {
  return ["-g", "GENERAL.CONNECTION,GENERAL.STATE,IP4.ADDRESS", "device", "show", String(device)];
}

/** @param {string} device */
export function buildNmcliDeviceShowArgv(device) {
  return ["-t", "-f", "GENERAL.CONNECTION,GENERAL.STATE,GENERAL.NM-MANAGED", "device", "show", String(device)];
}

/** Probe: nmcli present */
export function buildNmcliNetworkingArgv() {
  return ["-t", "networking"];
}

/**
 * Confirm dialog copy — lockout + new URL + no default route + restart.
 * @param {{
 *   mode: "static" | "dhcp",
 *   iface: string,
 *   address?: string | null,
 *   prefix?: number | null,
 *   port?: number | null,
 * }} opts
 */
export function avLanIpConfirmMessage(opts) {
  const iface = String(opts.iface || "AV-LAN").trim() || "AV-LAN";
  const port = Number(opts.port) > 0 ? Number(opts.port) : 8081;
  if (opts.mode === "dhcp") {
    return (
      `Switch AV-LAN on ${iface} to DHCP?` +
      ` This PC’s panel URL will change to whatever address DHCP assigns (port ${port}).` +
      ` Your browser is on the current address — the page will drop after apply; reopen from the new URL (or SSH).` +
      ` AV-LAN will not get a default route. Venue / LAN (internet) is untouched.` +
      ` Relay will restart to re-bind HTTP to the new IPv4.` +
      ` If ufw allows a fixed AV CIDR and DHCP moves you off that network, update ufw.`
    );
  }
  const address = String(opts.address || "").trim();
  const prefix = Number(opts.prefix);
  const cidr = address && Number.isFinite(prefix) ? `${address}/${prefix}` : "the new static address";
  const url = address ? `http://${address}:${port}/` : `http://<new-ip>:${port}/`;
  return (
    `Change AV-LAN address on ${iface} to ${cidr}?` +
    ` This PC’s panel URL will become ${url}. Your browser is on the current address — the page will drop after apply; reopen from the new URL (or SSH).` +
    ` AV-LAN will not get a default route. Venue / LAN (internet) is untouched.` +
    ` Relay will restart to re-bind HTTP to the new IPv4.` +
    ` If you change prefix/network, update ufw to the new AV CIDR.`
  );
}

/**
 * @param {{ mode: "static" | "dhcp", address?: string | null, prefix?: number | null, port?: number | null }} opts
 */
export function avLanIpSuccessHint(opts) {
  const port = Number(opts.port) > 0 ? Number(opts.port) : 8081;
  if (opts.mode === "dhcp") {
    return `AV-LAN switched to DHCP. Relay is restarting — reconnect at http://<dhcp-ip>:${port}/ (check the NIC live IP after reboot/SSH).`;
  }
  const address = String(opts.address || "").trim();
  return `AV-LAN set to ${address}/${opts.prefix}. Relay is restarting — reconnect at http://${address}:${port}/`;
}

/**
 * Parse nmcli -t device show multiline GENERAL.* fields.
 * @param {string} stdout
 */
export function parseNmDeviceShow(stdout) {
  const out = { connection: "", state: "", managed: "" };
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key === "GENERAL.CONNECTION") out.connection = val;
    else if (key === "GENERAL.STATE") out.state = val;
    else if (key === "GENERAL.NM-MANAGED") out.managed = val;
  }
  return out;
}

/**
 * Parse `nmcli -g ipv4.method,ipv4.addresses,ipv4.never-default connection show` (one value per line).
 * @param {string} stdout
 */
export function parseNmConnectionIpv4(stdout) {
  // nmcli -g prints one line per field; empty values are blank lines — keep them.
  const lines = String(stdout || "").split(/\r?\n/);
  return {
    method: (lines[0] || "").trim(),
    addresses: (lines[1] || "").trim(),
    neverDefault: (lines[2] || "").trim(),
  };
}

/**
 * Parse NAME:DEVICE lines from `nmcli -t -f NAME,DEVICE connection show`.
 * @param {string} stdout
 * @param {string} device
 */
export function listConnectionNamesForDevice(stdout, device) {
  const want = String(device || "").trim();
  /** @type {string[]} */
  const names = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.lastIndexOf(":");
    if (i < 0) continue;
    const name = line.slice(0, i);
    const dev = line.slice(i + 1).trim();
    if (dev === want && name) names.push(name);
  }
  return names;
}

/**
 * After up: static must be method=manual with address; dhcp must be method=auto.
 * @param {{
 *   mode: "static" | "dhcp",
 *   address?: string | null,
 *   prefix?: number | null,
 *   connection: { method: string, addresses: string, neverDefault: string },
 *   deviceAddresses?: string | null,
 * }} opts
 */
export function verifyAvLanApplied(opts) {
  const method = String(opts.connection?.method || "").trim().toLowerCase();
  const addrs = String(opts.connection?.addresses || "");
  const never = String(opts.connection?.neverDefault || "").trim().toLowerCase();
  if (never !== "yes" && never !== "true") {
    return { ok: false, message: AV_LAN_IP_VERIFY_FAILED };
  }
  if (opts.mode === "static") {
    const want = String(opts.address || "").trim();
    if (method !== "manual" || !want) {
      return { ok: false, message: AV_LAN_IP_VERIFY_FAILED };
    }
    const live = String(opts.deviceAddresses || "");
    if (!addrs.includes(want) && !live.includes(want)) {
      return { ok: false, message: AV_LAN_IP_VERIFY_FAILED };
    }
    return { ok: true };
  }
  if (method !== "auto") {
    return { ok: false, message: AV_LAN_IP_VERIFY_FAILED };
  }
  return { ok: true };
}

/**
 * @param {{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }} result
 */
export function classifyNmcliFailure(result) {
  const err = result?.error;
  const errCode = err && typeof err === "object" && "code" in err ? String(/** @type {{ code?: unknown }} */ (err).code ?? "") : "";
  if (err && (errCode === "ENOENT" || /ENOENT/i.test(String(err.message || "")))) {
    return { kind: "missing", message: AV_LAN_IP_NMCLI_MISSING };
  }
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}\n${err?.message || ""}`.toLowerCase();
  if (
    result?.code === 1 &&
    (/a password is required|sudo: a password is required|not allowed to execute|no password was provided|sorry, user .+ is not allowed/i.test(text) ||
      text.includes("sudoers"))
  ) {
    return { kind: "sudo", message: AV_LAN_IP_SUDOERS };
  }
  if (/not managed|unmanaged/i.test(text)) {
    return { kind: "unmanaged", message: AV_LAN_IP_UNMANAGED };
  }
  const detail = String(result?.stderr || result?.stdout || err?.message || "nmcli failed")
    .trim()
    .slice(0, 240);
  return { kind: "apply", message: detail ? `nmcli apply failed: ${detail}` : "nmcli apply failed." };
}

/**
 * Run one allowlisted nmcli invocation via injected runner.
 * Runner signature: (argv: string[], opts?: { sudo?: boolean }) => Promise<{ code, stdout, stderr, error? }>
 * When sudo:true, runner should spawn `sudo -n nmcli …argv`.
 *
 * Uses a Relay-owned profile (`relay-av-lan`) so Ubuntu Server netplan does not
 * re-merge installer `dhcp4: true` onto the active connection (which left
 * ipv4.method=auto + stale addresses and an UP NIC with no usable IPv4).
 *
 * @param {{
 *   mode: "static" | "dhcp",
 *   device: string,
 *   address?: string,
 *   prefix?: number,
 *   runNmcli: (argv: string[], opts?: { sudo?: boolean }) => Promise<{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }>,
 * }} opts
 */
export async function applyAvLanIpViaNmcli(opts) {
  const device = String(opts.device || "").trim();
  if (!device) return { ok: false, message: AV_LAN_IP_AV_MISSING };

  const probe = await opts.runNmcli(buildNmcliNetworkingArgv(), { sudo: false });
  if (probe.error || probe.code !== 0) {
    const c = classifyNmcliFailure(probe);
    if (c.kind === "missing" || probe.error) return { ok: false, message: AV_LAN_IP_NMCLI_MISSING };
    // networking may return non-zero in odd states; still try device show
  }

  const show = await opts.runNmcli(buildNmcliDeviceShowArgv(device), { sudo: false });
  const showErrCode =
    show.error && typeof show.error === "object" && "code" in show.error
      ? String(/** @type {{ code?: unknown }} */ (show.error).code ?? "")
      : "";
  if (show.error && (showErrCode === "ENOENT" || /ENOENT/i.test(String(show.error.message || "")))) {
    return { ok: false, message: AV_LAN_IP_NMCLI_MISSING };
  }
  if (show.code !== 0) {
    const c = classifyNmcliFailure(show);
    return { ok: false, message: c.message };
  }
  const parsed = parseNmDeviceShow(show.stdout || "");
  const managed = String(parsed.managed || "").toLowerCase();
  if (managed === "no" || managed === "false") {
    return { ok: false, message: AV_LAN_IP_UNMANAGED };
  }

  const connectionId = RELAY_AV_LAN_CONNECTION_ID;

  // Ensure Relay-owned profile exists (do not modify netplan-<iface> in place).
  const exists = await opts.runNmcli(buildNmcliConnectionExistsArgv(connectionId), { sudo: false });
  if (exists.code !== 0) {
    const add = await opts.runNmcli(buildNmcliConnectionAddAvArgv(device, connectionId), { sudo: true });
    if (add.code !== 0 || add.error) {
      return { ok: false, message: classifyNmcliFailure(add).message };
    }
  }

  /** @type {string[]} */
  let modifyArgv;
  if (opts.mode === "dhcp") {
    modifyArgv = buildNmcliDhcpModifyArgv(connectionId);
  } else {
    const addr = String(opts.address ?? "").trim();
    const pref = Number(opts.prefix);
    if (!addr || !Number.isInteger(pref)) {
      return { ok: false, message: "Static Apply needs address and prefix." };
    }
    modifyArgv = buildNmcliStaticModifyArgv(connectionId, addr, pref);
  }

  // Safety: never allow gateway value other than clear; never-default must be present
  if (modifyArgv.includes("ipv4.gateway")) {
    const gi = modifyArgv.indexOf("ipv4.gateway");
    if (modifyArgv[gi + 1] !== "") {
      return { ok: false, message: "Internal error: gateway must be cleared on AV-LAN." };
    }
  }
  if (!modifyArgv.includes("ipv4.never-default")) {
    return { ok: false, message: "Internal error: never-default required on AV-LAN." };
  }

  // Raise priority so we win autoconnect vs leftover netplan-<iface> profiles.
  const prio = await opts.runNmcli(
    ["connection", "modify", connectionId, "connection.autoconnect-priority", "100", "connection.interface-name", device],
    { sudo: true },
  );
  if (prio.code !== 0 || prio.error) {
    return { ok: false, message: classifyNmcliFailure(prio).message };
  }

  const mod = await opts.runNmcli(modifyArgv, { sudo: true });
  if (mod.code !== 0 || mod.error) {
    return { ok: false, message: classifyNmcliFailure(mod).message };
  }

  // Best-effort: stop other profiles on this NIC from stealing it after reboot.
  const list = await opts.runNmcli(buildNmcliConnectionListArgv(), { sudo: false });
  if (list.code === 0) {
    for (const name of listConnectionNamesForDevice(list.stdout || "", device)) {
      if (name === connectionId) continue;
      await opts.runNmcli(buildNmcliAutoconnectNoArgv(name), { sudo: true });
      await opts.runNmcli(buildNmcliConnectionDownArgv(name), { sudo: true });
    }
  }

  const up = await opts.runNmcli(buildNmcliConnectionUpArgv(connectionId), { sudo: true });
  if (up.code !== 0 || up.error) {
    return { ok: false, message: classifyNmcliFailure(up).message };
  }

  const ipv4Show = await opts.runNmcli(buildNmcliConnectionIpv4ShowArgv(connectionId), { sudo: false });
  if (ipv4Show.code !== 0 || ipv4Show.error) {
    return { ok: false, message: classifyNmcliFailure(ipv4Show).message };
  }
  const connIpv4 = parseNmConnectionIpv4(ipv4Show.stdout || "");
  const devIp = await opts.runNmcli(buildNmcliDeviceIpShowArgv(device), { sudo: false });
  const deviceAddresses = devIp.code === 0 ? String(devIp.stdout || "") : "";

  const verified = verifyAvLanApplied({
    mode: opts.mode,
    address: opts.mode === "static" ? opts.address : null,
    prefix: opts.mode === "static" ? opts.prefix : null,
    connection: connIpv4,
    deviceAddresses,
  });
  if (!verified.ok) {
    return { ok: false, message: verified.message };
  }

  return {
    ok: true,
    connectionId,
    device,
    mode: opts.mode,
    address: opts.mode === "static" ? opts.address : "",
    prefix: opts.mode === "static" ? opts.prefix : opts.prefix ?? 24,
  };
}

/**
 * Default Node runner: spawn nmcli or sudo -n nmcli (no shell).
 * @param {typeof import("node:child_process").spawn} [spawnImpl]
 */
export function createNmcliRunner(spawnImpl) {
  /**
   * @param {string[]} argv
   * @param {{ sudo?: boolean }} [opts]
   */
  return async function runNmcli(argv, opts = {}) {
    const { spawn } = spawnImpl
      ? { spawn: spawnImpl }
      : await import("node:child_process");
    const sudo = Boolean(opts && opts.sudo);
    const cmd = sudo ? "sudo" : "nmcli";
    const args = sudo ? ["-n", "nmcli", ...argv] : argv;
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve({ code: null, stdout, stderr, error: new Error("nmcli timeout") });
      }, 20_000);
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr, error });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, error: null });
      });
    });
  };
}
