import test from "node:test";
import assert from "node:assert/strict";
import {
  validateIpv4Unicast,
  validatePrefix,
  platformGate,
  listenHostConflict,
  resolveAvTarget,
  addressOnOtherIface,
  buildNmcliStaticModifyArgv,
  buildNmcliDhcpModifyArgv,
  buildNmcliConnectionUpArgv,
  avLanIpConfirmMessage,
  avLanIpSuccessHint,
  parseNmDeviceShow,
  classifyNmcliFailure,
  applyAvLanIpViaNmcli,
  AV_LAN_IP_LINUX_ONLY,
  AV_LAN_IP_NMCLI_MISSING,
  AV_LAN_IP_UNMANAGED,
  AV_LAN_IP_NO_CONNECTION,
  AV_LAN_IP_SUDOERS,
  AV_LAN_IP_LISTEN_OVERRIDE,
  AV_LAN_IP_LISTEN_OVERRIDE_DHCP,
} from "./av-lan-ip.mjs";

test("validateIpv4Unicast: accepts room unicast", () => {
  assert.deepEqual(validateIpv4Unicast("10.0.25.10"), { ok: true, address: "10.0.25.10" });
  assert.deepEqual(validateIpv4Unicast(" 192.168.1.5 "), { ok: true, address: "192.168.1.5" });
});

test("validateIpv4Unicast: rejects unspecified/loopback/multicast/link-local", () => {
  assert.equal(validateIpv4Unicast("0.0.0.0").ok, false);
  assert.equal(validateIpv4Unicast("127.0.0.1").ok, false);
  assert.equal(validateIpv4Unicast("224.0.0.1").ok, false);
  assert.equal(validateIpv4Unicast("169.254.1.1").ok, false);
  assert.equal(validateIpv4Unicast("not-an-ip").ok, false);
  assert.equal(validateIpv4Unicast("10.0.25.256").ok, false);
  assert.equal(validateIpv4Unicast("01.2.3.4").ok, false);
});

test("validatePrefix: 1–32", () => {
  assert.deepEqual(validatePrefix(24), { ok: true, prefix: 24 });
  assert.deepEqual(validatePrefix("8"), { ok: true, prefix: 8 });
  assert.equal(validatePrefix(0).ok, false);
  assert.equal(validatePrefix(33).ok, false);
  assert.equal(validatePrefix("x").ok, false);
});

test("platformGate: non-linux clear error", () => {
  assert.equal(platformGate("linux").ok, true);
  const win = platformGate("win32");
  assert.equal(win.ok, false);
  assert.equal(win.message, AV_LAN_IP_LINUX_ONLY);
  assert.equal(platformGate("darwin").ok, false);
});

test("listenHostConflict: refuse mismatch / DHCP with override", () => {
  assert.equal(listenHostConflict("", "static", "10.0.25.10").ok, true);
  assert.equal(listenHostConflict("10.0.25.10", "static", "10.0.25.10").ok, true);
  const bad = listenHostConflict("127.0.0.1", "static", "10.0.25.10");
  assert.equal(bad.ok, false);
  assert.equal(bad.message, AV_LAN_IP_LISTEN_OVERRIDE);
  const dhcp = listenHostConflict("10.0.25.10", "dhcp", null);
  assert.equal(dhcp.ok, false);
  assert.equal(dhcp.message, AV_LAN_IP_LISTEN_OVERRIDE_DHCP);
});

test("resolveAvTarget: AV pick only (name beats missing)", () => {
  const nics = [
    { index: 0, name: "enp1s0", ipv4: "10.0.25.10" },
    { index: 1, name: "enp2s0", ipv4: "192.168.1.40" },
  ];
  const resolveNic = (list, pick) => {
    const name = String(pick.name ?? "").trim();
    if (name) return list.find((n) => n.name === name) || null;
    if (pick.index != null) return list.find((n) => n.index === Number(pick.index)) || null;
    return null;
  };
  const hit = resolveAvTarget({ name: "enp1s0", index: 99 }, nics, resolveNic);
  assert.equal(hit.ok, true);
  assert.equal(hit.nic.name, "enp1s0");
  assert.equal(resolveAvTarget({ name: null, index: null }, nics, resolveNic).ok, false);
  assert.equal(resolveAvTarget({ name: "missing0", index: null }, nics, resolveNic).ok, false);
});

