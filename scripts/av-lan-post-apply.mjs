/**
 * Post-success hooks after Apply AV-LAN IPv4 (Linux).
 * Soft-fail only: IP apply / persist / restart stay primary.
 * - ufw: allow TCP 8081 from new AV CIDR; remove prior Relay-AV-LAN rules.
 * - co-hosted Foyer: rewrite relayUrl / foyer-kiosk.env when safe; best-effort restart.
 * Never opens 8081 to Anywhere / 0.0.0.0/0. Windows: callers skip (Apply is Linux-only).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseIpv4Octets, validateIpv4Unicast, validatePrefix, parseFirstIpv4Cidr } from "./av-lan-ip.mjs";

export { parseFirstIpv4Cidr };

/** @param {unknown} e */
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

export const UFW_RULE_COMMENT = "Relay-AV-LAN";
export const AV_LAN_UFW_SUDOERS =
  "sudo ufw was refused (missing sudoers or password required). Install deploy/sudoers.relay-ufw via scripts/install-host-sudoers.sh — see LINUX.md §5b. AV-LAN IP was applied; update ufw manually if needed.";
export const AV_LAN_UFW_ANYWHERE =
  "Refusing to open 8081 from Anywhere / 0.0.0.0/0. Use a specific AV CIDR.";
export const AV_LAN_UFW_MISSING =
  "ufw is not available on PATH. AV-LAN IP was applied; install ufw or update firewall manually.";

/**
 * Network CIDR from host address + prefix (e.g. 10.0.10.5/24 → 10.0.10.0/24).
 * @param {string} address
 * @param {number} prefix
 * @returns {string | null}
 */
