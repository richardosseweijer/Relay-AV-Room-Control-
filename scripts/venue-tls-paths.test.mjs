import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVenueTlsMaterial } from "./venue-tls-crypto.mjs";
import {
  fileModeBits,
  venueTlsPaths,
  writeVenueTlsPems,
  venueTlsPemsPresent,
} from "./venue-tls-paths.mjs";

test("writeVenueTlsPems: fixed paths under data/tls/venue; keys mode 0600", () => {
  const root = mkdtempSync(join(tmpdir(), "venue-paths-"));
  const material = generateVenueTlsMaterial({ sanIp: "192.0.2.10" });
  const paths = writeVenueTlsPems(root, material);
  assert.equal(paths.dir, join(root, "data", "tls", "venue"));
  assert.ok(paths.serverCertPath.endsWith(join("data", "tls", "venue", "server.cert.pem")));
  assert.ok(paths.serverKeyPath.endsWith(join("data", "tls", "venue", "server.key.pem")));
  assert.ok(paths.caCertPath.endsWith(join("data", "tls", "venue", "ca.cert.pem")));
  assert.equal(fileModeBits(paths.serverKeyPath), 0o600);
  assert.equal(fileModeBits(paths.caKeyPath), 0o600);
  assert.ok(venueTlsPemsPresent(root));
  assert.ok(readFileSync(paths.caCertPath, "utf8").includes("BEGIN CERTIFICATE"));
  assert.deepEqual(venueTlsPaths(root).serverCertPath, paths.serverCertPath);
});
