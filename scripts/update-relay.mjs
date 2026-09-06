#!/usr/bin/env node
/**
 * git pull + npm install, then start Relay again.
 * Spawned detached from the running server so the old process can exit.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "8081";
const logFile = path.join(root, "data", "relay-update.log");

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
    log(`exit ${r.status}`);
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
const ci = spawnSync(npm, ["ci"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", env: process.env });
if (ci.stdout) log(ci.stdout.trimEnd());
if (ci.stderr) log(ci.stderr.trimEnd());
if (ci.status !== 0) {
  log("npm ci failed, falling back to npm install");
  run(npm, ["install"]);
}

if (process.env.INVOCATION_ID && process.platform !== "win32") {
  log("restarting systemd unit relay");
  spawn("systemctl", ["restart", "relay"], { detached: true, stdio: "ignore" }).unref();
  process.exit(0);
}

const preview = process.env.npm_lifecycle_event === "start" || process.argv.includes("preview") || process.env.NODE_ENV === "production";
const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
const cmd = fs.existsSync(viteJs) ? process.execPath : process.platform === "win32" ? "npx.cmd" : "npx";
const args = fs.existsSync(viteJs)
  ? [viteJs, preview ? "preview" : "dev", "--host", "0.0.0.0", "--port", String(port)]
  : ["vite", preview ? "preview" : "dev", "--host", "0.0.0.0", "--port", String(port)];
log(`spawn ${cmd} ${args.join(" ")}`);
spawn(cmd, args, {
  cwd: root,
  detached: true,
  stdio: "ignore",
  shell: !fs.existsSync(viteJs),
  env: { ...process.env, CHOKIDAR_USEPOLLING: "1" },
}).unref();
process.exit(0);
