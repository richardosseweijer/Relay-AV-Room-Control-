/**
 * Unit tests for scripts/install-host-units-render.sh (bash library).
 * Covers the Wyse/testbox regression: RELAY_SVC_USER=pi must not be treated
 * as an unsubstituted placeholder after User=USER → User=pi.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const renderSh = join(here, "install-host-units-render.sh");
const deployDir = join(here, "..", "deploy");
const relayTemplate = join(deployDir, "relay.service");
const kioskTemplate = join(deployDir, "relay-kiosk.service");

/**
 * @param {string} body bash after sourcing the lib
 */
function runRenderBash(body) {
  const script = `
set -euo pipefail
source "${renderSh}"
${body}
`;
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env },
  });
}

/**
 * @param {string} template
 * @param {string} repoRoot
 * @param {string} svcUser
 */
function renderToTemp(template, repoRoot, svcUser) {
  const dir = mkdtempSync(join(tmpdir(), "relay-units-render-"));
  const out = join(dir, "out.service");
  const r = runRenderBash(
    `relay_render_unit_file "${template}" "${out}" "${repoRoot}" "${svcUser}" "test.service"; echo OK`,
  );
  return { dir, out, r };
}

test("RELAY_SVC_USER=pi with template User=USER succeeds (Wyse/testbox regression)", () => {
  const repoRoot = "/home/pi/Relay-AV-Room-Control-";
  const { dir, out, r } = renderToTemp(relayTemplate, repoRoot, "pi");
  try {
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const body = readFileSync(out, "utf8");
    assert.match(body, /^User=pi$/m);
    assert.ok(body.includes(`WorkingDirectory=${repoRoot}`));
    assert.doesNotMatch(body, /^User=USER$/m);
    assert.doesNotMatch(body, /\/home\/USER\/Relay-AV-Room-Control-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RELAY_SVC_USER=pi renders kiosk paths under /home/pi without false placeholder fail", () => {
  const repoRoot = "/home/pi/Relay-AV-Room-Control-";
  const { dir, out, r } = renderToTemp(kioskTemplate, repoRoot, "pi");
  try {
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const body = readFileSync(out, "utf8");
    assert.match(body, /^User=pi$/m);
    assert.ok(body.includes(`${repoRoot}/scripts/relay-kiosk.sh`));
    assert.ok(body.includes(`${repoRoot}/data/relay-kiosk.env`));
    assert.doesNotMatch(body, /\/home\/USER\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RELAY_SVC_USER=ubuntu substitutes User=USER and /home/USER paths", () => {
  const repoRoot = "/home/ubuntu/Relay-AV-Room-Control-";
  const { dir, out, r } = renderToTemp(relayTemplate, repoRoot, "ubuntu");
  try {
    assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    const body = readFileSync(out, "utf8");
    assert.match(body, /^User=ubuntu$/m);
    assert.ok(body.includes(`WorkingDirectory=${repoRoot}`));
    assert.doesNotMatch(body, /^User=USER$/m);
    assert.doesNotMatch(body, /^User=pi$/m);
    assert.doesNotMatch(body, /\/home\/USER\//);
    assert.doesNotMatch(body, /\/home\/pi\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when literal User=USER remains (sed skipped)", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-units-bad-"));
  try {
    const out = join(dir, "out.service");
    writeFileSync(out, "[Service]\nUser=USER\nWorkingDirectory=/opt/relay\n");
    const r = runRenderBash(
      `relay_validate_rendered_unit "${out}" "bad.service" "/opt/relay" "ubuntu"`,
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /User= placeholder not substituted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when User=pi remains for non-pi service user", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-units-pi-left-"));
  try {
    const out = join(dir, "out.service");
    writeFileSync(
      out,
      "[Service]\nUser=pi\nWorkingDirectory=/home/ubuntu/Relay-AV-Room-Control-\n",
    );
    const r = runRenderBash(
      `relay_validate_rendered_unit "${out}" "bad.service" "/home/ubuntu/Relay-AV-Room-Control-" "ubuntu"`,
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /User=pi placeholder not substituted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when /home/USER path remains", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-units-user-path-"));
  try {
    const out = join(dir, "out.service");
    writeFileSync(
      out,
      "[Service]\nUser=ubuntu\nWorkingDirectory=/home/USER/Relay-AV-Room-Control-\n",
    );
    const r = runRenderBash(
      `relay_validate_rendered_unit "${out}" "bad.service" "/home/ubuntu/Relay-AV-Room-Control-" "ubuntu"`,
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /path placeholder not substituted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when /home/pi path remains but REPO_ROOT is elsewhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-units-pi-path-"));
  try {
    const out = join(dir, "out.service");
    writeFileSync(
      out,
      "[Service]\nUser=ubuntu\nWorkingDirectory=/home/pi/Relay-AV-Room-Control-\n",
    );
    const r = runRenderBash(
      `relay_validate_rendered_unit "${out}" "bad.service" "/opt/relay" "ubuntu"`,
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /path placeholder not substituted|WorkingDirectory=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
