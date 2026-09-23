import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KIOSK_UNIT,
  KIOSK_LINUX_ONLY,
  kioskRestartCommands,
  enableLocalOutput,
  platformGate,
} from "./kiosk.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("platformGate: non-linux clear error", () => {
  assert.equal(platformGate("linux").ok, true);
  const win = platformGate("win32");
  assert.equal(win.ok, false);
  assert.equal(win.message, KIOSK_LINUX_ONLY);
});

test("kiosk restart argv is fixed unit allowlist", () => {
  const steps = kioskRestartCommands();
  assert.ok(steps.length >= 2);
  for (const step of steps) {
    assert.ok(step.args.includes("restart"));
    assert.ok(step.args.includes(KIOSK_UNIT));
    assert.equal(
      step.args.some((arg) => /[\s;|&]/.test(arg) || arg.includes("..")),
      false,
    );
  }
  assert.equal(steps[1].args[0], "-n");
});

test("enableLocalOutput: non-linux does not spawn", () => {
  let called = 0;
  const res = enableLocalOutput({
    platform: "win32",
    spawnSync: () => {
      called += 1;
      return { status: 0 };
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "platform");
  assert.equal(called, 0);
});

test("enableLocalOutput: tries systemctl then sudo -n", () => {
  const calls = [];
  const res = enableLocalOutput({
    platform: "linux",
    spawnSync: (bin, args) => {
      calls.push({ bin, args: [...args] });
      if (calls.length === 1) return { status: 1, stderr: "access denied" };
      return { status: 0 };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["restart", KIOSK_UNIT]);
  assert.equal(calls[1].args[0], "-n");
  assert.ok(calls[1].args.includes("restart"));
  assert.ok(calls[1].args.includes(KIOSK_UNIT));
});

test("relay-kiosk.service takes tty1 / cage -d / Requires relay", () => {
  const unit = readFileSync(join(root, "deploy/relay-kiosk.service"), "utf8");
  assert.ok(unit.includes("Conflicts=getty@tty1.service"));
  assert.ok(unit.includes("TTYPath=/dev/tty1"));
  assert.ok(unit.includes("ExecStartPre=+/bin/chvt 1"));
  assert.ok(unit.includes("cage -d --"));
  assert.equal(unit.includes("cage -s"), false);
  assert.ok(unit.includes("Requires=relay.service"));
  assert.ok(unit.includes("After=relay.service"));
  assert.ok(unit.includes("relay-kiosk.env"));
  assert.ok(unit.includes("relay-kiosk.sh"));
});

test("sudoers.relay-kiosk is narrow systemctl allowlist", () => {
  const body = readFileSync(join(root, "deploy/sudoers.relay-kiosk"), "utf8");
  assert.match(body, /relay-kiosk\.service/);
  assert.equal(body.includes("nmcli"), false);
  assert.equal(/ALL=\(root\) NOPASSWD:\s*ALL/.test(body), false);
});
