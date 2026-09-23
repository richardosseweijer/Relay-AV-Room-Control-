import test from "node:test";
import assert from "node:assert/strict";
import { smbBindInterfacesConf, netRpcShutdownArgs } from "./rpc-bind.mjs";

test("smbBindInterfacesConf pins interfaces to AV IPv4", () => {
  const conf = smbBindInterfacesConf("10.0.25.10");
  assert.match(conf, /interfaces = 10\.0\.25\.10\/32/);
  assert.match(conf, /bind interfaces only = yes/);
});

test("netRpcShutdownArgs adds -s smb.conf when path set", () => {
  assert.deepEqual(netRpcShutdownArgs("10.0.25.40", "admin", "secret"), [
    "rpc", "shutdown", "-I", "10.0.25.40", "-U", "admin%secret", "-f", "-t", "0",
  ]);
  assert.deepEqual(netRpcShutdownArgs("10.0.25.40", "admin", "secret", "/tmp/relay-smb.conf"), [
    "-s", "/tmp/relay-smb.conf", "rpc", "shutdown", "-I", "10.0.25.40", "-U", "admin%secret", "-f", "-t", "0",
  ]);
});
