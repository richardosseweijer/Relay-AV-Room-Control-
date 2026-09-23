import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  venueTlsGenerateGate,
  venueTlsSanMismatch,
  venueTlsStatusLines,
  venueTlsCaInstallHintList,
  VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE,
  VENUE_TLS_GENERATE_DISABLED_NO_IP,
  VENUE_TLS_MISMATCH_PROMPT,
} from "./venue-tls-ui.mjs";

test("venueTlsGenerateGate: disabled when outbound None", () => {
  const g = venueTlsGenerateGate({ outboundNone: true, liveIpv4: "203.0.113.1" });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE);
});

test("venueTlsGenerateGate: disabled when no live IPv4", () => {
  const g = venueTlsGenerateGate({ outboundNone: false, liveIpv4: null });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, VENUE_TLS_GENERATE_DISABLED_NO_IP);
});

test("venueTlsGenerateGate: allowed with live IPv4", () => {
  const g = venueTlsGenerateGate({ outboundNone: false, liveIpv4: "203.0.113.9" });
  assert.equal(g.allowed, true);
  assert.equal(g.reason, null);
});

test("venueTlsSanMismatch: flags live IP not in SAN", () => {
  const m = venueTlsSanMismatch({
    present: true,
    sanIp: "203.0.113.1",
    liveIpv4: "203.0.113.9",
  });
  assert.equal(m.mismatch, true);
  assert.equal(m.message, VENUE_TLS_MISMATCH_PROMPT);
});

test("venueTlsSanMismatch: quiet when match or absent", () => {
  assert.equal(
    venueTlsSanMismatch({ present: true, sanIp: "10.0.0.1", liveIpv4: "10.0.0.1" }).mismatch,
    false,
  );
  assert.equal(
    venueTlsSanMismatch({ present: false, sanIp: null, liveIpv4: "10.0.0.1" }).mismatch,
    false,
  );
});

test("venueTlsStatusLines: absent vs present", () => {
  const absent = venueTlsStatusLines({ present: false });
  assert.equal(absent.activeLabel, "No");
  assert.equal(absent.sanIp, "—");
  const present = venueTlsStatusLines({
    present: true,
    active: true,
    sanIp: "203.0.113.9",
    leafNotAfter: "2028-01-15T00:00:00.000Z",
    leafFingerprint256: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  });
  assert.equal(present.activeLabel, "Yes");
  assert.equal(present.sanIp, "203.0.113.9");
  assert.equal(present.expiry, "2028-01-15");
  assert.match(present.fingerprint, /AA:BB:CC:DD/);
});

test("venueTlsCaInstallHintList covers four OSes", () => {
  const list = venueTlsCaInstallHintList();
  assert.deepEqual(
    list.map((row) => row.id),
    ["ios", "android", "windows", "macos"],
  );
  for (const row of list) assert.ok(row.text.length > 20);
});

test("room-tab Networks surfaces C2 Generate / Download CA / mismatch", () => {
  const src = fs.readFileSync("src/components/config/room-tab.tsx", "utf8");
  assert.match(src, /Generate venue certificate/);
  assert.match(src, /Download CA/);
  assert.match(src, /generateVenueTls/);
  assert.match(src, /getVenueTlsStatus/);
  assert.match(src, /\/api\/venue-tls-ca/);
  assert.match(src, /venueTlsSanMismatch/);
  assert.match(src, /venueTlsGenerateGate/);
  assert.match(src, /regenerate needed|Generate again/i);
});
