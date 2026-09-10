#!/usr/bin/env node
/** Build an update in an isolated worktree, then switch the verified release. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parent = path.dirname(root);
const stem = path.basename(root).replace(/[^a-zA-Z0-9._-]/g, "-");
const stage = path.join(parent, `.${stem}.relay-update-${process.pid}`);
const rollback = path.join(parent, `.${stem}.relay-rollback-${process.pid}`);
const logFile = path.join(root, "data", "relay-update.log");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function log(line) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must not decide update success */ }
}

function run(cmd, args, cwd = root) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32", env: process.env });
  if (result.stdout) log(result.stdout.trimEnd());
  if (result.stderr) log(result.stderr.trimEnd());
  return result.status === 0;
}

function gitText(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function removeTree(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* cleanup only */ }
}

function copyIfPresent(source, target) {
  if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
}

function restore(oldHead) {
  log(`rolling back to ${oldHead}`);
  run("git", ["reset", "--hard", oldHead]);
  for (const name of [".vercel", "node_modules"]) {
    const saved = path.join(rollback, name);
    if (!fs.existsSync(saved)) continue;
    removeTree(path.join(root, name));
    fs.renameSync(saved, path.join(root, name));
  }
}

function cleanup() {
  run("git", ["worktree", "remove", "--force", stage]);
  removeTree(stage);
  removeTree(rollback);
}

async function verifyStagedBuild() {
  const port = String(process.env.RELAY_UPDATE_CHECK_PORT || "18081");
  const viteJs = path.join(stage, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteJs)) return false;
  const child = spawn(process.execPath, [viteJs, "preview", "--host", "127.0.0.1", "--port", port], {
    cwd: stage,
    stdio: "ignore",
    env: process.env,
  });
  let ready = false;
  const deadline = Date.now() + Number(process.env.RELAY_UPDATE_READY_MS || 120_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const response = await fetch(`http://127.0.0.1:${port}/api/room`, {
        signal: AbortSignal.timeout(Math.min(2000, remaining)),
      });
      ready = response.ok;
      if (ready) break;
    } catch { /* cold starts can refuse connections until Vite is ready */ }
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (child.exitCode === null) child.kill("SIGTERM");
  return ready;
}

function startPreview(port) {
  const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteJs)) return null;
  const child = spawn(process.execPath, [viteJs, "preview", "--host", "0.0.0.0", "--port", port], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CHOKIDAR_USEPOLLING: "1" },
  });
  child.unref();
  return child;
}

async function waitForPreview(port, child) {
  const deadline = Date.now() + Number(process.env.RELAY_UPDATE_READY_MS || 120_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const response = await fetch(`http://127.0.0.1:${port}/api/room`, {
        signal: AbortSignal.timeout(Math.min(2000, remaining)),
      });
      if (response.ok) return true;
    } catch { /* keep polling until deadline */ }
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (!fs.existsSync(path.join(root, ".git"))) {
  log("not a git checkout");
  process.exit(2);
}
if (!run("git", ["diff", "--quiet"]) || !run("git", ["diff", "--cached", "--quiet"])) {
  log("tracked edits present; refusing update");
  process.exit(1);
}

const tag = process.env.RELAY_RELEASE || "";
if (!run("git", tag ? ["fetch", "--tags", "origin"] : ["fetch", "origin"])) process.exit(1);
const target = tag ? `tags/${tag}` : "origin/main";
const oldHead = gitText(["rev-parse", "HEAD"]);
if (!oldHead || !run("git", ["worktree", "add", "--detach", stage, target])) process.exit(1);

let switched = false;
try {
  if (!run(npm, ["ci", "--include=dev"], stage)) throw new Error("staged npm ci failed");
  removeTree(path.join(stage, ".vercel"));
  if (!run(npm, ["run", "build"], stage)) throw new Error("staged build failed");
  if (!fs.existsSync(path.join(stage, ".vercel", "output"))) throw new Error("staged build produced no deployable output");
  if (!(await verifyStagedBuild())) throw new Error("staged build failed readiness");

  fs.mkdirSync(rollback, { recursive: true });
  copyIfPresent(path.join(root, ".vercel"), path.join(rollback, ".vercel"));
  if (!run("git", tag ? ["checkout", "--force", target] : ["merge", "--ff-only", target])) throw new Error("release checkout failed");
  for (const name of ["node_modules", ".vercel"]) {
    const current = path.join(root, name);
    const saved = path.join(rollback, name);
    if (fs.existsSync(current) && !fs.existsSync(saved)) fs.renameSync(current, saved);
    else removeTree(current);
    const built = path.join(stage, name);
    if (fs.existsSync(built)) fs.renameSync(built, current);
  }
  switched = true;
  log(`release ${gitText(["rev-parse", "HEAD"])} ready`);
} catch (err) {
  log(err instanceof Error ? err.message : String(err));
  if (switched || gitText(["rev-parse", "HEAD"]) !== oldHead) restore(oldHead);
  cleanup();
  process.exit(1);
}

if (process.env.INVOCATION_ID && process.platform !== "win32") {
  const main = Number(process.env.MAINPID || process.env.RELAY_PID || "");
  cleanup();
  if (main) process.kill(main, "SIGTERM");
  process.exit(0);
}

const main = Number(process.env.RELAY_PID || process.env.MAINPID || "");
if (main) {
  try { process.kill(main, "SIGTERM"); } catch (err) { log(String(err)); }
  await new Promise((resolve) => setTimeout(resolve, 750));
}
const port = String(process.env.PORT || "8081");
const child = startPreview(port);
if (!child) {
  restore(oldHead);
  cleanup();
  process.exit(1);
}
const ready = await waitForPreview(port, child);
if (!ready) {
  try { process.kill(child.pid, "SIGTERM"); } catch { /* already gone */ }
  restore(oldHead);
  const previous = startPreview(port);
  const restored = previous ? await waitForPreview(port, previous) : false;
  cleanup();
  log(restored
    ? "new release failed readiness; restored and restarted previous release"
    : "new release failed readiness; restored previous release but restart failed");
  process.exit(1);
}
cleanup();
log(`serving verified release on ${port}`);