export function computeCidr(address, prefix) {
  const octets = parseIpv4Octets(address);
  const pref = validatePrefix(prefix);
  if (!octets || !pref.ok) return null;
  const bits = pref.prefix;
  const ipNum =
    (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const net = (ipNum & mask) >>> 0;
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${bits}`;
}


/** @param {string} cidr */
export function isAnywhereCidr(cidr) {
  const s = String(cidr || "").trim().toLowerCase();
  return (
    s === "anywhere" ||
    s === "any" ||
    s === "0.0.0.0/0" ||
    s === "::/0" ||
    s === "0.0.0.0" ||
    s === "*"
  );
}

/**
 * Validate CIDR for ufw allow (network form preferred; host/32 ok).
 * @param {string} cidr
 * @returns {{ ok: true, cidr: string } | { ok: false, message: string }}
 */
export function validateAvCidrForUfw(cidr) {
  const raw = String(cidr || "").trim();
  if (!raw) return { ok: false, message: "AV CIDR is empty." };
  if (isAnywhereCidr(raw)) return { ok: false, message: AV_LAN_UFW_ANYWHERE };
  const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  const octets = parseIpv4Octets(m[1]);
  const pref = validatePrefix(m[2]);
  if (!octets || !pref.ok) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  const [a, b] = octets;
  if (a === 127) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  if (a >= 224) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  if (a === 169 && b === 254) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  if (octets.every((n) => n === 0) && pref.prefix === 0) {
    return { ok: false, message: AV_LAN_UFW_ANYWHERE };
  }
  const normalized = computeCidr(`${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`, pref.prefix);
  if (!normalized) return { ok: false, message: `Invalid AV CIDR: ${raw}` };
  if (isAnywhereCidr(normalized)) return { ok: false, message: AV_LAN_UFW_ANYWHERE };
  return { ok: true, cidr: normalized };
}

/** nmcli argv builders (no sudo prefix). */
export function buildUfwStatusArgv() {
  return ["status"];
}

export function buildUfwStatusNumberedArgv() {
  return ["status", "numbered"];
}

/** @param {string} cidr */
export function buildUfwAllow8081Argv(cidr) {
  return [
    "allow",
    "from",
    String(cidr),
    "to",
    "any",
    "port",
    "8081",
    "proto",
    "tcp",
    "comment",
    UFW_RULE_COMMENT,
  ];
}

/** @param {string} cidr */
export function buildUfwDelete8081Argv(cidr) {
  return [
    "delete",
    "allow",
    "from",
    String(cidr),
    "to",
    "any",
    "port",
    "8081",
    "proto",
    "tcp",
    "comment",
    UFW_RULE_COMMENT,
  ];
}

export function buildUfwReloadArgv() {
  return ["reload"];
}

/**
 * Parse `ufw status` / `status numbered` for Relay-managed 8081 rules.
 * Matches comment Relay-AV-LAN and/or "8081/tcp … ALLOW IN <cidr>".
 * @param {string} stdout
 * @returns {string[]} unique CIDRs
 */
export function parseRelayUfw8081Cidrs(stdout) {
  /** @type {string[]} */
  const found = [];
  const seen = new Set();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^Status:/i.test(t) || /^To\s+Action/i.test(t) || /^--/.test(t)) continue;
    const hasComment = new RegExp(`#\\s*${UFW_RULE_COMMENT}\\b`, "i").test(t) || t.includes(UFW_RULE_COMMENT);
    const port8081 = /\b8081(?:\/tcp)?\b/i.test(t);
    if (!port8081) continue;
    // Prefer comment-tagged rules; also accept untagged 8081 ALLOW from CIDR when caller is cleaning Relay rules
    // — but only delete comment-tagged to avoid wiping unrelated rules.
    if (!hasComment) continue;
    const m =
      t.match(/\bfrom\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\b/i) ||
      t.match(/\b(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\b/) ||
      t.match(/\bALLOW\s+IN\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\b/i);
    if (!m) continue;
    const cidr = m[1];
    if (seen.has(cidr)) continue;
    seen.add(cidr);
    found.push(cidr);
  }
  return found;
}

/**
 * @param {{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }} result
 */
export function classifyUfwFailure(result) {
  const err = result?.error;
  const errCode = err && typeof err === "object" && "code" in err ? String(/** @type {{ code?: unknown }} */ (err).code ?? "") : "";
  if (err && (errCode === "ENOENT" || /ENOENT/i.test(String(err.message || "")))) {
    return { kind: "missing", message: AV_LAN_UFW_MISSING };
  }
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}\n${err?.message || ""}`.toLowerCase();
  if (
    /a password is required|sudo: a password is required|not allowed to execute|no password was provided|sorry, user .+ is not allowed/i.test(
      text,
    ) ||
    text.includes("sudoers")
  ) {
    return { kind: "sudo", message: AV_LAN_UFW_SUDOERS };
  }
  const detail = String(result?.stderr || result?.stdout || err?.message || "ufw failed")
    .trim()
    .slice(0, 240);
  return { kind: "ufw", message: detail ? `ufw update failed: ${detail}` : "ufw update failed." };
}

/**
 * Idempotent: ensure one Relay-AV-LAN allow for newCidr; remove other Relay-tagged 8081 rules.
 * Runner: (argv, { sudo?: boolean }) => Promise<{ code, stdout, stderr, error? }>
 * When sudo:true, spawn `sudo -n ufw …argv`.
 *
 * @param {{
 *   newCidr: string,
 *   runUfw: (argv: string[], opts?: { sudo?: boolean }) => Promise<{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }>,
 * }} opts
 */
export async function syncUfwAvLan8081(opts) {
  const validated = validateAvCidrForUfw(opts.newCidr);
  if (!validated.ok) return { ok: false, message: validated.message, warnings: /** @type {string[]} */ ([]) };

  const status = await opts.runUfw(buildUfwStatusNumberedArgv(), { sudo: true });
  if (status.error || (status.code !== 0 && status.code !== null)) {
    // fallback to plain status
    const st2 = await opts.runUfw(buildUfwStatusArgv(), { sudo: true });
    if (st2.error || st2.code !== 0) {
      return { ok: false, message: classifyUfwFailure(status.error ? status : st2).message, warnings: [] };
    }
    return syncUfwFromStatus(st2.stdout || "", validated.cidr, opts.runUfw);
  }
  return syncUfwFromStatus(status.stdout || "", validated.cidr, opts.runUfw);
}

/**
 * @param {string} statusOut
 * @param {string} newCidr
 * @param {(argv: string[], opts?: { sudo?: boolean }) => Promise<{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }>} runUfw
 */
async function syncUfwFromStatus(statusOut, newCidr, runUfw) {
  /** @type {string[]} */
  const warnings = [];
  const existing = parseRelayUfw8081Cidrs(statusOut);
  const already = existing.includes(newCidr);

  for (const old of existing) {
    if (old === newCidr) continue;
    if (isAnywhereCidr(old)) {
      warnings.push(`Skipped deleting unexpected Anywhere-like rule ${old}`);
      continue;
    }
    const del = await runUfw(buildUfwDelete8081Argv(old), { sudo: true });
    if (del.code !== 0 || del.error) {
      warnings.push(`Could not remove old ufw rule for ${old}: ${classifyUfwFailure(del).message}`);
    }
  }

  if (!already) {
    const add = await runUfw(buildUfwAllow8081Argv(newCidr), { sudo: true });
    if (add.code !== 0 || add.error) {
      return { ok: false, message: classifyUfwFailure(add).message, warnings };
    }
  }

  const reload = await runUfw(buildUfwReloadArgv(), { sudo: true });
  if (reload.code !== 0 || reload.error) {
    warnings.push(`ufw reload soft-failed: ${classifyUfwFailure(reload).message}`);
  }

  return {
    ok: true,
    cidr: newCidr,
    added: !already,
    removed: existing.filter((c) => c !== newCidr),
    warnings,
    message: already
      ? `ufw already allows 8081 from ${newCidr} (Relay-AV-LAN).`
      : `ufw allows 8081 from ${newCidr} (Relay-AV-LAN).`,
  };
}

/**
 * Default Node runner: spawn ufw or sudo -n ufw (no shell).
 * @param {typeof import("node:child_process").spawn} [spawnImpl]
 */
export function createUfwRunner(spawnImpl) {
  /**
   * @param {string[]} argv
   * @param {{ sudo?: boolean }} [opts]
   */
  return async function runUfw(argv, opts = {}) {
    const { spawn } = spawnImpl
      ? { spawn: spawnImpl }
      : await import("node:child_process");
    const sudo = Boolean(opts && opts.sudo);
    const cmd = sudo ? "sudo" : "ufw";
    const args = sudo ? ["-n", "ufw", ...argv] : argv;
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
        resolve({ code: null, stdout, stderr, error: new Error("ufw timeout") });
      }, 15_000);
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

// ——— Co-hosted Foyer ———

/**
 * @param {string} raw
 */
export function isLoopbackRelayHost(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    const h = u.hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Hostname of an http(s) URL, or "" .
 * @param {string} raw
 */
export function relayUrlHostname(raw) {
  try {
    return new URL(String(raw || "").trim()).hostname;
  } catch {
    return "";
  }
}

/**
 * Rewrite only when empty, loopback, or previous AV IP.
 * Never clobber a deliberate remote Relay URL on another host.
 * @param {string | null | undefined} current
 * @param {string | null | undefined} previousAvIp
 * @param {string} newAvIp
 */
export function shouldRewriteFoyerRelayUrl(current, previousAvIp, newAvIp) {
  const cur = String(current ?? "").trim();
  const next = String(newAvIp || "").trim();
  if (!next) return false;
  if (!cur) return true;
  if (isLoopbackRelayHost(cur)) return true;
  const host = relayUrlHostname(cur);
  if (!host) return false;
  const prev = String(previousAvIp ?? "").trim();
  if (prev && host === prev) return true;
  if (host === next) return false; // already correct — no rewrite needed (caller may still skip write)
  return false;
}

/**
 * @param {string} newAvIp
 * @param {number} [port]
 */
export function buildFoyerRelayUrl(newAvIp, port = 8081) {
  const ip = String(newAvIp || "").trim();
  const p = Number(port) > 0 ? Number(port) : 8081;
  return `http://${ip}:${p}`;
}

/**
 * Candidate Foyer checkouts (dirs that may contain data/foyer-site.json).
 * @param {string} relayRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function discoverFoyerRoots(relayRoot, env = process.env) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} p */
  const push = (p) => {
    const abs = resolve(String(p || ""));
    if (abs && !out.includes(abs)) out.push(abs);
  };
  if (env.FOYER_ROOT) push(env.FOYER_ROOT);
  if (env.FOYER_CHECKOUT) push(env.FOYER_CHECKOUT);
  // Sibling of Relay checkout (common appliance layout).
  push(join(relayRoot, "..", "Foyer-Room-Signage"));
  // Same parent home layouts
  push(join(relayRoot, "..", "foyer-room-signage"));
  return out;
}

