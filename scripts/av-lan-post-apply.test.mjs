import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeCidr,
  validateAvCidrForUfw,
  isAnywhereCidr,
  parseRelayUfw8081Cidrs,
  buildUfwAllow8081Argv,
  buildUfwDelete8081Argv,
  syncUfwAvLan8081,
  UFW_RULE_COMMENT,
  AV_LAN_UFW_ANYWHERE,
  AV_LAN_UFW_SUDOERS,
  shouldRewriteFoyerRelayUrl,
  buildFoyerRelayUrl,
  patchFoyerKioskEnvBody,
  updateCoHostedFoyerRelayBind,
  foyerDataPaths,
  discoverFoyerRoots,
  runAvLanPostApplyHooks,
} from "./av-lan-post-apply.mjs";
import { parseFirstIpv4Cidr } from "./av-lan-ip.mjs";

test("computeCidr: host → network", () => {
  assert.equal(computeCidr("10.0.10.5", 24), "10.0.10.0/24");
  assert.equal(computeCidr("10.0.25.247", 24), "10.0.25.0/24");
  assert.equal(computeCidr("192.168.1.40", 16), "192.168.0.0/16");
  assert.equal(computeCidr("10.0.10.5", 32), "10.0.10.5/32");
  assert.equal(computeCidr("bad", 24), null);
});

test("validateAvCidrForUfw: refuse Anywhere / 0.0.0.0/0", () => {
  assert.equal(isAnywhereCidr("0.0.0.0/0"), true);
  assert.equal(validateAvCidrForUfw("0.0.0.0/0").ok, false);
  assert.equal(validateAvCidrForUfw("Anywhere").ok, false);
  assert.match(validateAvCidrForUfw("0.0.0.0/0").message, /Anywhere|0\.0\.0\.0/);
  const ok = validateAvCidrForUfw("10.0.10.5/24");
  assert.equal(ok.ok, true);
  assert.equal(ok.cidr, "10.0.10.0/24");
});

test("parseFirstIpv4Cidr", () => {
  assert.deepEqual(parseFirstIpv4Cidr("IP4.ADDRESS[1]:10.0.10.5/24"), {
    address: "10.0.10.5",
    prefix: 24,
  });
  assert.equal(parseFirstIpv4Cidr("no addr"), null);
});

test("parseRelayUfw8081Cidrs: only comment-tagged rules", () => {
  const status = `
Status: active
To                         Action      From
--                         ------      ----
8081/tcp                   ALLOW IN    10.0.25.0/24                 # Relay-AV-LAN
8081/tcp                   ALLOW IN    10.0.99.0/24
22/tcp                     ALLOW IN    Anywhere
`;
  assert.deepEqual(parseRelayUfw8081Cidrs(status), ["10.0.25.0/24"]);
});

test("buildUfwAllow/Delete argv: fixed port + comment, no shell", () => {
  assert.deepEqual(buildUfwAllow8081Argv("10.0.10.0/24"), [
    "allow",
    "from",
    "10.0.10.0/24",
    "to",
    "any",
    "port",
    "8081",
    "proto",
    "tcp",
    "comment",
    UFW_RULE_COMMENT,
  ]);
  assert.equal(buildUfwDelete8081Argv("10.0.25.0/24").includes("delete"), true);
  assert.ok(!buildUfwAllow8081Argv("10.0.10.0/24").includes("0.0.0.0/0"));
});

test("syncUfwAvLan8081: idempotent add + remove old Relay rule", async () => {
  /** @type {string[][]} */
  const calls = [];
  let status = `
[ 1] 8081/tcp    ALLOW IN    10.0.25.0/24    # Relay-AV-LAN
`;
  const runUfw = async (argv) => {
    calls.push([...argv]);
    if (argv[0] === "status") {
      return { code: 0, stdout: status, stderr: "", error: null };
    }
    if (argv[0] === "delete") {
      status = status.replace(/10\.0\.25\.0\/24/, "");
      return { code: 0, stdout: "Rule deleted", stderr: "", error: null };
    }
    if (argv[0] === "allow") {
      status += `\n8081/tcp ALLOW IN 10.0.10.0/24 # Relay-AV-LAN\n`;
      return { code: 0, stdout: "Rule added", stderr: "", error: null };
    }
    if (argv[0] === "reload") return { code: 0, stdout: "", stderr: "", error: null };
    return { code: 1, stdout: "", stderr: "unexpected", error: null };
  };

  const res = await syncUfwAvLan8081({ newCidr: "10.0.10.5/24", runUfw });
  assert.equal(res.ok, true);
  assert.equal(res.cidr, "10.0.10.0/24");
  assert.equal(res.added, true);
  assert.deepEqual(res.removed, ["10.0.25.0/24"]);
  assert.ok(calls.some((a) => a[0] === "delete" && a.includes("10.0.25.0/24")));
  assert.ok(calls.some((a) => a[0] === "allow" && a.includes("10.0.10.0/24")));

  // Second sync: already present → no duplicate allow
  calls.length = 0;
  const again = await syncUfwAvLan8081({ newCidr: "10.0.10.0/24", runUfw });
  assert.equal(again.ok, true);
  assert.equal(again.added, false);
  assert.ok(!calls.some((a) => a[0] === "allow"));
});

test("syncUfwAvLan8081: sudoers failure message", async () => {
  const runUfw = async () => ({
    code: 1,
    stdout: "",
    stderr: "sudo: a password is required",
    error: null,
  });
  const res = await syncUfwAvLan8081({ newCidr: "10.0.10.0/24", runUfw });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_UFW_SUDOERS);
});

