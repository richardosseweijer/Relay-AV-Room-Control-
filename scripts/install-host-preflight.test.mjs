/**
 * Unit tests for scripts/install-host-preflight.sh (bash library).
 * Spawns bash that sources the lib with env overrides — no root / systemd needed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const preflightSh = join(here, "install-host-preflight.sh");

/**
 * @param {string} body bash after sourcing the lib
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function runPreflightBash(body, extraEnv = {}) {
  const script = `
set -euo pipefail
source "${preflightSh}"
${body}
`;
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

test("relay_node_major parses v22.19.0 → 22", () => {
  const r = runPreflightBash('relay_node_major "v22.19.0"; echo');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "22");
});

test("relay_preflight_node_npm fails when unit PATH has Node < 22", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-fake-node20-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "node"), "#!/bin/sh\necho v20.19.2\n", { mode: 0o755 });
    writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 9.0.0\n", { mode: 0o755 });
    const r = runPreflightBash("relay_preflight_node_npm", {
      RELAY_UNIT_PATH: bin,
      RELAY_PREFLIGHT_NPM: join(bin, "npm"),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /preflight failed/);
    assert.match(r.stderr, /v20\.19\.2/);
    assert.match(r.stderr, /need major >= 22|major >= 22/);
    assert.match(r.stderr, /LINUX\.md §2|NodeSource/);
    assert.match(r.stderr, /crash-loop/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("relay_preflight_build fails when nitro.json missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-preflight-"));
  try {
    const r = runPreflightBash(`relay_preflight_build "${dir}"`);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /missing build output/);
    assert.match(r.stderr, /npm ci --include=dev && npm run build/);
    assert.match(r.stderr, /LINUX\.md §5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("relay_preflight_build OK when marker present", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-preflight-"));
  try {
    const markerDir = join(dir, ".vercel", "output");
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, "nitro.json"), "{}\n");
    const r = runPreflightBash(`relay_preflight_build "${dir}"`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /preflight OK — build present/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("relay_preflight_node_npm OK with fake PATH containing node 22 + npm", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-fake-node-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "node"),
      "#!/bin/sh\necho v22.99.0\n",
      { mode: 0o755 },
    );
    writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 10.0.0\n", { mode: 0o755 });
    // Also need /usr/bin/npm for ExecStart check — override with RELAY_PREFLIGHT_NPM
    const r = runPreflightBash("relay_preflight_node_npm", {
      RELAY_UNIT_PATH: bin,
      RELAY_PREFLIGHT_NPM: join(bin, "npm"),
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /preflight OK — node v22/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
