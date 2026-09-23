import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_HTTPS_PORT,
  OUTBOUND_NONE_NAME,
  HTTPS_VENUE_SKIP_OUTBOUND_NONE,
  HTTPS_VENUE_SKIP_NO_CERTS,
  outboundPickFromRoomStore,
  tlsPathsFromRoomStore,
  resolveTlsPaths,
  resolveHttpsPort,
  planHttpsVenueListen,
  loadHttpsVenueMaterial,
  startHttpsVenueServer,
} from "./https-venue-listen.mjs";
import { listLanNicsFrom } from "./http-listen-host.mjs";

const fixture = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true },
  ],
  ethAv: [{ address: "10.0.25.10", family: "IPv4", internal: false, cidr: "10.0.25.10/24" }],
  ethVenue: [{ address: "203.0.113.9", family: "IPv4", internal: false, cidr: "203.0.113.9/24" }],
};

const nics = listLanNicsFrom(fixture);
const certDir = join(tmpdir(), `relay-b1-https-${process.pid}`);
mkdirSync(certDir, { recursive: true });
const certPath = join(certDir, "cert.pem");
const keyPath = join(certDir, "key.pem");
// Minimal PEM-shaped placeholders (readability only; startHttpsVenueServer tests mock createServer).
writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n");

test("outboundPickFromRoomStore reads outboundNicName/Index", () => {
  const pick = outboundPickFromRoomStore({
    config: { room: { outboundNicName: "ethVenue", outboundNicIndex: 1, avLanNicName: "ethAv" } },
  });
  assert.equal(pick.name, "ethVenue");
  assert.equal(pick.index, 1);
});

test("tlsPathsFromRoomStore reads tlsCertPath/tlsKeyPath", () => {
  const paths = tlsPathsFromRoomStore({
    config: { room: { tlsCertPath: "/etc/relay/cert.pem", tlsKeyPath: "/etc/relay/key.pem" } },
  });
  assert.equal(paths.certPath, "/etc/relay/cert.pem");
  assert.equal(paths.keyPath, "/etc/relay/key.pem");
});

test("resolveTlsPaths: env wins over room", () => {
  const res = resolveTlsPaths({
    env: { RELAY_TLS_CERT: "/env/cert", RELAY_TLS_KEY: "/env/key" },
    roomJson: { config: { room: { tlsCertPath: "/room/cert", tlsKeyPath: "/room/key" } } },
  });
  assert.deepEqual(res, { certPath: "/env/cert", keyPath: "/env/key", source: "env" });
});

test("resolveTlsPaths: room when env unset", () => {
  const res = resolveTlsPaths({
    env: {},
    roomJson: { config: { room: { tlsCertPath: "/room/cert", tlsKeyPath: "/room/key" } } },
  });
  assert.deepEqual(res, { certPath: "/room/cert", keyPath: "/room/key", source: "room" });
});

test("resolveTlsPaths: partial env does not fall through to room", () => {
  const res = resolveTlsPaths({
    env: { RELAY_TLS_CERT: "/env/cert" },
    roomJson: { config: { room: { tlsCertPath: "/room/cert", tlsKeyPath: "/room/key" } } },
  });
  assert.equal(res, null);
});

test("resolveHttpsPort: default 8443; invalid falls back", () => {
  assert.equal(resolveHttpsPort(undefined), DEFAULT_HTTPS_PORT);
  assert.equal(resolveHttpsPort("9443"), 9443);
  assert.equal(resolveHttpsPort("nope"), DEFAULT_HTTPS_PORT);
  assert.equal(DEFAULT_HTTPS_PORT, 8443);
});

test("planHttpsVenueListen: skip when outbound None (empty)", () => {
  const res = planHttpsVenueListen({
    nics,
    outboundPick: {},
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  assert.equal(res.listen, false);
  if (!res.listen) {
    assert.equal(res.reason, HTTPS_VENUE_SKIP_OUTBOUND_NONE);
  }
});

test("planHttpsVenueListen: skip when outbound __none__", () => {
  const res = planHttpsVenueListen({
    nics,
    outboundPick: { name: OUTBOUND_NONE_NAME },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  assert.equal(res.listen, false);
  if (!res.listen) assert.equal(res.reason, HTTPS_VENUE_SKIP_OUTBOUND_NONE);
});

test("planHttpsVenueListen: skip when no certs", () => {
  const res = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: {},
  });
  assert.equal(res.listen, false);
  if (!res.listen) assert.equal(res.reason, HTTPS_VENUE_SKIP_NO_CERTS);
});

test("planHttpsVenueListen: skip when cert unreadable", () => {
  const res = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: { RELAY_TLS_CERT: "/no/such/cert.pem", RELAY_TLS_KEY: keyPath },
  });
  assert.equal(res.listen, false);
  if (!res.listen) assert.match(res.reason, /cert not readable/i);
});