test("syncUfwAvLan8081: refuses anywhere cidr", async () => {
  const res = await syncUfwAvLan8081({
    newCidr: "0.0.0.0/0",
    runUfw: async () => ({ code: 0, stdout: "", stderr: "", error: null }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_UFW_ANYWHERE);
});

test("shouldRewriteFoyerRelayUrl heuristics", () => {
  assert.equal(shouldRewriteFoyerRelayUrl("", null, "10.0.10.5"), true);
  assert.equal(shouldRewriteFoyerRelayUrl("http://127.0.0.1:8081", null, "10.0.10.5"), true);
  assert.equal(shouldRewriteFoyerRelayUrl("http://localhost:8081/", "10.0.25.10", "10.0.10.5"), true);
  assert.equal(shouldRewriteFoyerRelayUrl("http://10.0.25.10:8081", "10.0.25.10", "10.0.10.5"), true);
  assert.equal(shouldRewriteFoyerRelayUrl("http://10.0.10.5:8081", "10.0.25.10", "10.0.10.5"), false);
  // Deliberate remote — do not clobber
  assert.equal(shouldRewriteFoyerRelayUrl("http://10.0.99.50:8081", "10.0.25.10", "10.0.10.5"), false);
  assert.equal(buildFoyerRelayUrl("10.0.10.5", 8081), "http://10.0.10.5:8081");
});

test("patchFoyerKioskEnvBody preserves other keys", () => {
  const body = "FOYER_VIDEO_OUTPUT=DP-1\nFOYER_ROOM_PANEL_VIDEO_OUTPUT=DP-2\nFOYER_ROOM_PANEL_URL=http://10.0.25.10:8081\n";
  const next = patchFoyerKioskEnvBody(body, "http://10.0.10.5:8081");
  assert.match(next, /FOYER_VIDEO_OUTPUT=DP-1/);
  assert.match(next, /FOYER_ROOM_PANEL_VIDEO_OUTPUT=DP-2/);
  assert.match(next, /FOYER_ROOM_PANEL_URL=http:\/\/10\.0\.10\.5:8081/);
});

test("updateCoHostedFoyerRelayBind: rewrites previous AV, skips remote", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-foyer-"));
  try {
    const data = join(dir, "data");
    mkdirSync(data);
    const sitePath = join(data, "foyer-site.json");
    const kioskEnvPath = join(data, "foyer-kiosk.env");
    writeFileSync(
      sitePath,
      JSON.stringify({ name: "Room", relayUrl: "http://10.0.25.10:8081", relayEnabled: true }, null, 2),
    );
    writeFileSync(
      kioskEnvPath,
      "FOYER_VIDEO_OUTPUT=DP-1\nFOYER_ROOM_PANEL_VIDEO_OUTPUT=\nFOYER_ROOM_PANEL_URL=http://10.0.25.10:8081\n",
    );
    const foyer = { root: dir, dir: data, sitePath, kioskEnvPath };
    const res = updateCoHostedFoyerRelayBind({
      foyer,
      newAvIp: "10.0.10.5",
      previousAvIp: "10.0.25.10",
      port: 8081,
    });
    assert.equal(res.ok, true);
    assert.equal(res.rewritten, true);
    const site = JSON.parse(readFileSync(sitePath, "utf8"));
    assert.equal(site.relayUrl, "http://10.0.10.5:8081");
    assert.match(readFileSync(kioskEnvPath, "utf8"), /10\.0\.10\.5:8081/);

    writeFileSync(
      sitePath,
      JSON.stringify({ name: "Room", relayUrl: "http://10.0.99.50:8081", relayEnabled: true }, null, 2),
    );
    const skip = updateCoHostedFoyerRelayBind({
      foyer,
      newAvIp: "10.0.10.5",
      previousAvIp: "10.0.25.10",
      port: 8081,
    });
    assert.equal(skip.ok, true);
    assert.equal(skip.skipped, true);
    const site2 = JSON.parse(readFileSync(sitePath, "utf8"));
    assert.equal(site2.relayUrl, "http://10.0.99.50:8081");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverFoyerRoots includes sibling Foyer-Room-Signage", () => {
  const roots = discoverFoyerRoots("/home/pi/Relay-AV-Room-Control-", {});
  assert.ok(roots.some((r) => r.endsWith("Foyer-Room-Signage")));
});

test("runAvLanPostApplyHooks: soft-fail ufw still returns notes", async () => {
  const hooks = await runAvLanPostApplyHooks({
    newAddress: "10.0.10.5",
    newPrefix: 24,
    previousAddress: "10.0.25.10",
    port: 8081,
    relayRoot: "/tmp/relay-no-foyer-here",
    runUfw: async () => ({
      code: 1,
      stdout: "",
      stderr: "sudo: a password is required",
      error: null,
    }),
    env: {},
  });
  assert.equal(hooks.ufwOk, false);
  assert.ok(hooks.notes.some((n) => /ufw soft-fail/i.test(n)));
  assert.match(hooks.notes.join(" "), /sudoers|LINUX/);
});

test("foyerDataPaths", () => {
  const p = foyerDataPaths("/opt/Foyer-Room-Signage");
  assert.equal(p.sitePath, join("/opt/Foyer-Room-Signage", "data", "foyer-site.json"));
});
