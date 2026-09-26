#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 *
 * `dev`, `build` and `preview` all route through this wrapper, so the dev
 * server, the built bundle and the preview server can never disagree about
 * `VITE_AUTH_ENABLED` — a divergence that only shows up as a built-output
 * mismatch long after the fact. Anything that starts Vite directly bypasses it.
 *
 * Only `VITE_`-prefixed keys are honored: the file is a build flag carrier, not
 * a secret store, and only `VITE_` vars reach the browser anyway. A real
 * `process.env` entry always wins, so an explicit override still works.
 *
 * That precedence also means the file governs this workspace only. A deployed
 * build runs with the provider's project env, where the deployer sets
 * `VITE_AUTH_ENABLED` itself (today unconditionally `"true"`), so the deployed
 * flag is the platform's, not this file's.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootResolveHttpListenHost } from "./http-listen-host.mjs";

export const APP_ENV_REL_PATH = ".grok/app-env.json";

const VITE_PREFIX = "VITE_";

/**
 * Parse an app-env document, keeping only `VITE_`-prefixed string entries.
 * Anything unparseable is an empty environment — a workspace without the file
 * must behave exactly like today (auth on, no overrides).
 */
export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

/** The app env recorded under `root`, or `{}` when the file is absent. */
export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

/** File values under the process environment: an explicit override wins. */
export function mergeAppEnv(appEnv, processEnv) {
  return { ...appEnv, ...processEnv };
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/** Whether argv looks like a Vite listen command (dev / preview). */
function isViteListenCommand(command, args) {
  const all = [command, ...args].map(String);
  if (all.includes("dev") || all.includes("preview")) return true;
  // `vite` binary with subcommand in args
  return /vite/.test(command) && (args.includes("dev") || args.includes("preview"));
}

/**
 * Ensure --host matches resolved AV listen host. Drops a prior --host / value pair.
 * @param {string[]} args
 * @param {string} host
 */
function withListenHostArg(args, host) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host") {
      i += 1; // skip value
      continue;
    }
    if (String(args[i]).startsWith("--host=")) continue;
    out.push(args[i]);
  }
  out.push("--host", host);
  return out;
}

/**
 * Resolve listen host; when the chosen AV NIC has no IPv4 yet (common on first
 * cable/DHCP), wait and retry instead of exiting unbound forever. Never widen to 0.0.0.0.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 */
export async function resolveListenHostForBoot(root, env, opts = {}) {
  const attempts = opts.attempts ?? 15;
  const delayMs = opts.delayMs ?? 2000;
  let last = bootResolveHttpListenHost(root, env);
  for (let i = 0; i < attempts; i++) {
    last = bootResolveHttpListenHost(root, env);
    if (last.ok) return last;
    const reason = String(last.reason ?? "");
    if (!/no IPv4/i.test(reason)) return last;
    console.warn(`[with-app-env] ${reason} (retry ${i + 1}/${attempts})`);
    await delay(delayMs);
  }
  return last;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  const root = projectRoot();
  const env = mergeAppEnv(readAppEnv(root), process.env);
  const bin = join(root, "node_modules", ".bin");
  env.PATH = `${bin}${env.Path ? ";" : ":"}${env.PATH || env.Path || ""}`;
  env.Path = env.PATH;

  // Explicit RELAY_LISTEN_HOST (systemd/lab) is the escape hatch. Never stamp the
  // resolved AV-LAN IPv4 into the child env — Apply treats process.env.RELAY_LISTEN_HOST
  // as a sticky override and would refuse every AV IP change.
  const explicitListenHost = String(process.env.RELAY_LISTEN_HOST ?? "").trim();
  let spawnArgs = args;
  if (isViteListenCommand(command, args)) {
    const listen = await resolveListenHostForBoot(root, env);
    if (!listen.ok) {
      console.error(`[with-app-env] ${listen.reason}`);
      process.exit(1);
    }
    if (listen.warning) console.warn(`[with-app-env] ${listen.warning}`);
    if (explicitListenHost) env.RELAY_LISTEN_HOST = listen.host;
    else delete env.RELAY_LISTEN_HOST;
    spawnArgs = withListenHostArg(args, listen.host);
    console.info(`[with-app-env] HTTP listen host ${listen.host}`);
  }

  const child = spawn(command, spawnArgs, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
    cwd: root,
  });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${command}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[with-app-env]", err?.message || err);
    process.exit(1);
  });
}
