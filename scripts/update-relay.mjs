#!/usr/bin/env node
/**
 * git pull --ff-only && npm ci && npm run build, then bounce Relay.
 * Build writes dist.next. On failure the running dist/ is left alone.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logFile = path.join(root, "data", "relay-update.log");
const dist = path.join(root, "dist");
const next = path.join(root, "dist.next");
const prev = path.join(root, "dist.prev");

function log(line) {
  try {
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

function run(cmd, args) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.stdout) log(r.stdout.trimEnd());
  if (r.stderr) log(r.stderr.trimEnd());
  if (r.status !== 0) {
    log(`exit ${r.status} — leaving dist/ in place`);
    process.exit(r.status || 1);
  }
}

if (!fs.existsSync(path.join(root, ".git"))) {
  log("not a git checkout");
  process.exit(2);
}

const tag = process.env.RELAY_RELEASE || "";
if (tag) run("git", ["fetch", "--tags"]);
if (tag) run("git", ["checkout", "--force", `tags/${tag}`]);
else run("git", ["pull", "--ff-only"]);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci"]);
run(process.execPath, ["scripts/with-app-env.mjs", "vite", "build", "--outDir", "dist.next"]);

try {
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(dist)) fs.renameSync(dist, prev);
  fs.renameSync(next, dist);
  fs.rmSync(prev, { recursive: true, force: true });
  log("dist/ replaced from dist.next");
} catch (err) {
  log(`dist swap failed: ${err instanceof Error ? err.message : err}`);
  if (!fs.existsSync(dist) && fs.existsSync(prev)) fs.renameSync(prev, dist);
  process.exit(1);
}

if (process.env.INVOCATION_ID && process.platform !== "win32") {
  const main = Number(process.env.MAINPID || process.env.RELAY_PID || "");
  log(main ? `signal ${main} for systemd Restart=always` : "no MAINPID — exit 1 so systemd restarts if this is the unit");
  if (main) {
    try { process.kill(main, "SIGTERM"); } catch (err) { log(String(err)); }
  }
  process.exit(0);
}

const port = process.env.PORT || "8081";
const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
const cmd = fs.existsSync(viteJs) ? process.execPath : process.platform === "win32" ? "npx.cmd" : "npx";
const args = fs.existsSync(viteJs)
  ? [viteJs, "preview", "--host", "0.0.0.0", "--port", String(port)]
  : ["vite", "preview", "--host", "0.0.0.0", "--port", String(port)];
log(`spawn ${cmd} ${args.join(" ")}`);
spawn(cmd, args, {
  cwd: root,
  detached: true,
  stdio: "ignore",
  shell: !fs.existsSync(viteJs),
  env: { ...process.env, CHOKIDAR_USEPOLLING: "1" },
}).unref();
process.exit(0);