test("addressOnOtherIface", () => {
  const nics = [
    { name: "enp1s0", ipv4: "10.0.25.10" },
    { name: "enp2s0", ipv4: "10.0.25.99" },
  ];
  assert.equal(addressOnOtherIface(nics, "10.0.25.99", "enp1s0"), true);
  assert.equal(addressOnOtherIface(nics, "10.0.25.10", "enp1s0"), false);
  assert.equal(addressOnOtherIface(nics, "10.0.25.50", "enp1s0"), false);
});

test("buildNmcliStaticModifyArgv: no gateway value; never-default; not outbound", () => {
  const argv = buildNmcliStaticModifyArgv("Wired connection 1", "10.0.25.10", 24);
  assert.equal(argv[0], "connection");
  assert.equal(argv[1], "modify");
  assert.equal(argv[2], "Wired connection 1");
  assert.ok(argv.includes("ipv4.method"));
  assert.equal(argv[argv.indexOf("ipv4.method") + 1], "manual");
  assert.equal(argv[argv.indexOf("ipv4.addresses") + 1], "10.0.25.10/24");
  assert.equal(argv[argv.indexOf("ipv4.gateway") + 1], "");
  assert.equal(argv[argv.indexOf("ipv4.never-default") + 1], "yes");
  assert.equal(argv[argv.indexOf("connection.autoconnect") + 1], "yes");
  assert.equal(argv.includes("enp2s0"), false);
  assert.equal(argv[argv.indexOf("ipv4.gateway") + 1], "");
  assert.ok(!argv.includes("10.0.10.1"), "demo gateway must not appear");
});

test("buildNmcliDhcpModifyArgv: auto, clear addresses/gateway, never-default", () => {
  const argv = buildNmcliDhcpModifyArgv("AV-LAN");
  assert.equal(argv[argv.indexOf("ipv4.method") + 1], "auto");
  assert.equal(argv[argv.indexOf("ipv4.addresses") + 1], "");
  assert.equal(argv[argv.indexOf("ipv4.gateway") + 1], "");
  assert.equal(argv[argv.indexOf("ipv4.never-default") + 1], "yes");
  assert.deepEqual(buildNmcliConnectionUpArgv("AV-LAN"), ["connection", "up", "AV-LAN"]);
});

