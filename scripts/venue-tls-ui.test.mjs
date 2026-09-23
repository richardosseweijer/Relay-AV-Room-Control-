import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  venueTlsGenerateGate,
  venueTlsSanMismatch,
  venueTlsStatusLines,
  venueTlsCaInstallHintList,
  venueTlsLeafDaysLeft,
  venueTlsExpiryWarn,
  venueTlsLifecycleFlags,
  venueTlsRegenerateConfirmMessage,
  VENUE_TLS_GENERATE_DISABLED_OUTBOUND_NONE,
  VENUE_TLS_GENERATE_DISABLED_NO_IP,
  VENUE_TLS_MISMATCH_PROMPT,
  VENUE_TLS_EXPIRY_WARN_DAYS,
  VENUE_TLS_EXPIRY_PROMPT,
  VENUE_TLS_EXPIRED_PROMPT,
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
  assert.match(m.message, /Confirm Regenerate/i);
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

test("venueTlsLeafDaysLeft: floor days and negative when expired", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  assert.equal(venueTlsLeafDaysLeft("2026-10-23T12:00:00.000Z", now), 30);
  assert.equal(venueTlsLeafDaysLeft("2026-09-13T12:00:00.000Z", now), -10);
  assert.equal(venueTlsLeafDaysLeft(null, now), null);
  assert.equal(venueTlsLeafDaysLeft("not-a-date", now), null);
});

test("venueTlsExpiryWarn: warns at ≤30 days, expired path", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const far = venueTlsExpiryWarn({
    present: true,
    leafNotAfter: "2028-01-15T00:00:00.000Z",
    now,
  });
  assert.equal(far.warn, false);
  assert.ok(far.daysLeft != null && far.daysLeft > VENUE_TLS_EXPIRY_WARN_DAYS);

  const near = venueTlsExpiryWarn({
    present: true,
    leafNotAfter: "2026-10-10T12:00:00.000Z",
    now,
  });
  assert.equal(near.warn, true);
  assert.equal(near.expired, false);
  assert.equal(near.message, VENUE_TLS_EXPIRY_PROMPT);
});

test("venueTlsExpiryWarn: expired message", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const gone = venueTlsExpiryWarn({
    present: true,
    leafNotAfter: "2026-08-01T00:00:00.000Z",
    now,
  });
  assert.equal(gone.warn, true);
  assert.equal(gone.expired, true);
  assert.equal(gone.message, VENUE_TLS_EXPIRED_PROMPT);
  assert.ok(gone.daysLeft != null && gone.daysLeft < 0);
});

test("venueTlsExpiryWarn: quiet when absent", () => {
  const r = venueTlsExpiryWarn({ present: false, leafNotAfter: "2026-10-01T00:00:00.000Z" });
  assert.equal(r.warn, false);
  assert.equal(r.message, null);
});

test("venueTlsLifecycleFlags: mismatch + confirm + no silent reissue", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const flags = venueTlsLifecycleFlags({
    present: true,
    sanIp: "203.0.113.1",
    liveIpv4: "203.0.113.9",
    leafNotAfter: "2026-10-05T00:00:00.000Z",
    now,
  });
  assert.equal(flags.mismatch, true);
  assert.equal(flags.expiryWarn, true);
  assert.equal(flags.needsAction, true);
  assert.equal(flags.needsConfirm, true);
  assert.match(flags.mismatchMessage ?? "", /Confirm Regenerate/i);
});

test("venueTlsLifecycleFlags: healthy present still needs confirm", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const flags = venueTlsLifecycleFlags({
    present: true,
    sanIp: "10.0.0.1",
    liveIpv4: "10.0.0.1",
    leafNotAfter: "2028-01-15T00:00:00.000Z",
    now,
  });
  assert.equal(flags.needsAction, false);
  assert.equal(flags.needsConfirm, true);
  assert.equal(flags.mismatch, false);
  assert.equal(flags.expiryWarn, false);
});

test("venueTlsRegenerateConfirmMessage: includes IP and reason", () => {
  const msg = venueTlsRegenerateConfirmMessage({
    liveIpv4: "203.0.113.9",
    mismatch: true,
  });
  assert.match(msg, /203\.0\.113\.9/);
  assert.match(msg, /not in the current SAN/i);
  assert.match(msg, /AV HTTP stays up/i);
  const expired = venueTlsRegenerateConfirmMessage({ expired: true });
  assert.match(expired, /expired/i);
});

test("venueTlsStatusLines: absent vs present with days-left", () => {
  const absent = venueTlsStatusLines({ present: false });
  assert.equal(absent.activeLabel, "No");
  assert.equal(absent.sanIp, "—");
  assert.equal(absent.daysLeft, null);
  const present = venueTlsStatusLines({
    present: true,
    active: true,
    sanIp: "203.0.113.9",
    leafNotAfter: "2028-01-15T00:00:00.000Z",
    leafFingerprint256: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    now: Date.parse("2026-09-23T12:00:00.000Z"),
  });
  assert.equal(present.activeLabel, "Yes");
  assert.equal(present.sanIp, "203.0.113.9");
  assert.match(present.expiry, /^2028-01-15 \(\d+d left\)$/);
  assert.match(present.fingerprint, /AA:BB:CC:DD/);
  assert.ok(present.daysLeft != null && present.daysLeft > 30);
});

test("venueTlsCaInstallHintList covers four OSes", () => {
  const list = venueTlsCaInstallHintList();
  assert.deepEqual(
    list.map((row) => row.id),
    ["ios", "android", "windows", "macos"],
  );
  for (const row of list) assert.ok(row.text.length > 20);
});

test("room-tab Networks surfaces C3 confirm / expiry / regenerate", () => {
  const src = fs.readFileSync("src/components/config/room-tab.tsx", "utf8");
  assert.match(src, /Generate venue certificate/);
  assert.match(src, /Regenerate venue certificate/);
  assert.match(src, /Download CA/);
  assert.match(src, /generateVenueTls/);
  assert.match(src, /getVenueTlsStatus/);
  assert.match(src, /\/api\/venue-tls-ca/);
  assert.match(src, /venueTlsGenerateGate/);
  assert.match(src, /venueTlsLifecycleFlags/);
  assert.match(src, /venueTlsRegenerateConfirmMessage/);
  assert.match(src, /window\.confirm/);
  assert.match(src, /loadVenueTls/);
  assert.match(src, /IP drift/);
  assert.match(src, /Expiring soon|Expired/);
  assert.doesNotMatch(src, /confirm flow arrives in C3/i);
});
