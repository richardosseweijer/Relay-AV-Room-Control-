#!/usr/bin/env node
/**
 * git fetch + ff-only onto origin/main, npm ci --include=dev, npm run build.
 * Nitro writes .vercel/output (not dist/). Leave a running tree in place if
 * pull or build fails. systemd Restart=always bounces the process on exit.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logFile = path.join(root, "data", "relay-update.log");
const vercel = path.join(root, ".vercel");

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
    log(`exit ${r.status} — leaving the running tree in place`);
    process.exit(r.status || 1);
  }
}

if (!fs.existsSync(path.join(root, ".git"))) {
  log("not a git checkout");
  process.exit(2);
}

try { fs.rmSync(vercel, { recursive: true, force: true }); } catch { /* ignore */ }

const tag = process.env.RELAY_RELEASE || "";
if (tag) {
  run("git", ["fetch", "--tags", "origin"]);
  run("git", ["checkout", "--force", `tags/${tag}`]);
} else {
  run("git", ["fetch", "origin"]);
  run("git", ["pull", "--ff-only", "origin", "main"]);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci", "--include=dev"]);
run(npm, ["run", "build"]);

if (!fs.existsSync(path.join(vercel, "output")) && !fs.existsSync(path.join(root, "dist"))) {
  log("build produced neither .vercel/output nor dist/");
  process.exit(1);
}
log("build ok");

if (process.env.INVOCATION_ID && process.platform !== "win32") {
  const main = Number(process.env.MAINPID || process.env.RELAY_PID || "");
  log(main ? `signal ${main} for systemd Restart=always` : "exit so systemd restarts");
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
