#!/usr/bin/env node
/**
 * git fetch + ff-only onto origin/main, npm ci --include=dev, npm run build.
 * Snapshot .vercel before the build. Restore it if ci/build fail so systemd
 * can keep serving the last good tree. Only signal restart after a good build.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logFile = path.join(root, "data", "relay-update.log");
const vercel = path.join(root, ".vercel");
const prev = `${vercel}.prev`;

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
  return r.status === 0;
}

function snapshotOutput() {
  try { fs.rmSync(prev, { recursive: true, force: true }); } catch { /* ignore */ }
  if (!fs.existsSync(vercel)) return;
  fs.cpSync(vercel, prev, { recursive: true });
  log("saved .vercel.prev");
}

function restoreOutput() {
  if (!fs.existsSync(prev)) {
    log("no .vercel.prev to restore");
    return;
  }
  try { fs.rmSync(vercel, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.renameSync(prev, vercel);
  log("restored last good .vercel");
}

if (!fs.existsSync(path.join(root, ".git"))) {
  log("not a git checkout");
  process.exit(2);
}

const tag = process.env.RELAY_RELEASE || "";
if (tag) {
  if (!run("git", ["fetch", "--tags", "origin"]) || !run("git", ["checkout", "--force", `tags/${tag}`])) process.exit(1);
} else if (!run("git", ["fetch", "origin"]) || !run("git", ["pull", "--ff-only", "origin", "main"])) {
  process.exit(1);
}

snapshotOutput();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (!run(npm, ["ci", "--include=dev"])) {
  restoreOutput();
  process.exit(1);
}
if (!run(npm, ["run", "build"])) {
  restoreOutput();
  process.exit(1);
}
if (!fs.existsSync(path.join(vercel, "output")) && !fs.existsSync(path.join(root, "dist"))) {
  log("build produced neither .vercel/output nor dist/");
  restoreOutput();
  process.exit(1);
}
try { fs.rmSync(prev, { recursive: true, force: true }); } catch { /* ignore */ }
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
