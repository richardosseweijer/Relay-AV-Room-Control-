import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OUTBOUND_NONE_NAME,
  planHttpsVenueListen,
} from "./https-venue-listen.mjs";
import { listLanNicsFrom } from "./http-listen-host.mjs";
import {
  generateAndPersistVenueTls,
  planVenueTlsGenerate,
  readVenueTlsStatus,
  VENUE_TLS_SKIP_OUTBOUND_NONE,
  VENUE_TLS_SKIP_NO_IP,
  VENUE_TLS_SKIP_REFUSE_ALL_ZEROS,
} from "./venue-tls-generate.mjs";

test("planVenueTlsGenerate: soft-skip outbound None", () => {
  const r = planVenueTlsGenerate({
    outboundName: OUTBOUND_NONE_NAME,
    outboundIpv4: "203.0.113.1",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, VENUE_TLS_SKIP_OUTBOUND_NONE);
});

test("planVenueTlsGenerate: soft-skip empty pick", () => {
  const r = planVenueTlsGenerate({ outboundName: "", outboundIpv4: "203.0.113.1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, VENUE_TLS_SKIP_OUTBOUND_NONE);
});

test("planVenueTlsGenerate: soft-skip no IPv4", () => {
  const r = planVenueTlsGenerate({ outboundName: "eth1", outboundIpv4: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, VENUE_TLS_SKIP_NO_IP);
});

test("planVenueTlsGenerate: refuse 0.0.0.0", () => {
  const r = planVenueTlsGenerate({ outboundName: "eth1", outboundIpv4: "0.0.0.0" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, VENUE_TLS_SKIP_REFUSE_ALL_ZEROS);
});

test("generateAndPersistVenueTls: writes PEMs + status SAN; B1 plan listens", () => {
  const root = mkdtempSync(join(tmpdir(), "venue-gen-"));
  const r = generateAndPersistVenueTls({
    rootDir: root,
    outboundName: "ethVenue",
    outboundIpv4: "203.0.113.9",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.status.sanIp, "203.0.113.9");
  assert.ok(r.tlsCertPath.endsWith("server.cert.pem"));
  assert.ok(r.tlsKeyPath.endsWith("server.key.pem"));
  const status = readVenueTlsStatus(root);
  assert.equal(status.present, true);
  assert.equal(status.sanIp, "203.0.113.9");
  assert.equal(status.keyModes?.serverKey, 0o600);

  const fixture = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    ethAv: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
    ethVenue: [{ address: "203.0.113.9", family: "IPv4", internal: false, cidr: "203.0.113.9/24" }],
  };
  const nics = listLanNicsFrom(fixture);
  const plan = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: {},
    roomJson: {
      config: {
        room: {
          outboundNicName: "ethVenue",
          tlsCertPath: r.tlsCertPath,
          tlsKeyPath: r.tlsKeyPath,
        },
      },
    },
  });
  assert.equal(plan.listen, true);
  if (plan.listen) {
    assert.equal(plan.host, "203.0.113.9");
    assert.equal(plan.certPath, r.tlsCertPath);
    assert.equal(plan.keyPath, r.tlsKeyPath);
  }
});

test("generateAndPersistVenueTls: soft-skip None does not write", () => {
  const root = mkdtempSync(join(tmpdir(), "venue-skip-"));
  const r = generateAndPersistVenueTls({
    rootDir: root,
    outboundName: OUTBOUND_NONE_NAME,
    outboundIpv4: "203.0.113.9",
  });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  const status = readVenueTlsStatus(root);
  assert.equal(status.present, false);
});
