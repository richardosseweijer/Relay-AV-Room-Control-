import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

test("update readiness allows two minutes and retries boot responses", () => {
  const source = readFileSync(join(repo, "scripts", "update-relay.mjs"), "utf8");
  assert.match(source, /RELAY_UPDATE_READY_MS \|\| 120_000/g);
  assert.equal(source.match(/RELAY_UPDATE_READY_MS \|\| 120_000/g)?.length, 2);
  assert.match(source, /while \(Date\.now\(\) < deadline\)/);
  assert.match(source, /NITRO_PORT: String\(port\)/);
  assert.match(source, /PORT: String\(port\)/);
  assert.match(source, /--strictPort/);
  assert.match(source, /fetch", "--prune", "--force", "--tags"/);
  assert.match(source, /checkout", "-f", "-B", "main"/);
  assert.match(source, /:\(exclude\)\.vercel/);
  assert.equal(source.includes("--ff-only"), false);
});

test("failed staged install leaves the running checkout untouched", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "relay-update-test-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".vercel", "output"), { recursive: true });
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "bin"));
  cpSync(join(repo, "scripts", "update-relay.mjs"), join(root, "scripts", "update-relay.mjs"));
  writeFileSync(join(root, ".vercel", "output", "marker"), "running-build");
  writeFileSync(join(root, "node_modules", "marker"), "running-dependencies");
  writeFileSync(join(root, "bin", "git"), `#!/bin/sh
case "$1" in
  diff|fetch) exit 0 ;;
  rev-parse) printf old-head; exit 0 ;;
  worktree) mkdir -p "$4"; exit 0 ;;
esac
exit 1
`);
  writeFileSync(join(root, "bin", "npm"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(root, "bin", "git"), 0o755);
  chmodSync(join(root, "bin", "npm"), 0o755);
  const run = spawnSync(process.execPath, [join(root, "scripts", "update-relay.mjs")], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.equal(readFileSync(join(root, ".vercel", "output", "marker"), "utf8"), "running-build");
  assert.equal(readFileSync(join(root, "node_modules", "marker"), "utf8"), "running-dependencies");
  assert.equal(existsSync(join(root, "data", "relay-update.log")), true);
});