/**
 * @param {string} root
 */
export function foyerDataPaths(root) {
  const dir = join(root, "data");
  return {
    root,
    dir,
    sitePath: join(dir, "foyer-site.json"),
    kioskEnvPath: join(dir, "foyer-kiosk.env"),
  };
}

/**
 * First discovered Foyer root that has foyer-site.json (or FOYER_ROOT forced).
 * @param {string} relayRoot
 * @param {NodeJS.ProcessEnv} [env]
 */
export function findCoHostedFoyer(relayRoot, env = process.env) {
  for (const root of discoverFoyerRoots(relayRoot, env)) {
    const paths = foyerDataPaths(root);
    if (existsSync(paths.sitePath)) return paths;
    // Explicit FOYER_ROOT even without site yet — still a candidate for create? Prefer exist.
    if ((env.FOYER_ROOT || env.FOYER_CHECKOUT) && resolve(root) === resolve(String(env.FOYER_ROOT || env.FOYER_CHECKOUT))) {
      if (existsSync(paths.dir) || existsSync(join(root, "package.json"))) return paths;
    }
  }
  return null;
}

/**
 * Patch FOYER_ROOM_PANEL_URL in foyer-kiosk.env body; preserve other lines.
 * @param {string} body
 * @param {string} relayUrl
 */