test("planHttpsVenueListen: resolve outbound host; never 0.0.0.0", () => {
  const res = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath, RELAY_HTTPS_PORT: "9443" },
  });
  assert.equal(res.listen, true);
  if (res.listen) {
    assert.equal(res.host, "203.0.113.9");
    assert.equal(res.host === "0.0.0.0", false);
    assert.equal(res.port, 9443);
    assert.equal(res.certPath, certPath);
    assert.equal(res.keyPath, keyPath);
  }
});

test("planHttpsVenueListen: skip when outbound has no IPv4 (soft)", () => {
  const bare = listLanNicsFrom({
    ethVenue: [{ address: "fe80::1", family: "IPv6", internal: false }],
  });
  const res = planHttpsVenueListen({
    nics: bare,
    outboundPick: { name: "ethVenue" },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  assert.equal(res.listen, false);
  if (!res.listen) assert.match(res.reason, /no IPv4/i);
});

test("planHttpsVenueListen: refuse 0.0.0.0 host", () => {
  const weird = [{ index: 0, name: "bad", ipv4: "0.0.0.0" }];
  const res = planHttpsVenueListen({
    nics: weird,
    outboundPick: { name: "bad" },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  assert.equal(res.listen, false);
  if (!res.listen) assert.match(res.reason, /0\.0\.0\.0/);
});

test("loadHttpsVenueMaterial: loads buffers for listen plan", () => {
  const plan = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  const ready = loadHttpsVenueMaterial(plan);
  assert.equal(ready.listen, true);
  if (ready.listen) {
    assert.ok(Buffer.isBuffer(ready.cert));
    assert.ok(Buffer.isBuffer(ready.key));
    assert.ok(ready.cert.length > 0);
  }
});

test("startHttpsVenueServer: skip path does not call createServer", () => {
  let created = false;
  const result = startHttpsVenueServer({
    ready: { listen: false, reason: HTTPS_VENUE_SKIP_OUTBOUND_NONE },
    requestListener: () => {},
    createServer: () => {
      created = true;
      throw new Error("should not create");
    },
    log: { info() {}, warn() {}, error() {} },
  });
  assert.equal(result.skipped, true);
  assert.equal(created, false);
  assert.equal(result.server, null);
});

test("startHttpsVenueServer: listens on outbound host only (mock)", async () => {
  const plan = planHttpsVenueListen({
    nics,
    outboundPick: { name: "ethVenue" },
    env: { RELAY_TLS_CERT: certPath, RELAY_TLS_KEY: keyPath },
  });
  const ready = loadHttpsVenueMaterial(plan);
  assert.equal(ready.listen, true);

  /** @type {{ port?: number, host?: string }} */
  const listened = {};
  const handlers = {};
  const fakeServer = {
    on(ev, fn) {
      handlers[ev] = fn;
      return fakeServer;
    },
    listen(port, host, cb) {
      listened.port = port;
      listened.host = host;
      assert.equal(host === "0.0.0.0", false);
      assert.equal(host, "203.0.113.9");
      cb && cb();
      return fakeServer;
    },
    close() {},
  };

  const result = startHttpsVenueServer({
    ready,
    requestListener: () => {},
    createServer: (opts, listener) => {
      assert.ok(opts.cert);
      assert.ok(opts.key);
      assert.equal(typeof listener, "function");
      return fakeServer;
    },
    log: { info() {}, warn() {}, error() {} },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.server, fakeServer);
  assert.equal(listened.host, "203.0.113.9");
  assert.equal(listened.port, DEFAULT_HTTPS_PORT);
});

test("startHttpsVenueServer: createServer throw is soft (AV unaffected)", () => {
  const result = startHttpsVenueServer({
    ready: {
      listen: true,
      host: "203.0.113.9",
      port: 8443,
      certPath,
      keyPath,
      cert: Buffer.from("c"),
      key: Buffer.from("k"),
    },
    requestListener: () => {},
    createServer: () => {
      throw new Error("boom");
    },
    log: { info() {}, warn() {}, error() {} },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.server, null);
  assert.match(String(result.reason), /AV HTTP unaffected/);
});