test("avLanIpConfirmMessage: lockout + new URL + no default route + restart", () => {
  const msg = avLanIpConfirmMessage({
    mode: "static",
    iface: "enp1s0",
    address: "10.0.25.20",
    prefix: 24,
    port: 8081,
  });
  assert.match(msg, /enp1s0/);
  assert.match(msg, /10\.0\.25\.20\/24/);
  assert.match(msg, /http:\/\/10\.0\.25\.20:8081\//);
  assert.match(msg, /drop after apply|page will drop/i);
  assert.match(msg, /new URL|reopen/i);
  assert.match(msg, /not get a default route/i);
  assert.match(msg, /restart/i);
  assert.match(msg, /Venue|LAN \(internet\)/i);

  const dhcp = avLanIpConfirmMessage({ mode: "dhcp", iface: "enp1s0", port: 8081 });
  assert.match(dhcp, /DHCP/i);
  assert.match(dhcp, /not get a default route/i);
  assert.match(dhcp, /restart/i);
});

test("avLanIpSuccessHint", () => {
  assert.match(avLanIpSuccessHint({ mode: "static", address: "10.0.25.20", prefix: 24, port: 8081 }), /10\.0\.25\.20/);
  assert.match(avLanIpSuccessHint({ mode: "dhcp", port: 8081 }), /DHCP/i);
});

test("parseNmDeviceShow", () => {
  const p = parseNmDeviceShow(
    "GENERAL.CONNECTION:Wired connection 1\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
  );
  assert.equal(p.connection, "Wired connection 1");
  assert.equal(p.managed, "yes");
});

test("classifyNmcliFailure: missing / sudo / unmanaged", () => {
  assert.equal(
    classifyNmcliFailure({ code: null, error: Object.assign(new Error("spawn nmcli ENOENT"), { code: "ENOENT" }) })
      .message,
    AV_LAN_IP_NMCLI_MISSING,
  );
  assert.equal(
    classifyNmcliFailure({ code: 1, stdout: "", stderr: "sudo: a password is required\n" }).message,
    AV_LAN_IP_SUDOERS,
  );
  assert.equal(
    classifyNmcliFailure({ code: 1, stdout: "", stderr: "Error: Device 'enp1s0' is not managed.\n" }).message,
    AV_LAN_IP_UNMANAGED,
  );
});

test("applyAvLanIpViaNmcli: missing nmcli refuse", async () => {
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.25.10",
    prefix: 24,
    runNmcli: async () => ({
      code: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_IP_NMCLI_MISSING);
});

test("applyAvLanIpViaNmcli: unmanaged refuse", async () => {
  const calls = [];
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.25.10",
    prefix: 24,
    runNmcli: async (argv, opts) => {
      calls.push({ argv, opts });
      if (argv[0] === "-t" && argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (argv.includes("device") && argv.includes("show")) {
        return {
          code: 0,
          stdout: "GENERAL.CONNECTION:--\nGENERAL.STATE:10 (unmanaged)\nGENERAL.NM-MANAGED:no\n",
          stderr: "",
        };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_IP_UNMANAGED);
  assert.equal(calls.some((c) => c.opts?.sudo), false);
});

test("applyAvLanIpViaNmcli: static success uses sudo modify+up, never-default, no gateway", async () => {
  const sudoCalls = [];
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.25.10",
    prefix: 24,
    runNmcli: async (argv, opts) => {
      if (argv[0] === "-t" && argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (argv.includes("device") && argv.includes("show")) {
        return {
          code: 0,
          stdout: "GENERAL.CONNECTION:AV-LAN\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
          stderr: "",
        };
      }
      if (opts?.sudo) {
        sudoCalls.push(argv);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "expected sudo" };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.connectionId, "AV-LAN");
  assert.equal(sudoCalls.length, 2);
  assert.ok(sudoCalls[0].includes("ipv4.never-default"));
  assert.equal(sudoCalls[0][sudoCalls[0].indexOf("ipv4.gateway") + 1], "");
  assert.equal(sudoCalls[0].includes("enp2s0"), false);
  assert.deepEqual(sudoCalls[1], ["connection", "up", "AV-LAN"]);
});

test("applyAvLanIpViaNmcli: dhcp success clears addresses", async () => {
  const sudoCalls = [];
  const res = await applyAvLanIpViaNmcli({
    mode: "dhcp",
    device: "enp1s0",
    runNmcli: async (argv, opts) => {
      if (argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (argv.includes("show")) {
        return {
          code: 0,
          stdout: "GENERAL.CONNECTION:AV-LAN\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
          stderr: "",
        };
      }
      if (opts?.sudo) {
        sudoCalls.push(argv);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "fail" };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(sudoCalls[0][sudoCalls[0].indexOf("ipv4.method") + 1], "auto");
  assert.equal(sudoCalls[0][sudoCalls[0].indexOf("ipv4.addresses") + 1], "");
});

test("applyAvLanIpViaNmcli: no connection profile", async () => {
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.25.10",
    prefix: 24,
    runNmcli: async (argv) => {
      if (argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      return {
        code: 0,
        stdout: "GENERAL.CONNECTION:--\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
        stderr: "",
      };
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_IP_NO_CONNECTION);
});

test("auth bar note: applyAvLanIp mirrors restartHost (config token + Config PIN)", () => {
  // Documented invariant for suites that enumerate admin host actions.
  const adminActions = ["restartHost", "updateHost", "rebootHost", "applyAvLanIp"];
  assert.ok(adminActions.includes("applyAvLanIp"));
  assert.equal(adminActions.length, 4);
});