export function patchFoyerKioskEnvBody(body, relayUrl) {
  const url = String(relayUrl || "").trim();
  const lines = String(body || "").split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (/^\s*FOYER_ROOM_PANEL_URL=/.test(line)) {
      found = true;
      return `FOYER_ROOM_PANEL_URL=${url}`;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] === "") {
      next[next.length - 1] = `FOYER_ROOM_PANEL_URL=${url}`;
      next.push("");
    } else {
      next.push(`FOYER_ROOM_PANEL_URL=${url}`);
    }
  }
  let out = next.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

/**
 * @param {string} target
 * @param {string} body
 */
export function writeAtomicUtf8(target, body) {
  mkdirSync(dirname(target), { recursive: true });
  const staged = `${target}.tmp`;
  const fd = openSync(staged, "w");
  try {
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(staged, target);
}

/**
 * @param {{
 *   foyer: { sitePath: string, kioskEnvPath: string, root: string, dir: string },
 *   newAvIp: string,
 *   previousAvIp?: string | null,
 *   port?: number,
 *   readFile?: (p: string) => string,
 *   writeFile?: (p: string, body: string) => void,
 *   exists?: (p: string) => boolean,
 * }} opts
 */
export function updateCoHostedFoyerRelayBind(opts) {
  const newAvIp = String(opts.newAvIp || "").trim();
  if (!newAvIp) return { ok: false, skipped: true, message: "No new AV IPv4 for Foyer rewrite." };
  const read = opts.readFile || ((p) => readFileSync(p, "utf8"));
  const write = opts.writeFile || writeAtomicUtf8;
  const exists = opts.exists || existsSync;
  const port = Number(opts.port) > 0 ? Number(opts.port) : 8081;
  const wantUrl = buildFoyerRelayUrl(newAvIp, port);

  if (!exists(opts.foyer.sitePath)) {
    return { ok: false, skipped: true, message: `Foyer site not found at ${opts.foyer.sitePath}` };
  }

  let siteRaw;
  try {
    siteRaw = read(opts.foyer.sitePath);
  } catch (e) {
    return { ok: false, skipped: false, message: `Could not read Foyer site: ${errMsg(e)}` };
  }

  /** @type {any} */
  let site;
  try {
    site = JSON.parse(siteRaw);
  } catch {
    return { ok: false, skipped: false, message: "Foyer foyer-site.json is not valid JSON." };
  }

  const current = site?.relayUrl ?? null;
  if (!shouldRewriteFoyerRelayUrl(current, opts.previousAvIp, newAvIp)) {
    const host = relayUrlHostname(String(current || ""));
    if (host === newAvIp) {
      // Already correct — still refresh kiosk env if present/stale.
    } else {
      return {
        ok: true,
        skipped: true,
        message: `Foyer relayUrl left unchanged (${current}) — not empty/loopback/previous AV.`,
        relayUrl: current,
      };
    }
  }

  const rewritten = shouldRewriteFoyerRelayUrl(current, opts.previousAvIp, newAvIp);
  if (rewritten || relayUrlHostname(String(current || "")) === newAvIp) {
    if (rewritten) {
      site.relayUrl = wantUrl;
      // Enable peer when we just pointed at this AV (matches Foyer seed heuristic spirit).
      if (site.relayEnabled == null || site.relayEnabled === false) {
        site.relayEnabled = true;
      }
      try {
        write(opts.foyer.sitePath, `${JSON.stringify(site, null, 2)}\n`);
      } catch (e) {
        return { ok: false, skipped: false, message: `Could not write Foyer site: ${errMsg(e)}` };
      }
    }
  }

  // foyer-kiosk.env — rewrite FOYER_ROOM_PANEL_URL when file exists or site was rewritten.
  let kioskUpdated = false;
  if (exists(opts.foyer.kioskEnvPath) || rewritten) {
    let body = "";
    if (exists(opts.foyer.kioskEnvPath)) {
      try {
        body = read(opts.foyer.kioskEnvPath);
      } catch {
        body = "";
      }
    }
    // Only patch URL when current env URL is empty/loopback/prev/new or missing.
    const envMatch = body.match(/^\s*FOYER_ROOM_PANEL_URL=(.*)$/m);
    const envUrl = envMatch ? String(envMatch[1] || "").trim() : "";
    const patchEnv =
      !envUrl ||
      shouldRewriteFoyerRelayUrl(envUrl, opts.previousAvIp, newAvIp) ||
      relayUrlHostname(envUrl) === newAvIp;
    if (patchEnv) {
      const nextBody = patchFoyerKioskEnvBody(body || "FOYER_VIDEO_OUTPUT=\nFOYER_ROOM_PANEL_VIDEO_OUTPUT=\n", wantUrl);
      try {
        write(opts.foyer.kioskEnvPath, nextBody);
        kioskUpdated = true;
      } catch (e) {
        return {
          ok: false,
          skipped: false,
          message: `Foyer site ok but foyer-kiosk.env write failed: ${errMsg(e)}`,
          relayUrl: wantUrl,
        };
      }
    }
  }

  return {
    ok: true,
    skipped: !rewritten && !kioskUpdated,
    rewritten,
    kioskUpdated,
    relayUrl: rewritten ? wantUrl : current,
    message: rewritten
      ? `Foyer relayUrl → ${wantUrl}${kioskUpdated ? " (foyer-kiosk.env updated)" : ""}.`
      : kioskUpdated
        ? `Foyer foyer-kiosk.env FOYER_ROOM_PANEL_URL → ${wantUrl}.`
        : `Foyer already on ${wantUrl}.`,
  };
}

/** @param {string} unit */
export function buildSystemctlTryRestartArgv(unit) {
  return ["try-restart", String(unit)];
}

/**
 * Best-effort restart foyer units (uses existing foyer-kiosk sudoers when same user).
 * @param {{
 *   runSystemctl: (argv: string[], opts?: { sudo?: boolean }) => Promise<{ code: number | null, stdout?: string, stderr?: string, error?: Error | null }>,
 *   units?: string[],
 * }} opts
 */
export async function tryRestartFoyerUnits(opts) {
  const units = opts.units || ["foyer.service", "foyer-kiosk.service"];
  /** @type {string[]} */
  const notes = [];
  let anyOk = false;
  for (const unit of units) {
    const bare = await opts.runSystemctl(buildSystemctlTryRestartArgv(unit), { sudo: false });
    if (bare.code === 0 && !bare.error) {
      anyOk = true;
      notes.push(`${unit} restarted`);
      continue;
    }
    const sudoed = await opts.runSystemctl(buildSystemctlTryRestartArgv(unit), { sudo: true });
    if (sudoed.code === 0 && !sudoed.error) {
      anyOk = true;
      notes.push(`${unit} restarted (sudo)`);
      continue;
    }
    notes.push(
      `${unit} restart soft-failed — run: sudo systemctl try-restart ${unit} (needs foyer-kiosk sudoers for this user, or restart manually)`,
    );
  }
  return { ok: anyOk, message: notes.join("; "), notes };
}

/**
 * Default systemctl runner (bare then callers may sudo).
 * @param {typeof import("node:child_process").spawn} [spawnImpl]
 */
export function createSystemctlRunner(spawnImpl) {
  /**
   * @param {string[]} argv
   * @param {{ sudo?: boolean }} [opts]
   */
  return async function runSystemctl(argv, opts = {}) {
    const { spawn } = spawnImpl
      ? { spawn: spawnImpl }
      : await import("node:child_process");
    const sudo = Boolean(opts && opts.sudo);
    const cmd = sudo ? "sudo" : "systemctl";
    const args = sudo ? ["-n", "systemctl", ...argv] : argv;
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
        resolve({ code: null, stdout, stderr, error: new Error("systemctl timeout") });
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

/**
 * Run soft-fail post-apply hooks. Never throws.
 * @param {{
 *   newAddress: string,
 *   newPrefix: number,
 *   previousAddress?: string | null,
 *   port?: number,
 *   relayRoot: string,
 *   runUfw?: (argv: string[], opts?: { sudo?: boolean }) => Promise<any>,
 *   runSystemctl?: (argv: string[], opts?: { sudo?: boolean }) => Promise<any>,
 *   env?: NodeJS.ProcessEnv,
 * }} opts
 * @returns {Promise<{ notes: string[], ufwOk: boolean | null, foyerOk: boolean | null }>}
 */
export async function runAvLanPostApplyHooks(opts) {
  /** @type {string[]} */
  const notes = [];
  let ufwOk = /** @type {boolean | null} */ (null);
  let foyerOk = /** @type {boolean | null} */ (null);

  const cidr = computeCidr(opts.newAddress, opts.newPrefix);
  if (!cidr) {
    notes.push("ufw skipped: could not derive AV CIDR from applied address/prefix.");
  } else {
    try {
      const runUfw = opts.runUfw || createUfwRunner();
      const ufw = await syncUfwAvLan8081({ newCidr: cidr, runUfw });
      ufwOk = ufw.ok;
      if (ufw.ok) {
        notes.push(ufw.message || `ufw updated for ${cidr}`);
        for (const w of ufw.warnings || []) notes.push(w);
      } else {
        notes.push(`ufw soft-fail: ${ufw.message}`);
      }
    } catch (e) {
      ufwOk = false;
      notes.push(`ufw soft-fail: ${errMsg(e)}`);
    }
  }

  try {
    const foyer = findCoHostedFoyer(opts.relayRoot, opts.env || process.env);
    if (!foyer) {
      foyerOk = null;
      // silent skip when Foyer not co-hosted
    } else {
      const updated = updateCoHostedFoyerRelayBind({
        foyer,
        newAvIp: opts.newAddress,
        previousAvIp: opts.previousAddress,
        port: opts.port,
      });
      if (updated.skipped && updated.ok) {
        foyerOk = true;
        if (updated.message) notes.push(updated.message);
      } else if (!updated.ok) {
        foyerOk = false;
        notes.push(`Foyer soft-fail: ${updated.message}`);
      } else {
        foyerOk = true;
        notes.push(updated.message || "Foyer relay bind updated.");
        const runSystemctl = opts.runSystemctl || createSystemctlRunner();
        const restart = await tryRestartFoyerUnits({ runSystemctl });
        notes.push(restart.message);
      }
    }
  } catch (e) {
    foyerOk = false;
    notes.push(`Foyer soft-fail: ${errMsg(e)}`);
  }

  return { notes, ufwOk, foyerOk };
}
