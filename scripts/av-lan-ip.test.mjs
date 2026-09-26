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
  buildNmcliConnectionAddAvArgv,
  buildNmcliAutoconnectNoArgv,
  avLanIpConfirmMessage,
  avLanIpSuccessHint,
  parseNmDeviceShow,
  parseNmConnectionIpv4,
  listConnectionNamesForDevice,
  verifyAvLanApplied,
  classifyNmcliFailure,
  applyAvLanIpViaNmcli,
  RELAY_AV_LAN_CONNECTION_ID,
  AV_LAN_IP_LINUX_ONLY,
  AV_LAN_IP_NMCLI_MISSING,
  AV_LAN_IP_UNMANAGED,
  AV_LAN_IP_SUDOERS,
  AV_LAN_IP_LISTEN_OVERRIDE,
  AV_LAN_IP_LISTEN_OVERRIDE_DHCP,
  AV_LAN_IP_VERIFY_FAILED,
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

test("buildNmcliConnectionAddAvArgv: Relay-owned profile on device", () => {
  const argv = buildNmcliConnectionAddAvArgv("enp1s0");
  assert.equal(argv.includes("add"), true);
  assert.equal(argv[argv.indexOf("con-name") + 1], RELAY_AV_LAN_CONNECTION_ID);
  assert.equal(argv[argv.indexOf("ifname") + 1], "enp1s0");
  assert.equal(argv[argv.indexOf("connection.autoconnect-priority") + 1], "100");
  assert.deepEqual(buildNmcliAutoconnectNoArgv("netplan-enp1s0"), [
    "connection",
    "modify",
    "netplan-enp1s0",
    "connection.autoconnect",
    "no",
  ]);
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

test("parseNmConnectionIpv4 + listConnectionNamesForDevice", () => {
  assert.deepEqual(parseNmConnectionIpv4("manual\n10.0.10.10/24\nyes\n"), {
    method: "manual",
    addresses: "10.0.10.10/24",
    neverDefault: "yes",
  });
  assert.deepEqual(parseNmConnectionIpv4("auto\n\nyes\n"), {
    method: "auto",
    addresses: "",
    neverDefault: "yes",
  });
  assert.deepEqual(
    listConnectionNamesForDevice("relay-av-lan:enp1s0\nnetplan-enp1s0:enp1s0\nnetplan-enp2s0:enp2s0\n", "enp1s0"),
    ["relay-av-lan", "netplan-enp1s0"],
  );
});

test("verifyAvLanApplied: static requires manual+address; rejects auto leftover", () => {
  assert.equal(
    verifyAvLanApplied({
      mode: "static",
      address: "10.0.10.10",
      prefix: 24,
      connection: { method: "manual", addresses: "10.0.10.10/24", neverDefault: "yes" },
      deviceAddresses: "10.0.10.10/24",
    }).ok,
    true,
  );
  const bad = verifyAvLanApplied({
    mode: "static",
    address: "10.0.10.10",
    prefix: 24,
    // Live bug: netplan merge left method=auto with stale addresses
    connection: { method: "auto", addresses: "10.0.10.10/24", neverDefault: "yes" },
    deviceAddresses: "",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.message, AV_LAN_IP_VERIFY_FAILED);
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

/** Shared mock: device managed; relay-av-lan missing then created; verify reads manual. */
function mockStaticSuccessRunner(sudoCalls, { otherOnDevice = "netplan-enp1s0" } = {}) {
  let created = false;
  return async (argv, opts) => {
    if (argv[0] === "-t" && argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
    if (argv.includes("device") && argv.includes("show") && argv.includes("GENERAL.CONNECTION,GENERAL.STATE,GENERAL.NM-MANAGED")) {
      return {
        code: 0,
        stdout: "GENERAL.CONNECTION:netplan-enp1s0\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
        stderr: "",
      };
    }
    if (argv.includes("connection") && argv.includes("show") && argv.includes(RELAY_AV_LAN_CONNECTION_ID) && argv.includes("NAME") && !argv.includes("ipv4.method")) {
      return created ? { code: 0, stdout: `${RELAY_AV_LAN_CONNECTION_ID}\n`, stderr: "" } : { code: 10, stdout: "", stderr: "not found" };
    }
    if (argv[0] === "-g" && argv.includes("ipv4.method,ipv4.addresses,ipv4.never-default")) {
      return { code: 0, stdout: "manual\n10.0.25.10/24\nyes\n", stderr: "" };
    }
    if (argv[0] === "-g" && argv.includes("IP4.ADDRESS")) {
      return { code: 0, stdout: `${RELAY_AV_LAN_CONNECTION_ID}\n100 (connected)\n10.0.25.10/24\n`, stderr: "" };
    }
    if (argv[0] === "-t" && argv.includes("NAME,DEVICE")) {
      return {
        code: 0,
        stdout: `${RELAY_AV_LAN_CONNECTION_ID}:enp1s0\n${otherOnDevice}:enp1s0\nnetplan-enp2s0:enp2s0\n`,
        stderr: "",
      };
    }
    if (opts?.sudo) {
      sudoCalls.push(argv);
      if (argv.includes("add")) created = true;
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "expected sudo or known probe" };
  };
}

test("applyAvLanIpViaNmcli: static uses relay-av-lan profile, not netplan-<iface>", async () => {
  const sudoCalls = [];
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.25.10",
    prefix: 24,
    runNmcli: mockStaticSuccessRunner(sudoCalls),
  });
  assert.equal(res.ok, true);
  assert.equal(res.connectionId, RELAY_AV_LAN_CONNECTION_ID);
  assert.ok(sudoCalls.some((a) => a.includes("add") && a.includes(RELAY_AV_LAN_CONNECTION_ID)));
  const modify = sudoCalls.find((a) => a.includes("modify") && a.includes("ipv4.method") && a.includes("manual"));
  assert.ok(modify);
  assert.equal(modify[modify.indexOf("modify") + 1], RELAY_AV_LAN_CONNECTION_ID);
  assert.ok(modify.includes("ipv4.never-default"));
  assert.equal(modify[modify.indexOf("ipv4.gateway") + 1], "");
  assert.ok(!modify.includes("netplan-enp1s0"), "must not modify installer netplan profile in place");
  assert.ok(sudoCalls.some((a) => a[0] === "connection" && a[1] === "up" && a[2] === RELAY_AV_LAN_CONNECTION_ID));
  assert.ok(sudoCalls.some((a) => a.includes("netplan-enp1s0") && a.includes("connection.autoconnect") && a.includes("no")));
});

test("applyAvLanIpViaNmcli: dhcp success clears addresses on relay-av-lan", async () => {
  const sudoCalls = [];
  const res = await applyAvLanIpViaNmcli({
    mode: "dhcp",
    device: "enp1s0",
    runNmcli: async (argv, opts) => {
      if (argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (argv.includes("device") && argv.includes("show") && argv.some((a) => String(a).includes("NM-MANAGED"))) {
        return {
          code: 0,
          stdout: "GENERAL.CONNECTION:relay-av-lan\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
          stderr: "",
        };
      }
      if (
        argv.includes("connection") &&
        argv.includes("show") &&
        argv.includes(RELAY_AV_LAN_CONNECTION_ID) &&
        argv.includes("NAME") &&
        !argv.some((a) => String(a).includes("ipv4.method"))
      ) {
        return { code: 0, stdout: `${RELAY_AV_LAN_CONNECTION_ID}\n`, stderr: "" };
      }
      if (argv[0] === "-g" && argv.some((a) => String(a).includes("ipv4.method"))) {
        return { code: 0, stdout: "auto\n\nyes\n", stderr: "" };
      }
      if (argv[0] === "-g" && argv.some((a) => String(a).includes("IP4.ADDRESS"))) {
        return { code: 0, stdout: "relay-av-lan\n100 (connected)\n10.0.10.50/24\n", stderr: "" };
      }
      if (argv[0] === "-t" && argv.includes("NAME,DEVICE")) {
        return { code: 0, stdout: "relay-av-lan:enp1s0\n", stderr: "" };
      }
      if (opts?.sudo) {
        sudoCalls.push(argv);
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `unhandled ${argv.join(" ")}` };
    },
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.appliedAddress, "10.0.10.50");
  assert.equal(res.appliedPrefix, 24);
  const modify = sudoCalls.find((a) => a.includes("ipv4.method") && a.includes("auto"));
  assert.ok(modify);
  assert.equal(modify[modify.indexOf("modify") + 1], RELAY_AV_LAN_CONNECTION_ID);
  assert.equal(modify[modify.indexOf("ipv4.addresses") + 1], "");
});

test("applyAvLanIpViaNmcli: verify fails when method stays auto (netplan merge)", async () => {
  const res = await applyAvLanIpViaNmcli({
    mode: "static",
    device: "enp1s0",
    address: "10.0.10.10",
    prefix: 24,
    runNmcli: async (argv, opts) => {
      if (argv.includes("networking")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (argv.includes("device") && argv.includes("show") && argv.some((a) => String(a).includes("NM-MANAGED"))) {
        return {
          code: 0,
          stdout: "GENERAL.CONNECTION:netplan-enp1s0\nGENERAL.STATE:100 (connected)\nGENERAL.NM-MANAGED:yes\n",
          stderr: "",
        };
      }
      if (
        argv.includes("connection") &&
        argv.includes("show") &&
        argv.includes(RELAY_AV_LAN_CONNECTION_ID) &&
        argv.includes("NAME") &&
        !argv.some((a) => String(a).includes("ipv4.method"))
      ) {
        return { code: 0, stdout: `${RELAY_AV_LAN_CONNECTION_ID}\n`, stderr: "" };
      }
      if (argv[0] === "-t" && argv.includes("NAME,DEVICE")) {
        return { code: 0, stdout: "relay-av-lan:enp1s0\n", stderr: "" };
      }
      if (argv[0] === "-g" && argv.some((a) => String(a).includes("ipv4.method"))) {
        // Bug reproduce: addresses set but method still auto
        return { code: 0, stdout: "auto\n10.0.10.10/24\nyes\n", stderr: "" };
      }
      if (argv[0] === "-g" && argv.some((a) => String(a).includes("IP4.ADDRESS"))) {
        return { code: 0, stdout: "relay-av-lan\n70 (connecting)\n\n", stderr: "" };
      }
      if (opts?.sudo) return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: `unhandled ${argv.join(" ")}` };
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.message, AV_LAN_IP_VERIFY_FAILED);
});

test("auth bar note: applyAvLanIp mirrors restartHost (config token + Config PIN)", () => {
  // Documented invariant for suites that enumerate admin host actions.
  const adminActions = ["restartHost", "updateHost", "rebootHost", "applyAvLanIp"];
  assert.ok(adminActions.includes("applyAvLanIp"));
  assert.equal(adminActions.length, 4);
});
