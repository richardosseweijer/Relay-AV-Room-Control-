#!/usr/bin/env node
/**
 * Manual Samsung Tizen pairing helper (not the runtime device path).
 * TLS (8002) is fail-closed unless --ca / --fingerprint (or env) is set.
 * --insecure only prints the leaf fingerprint; re-run with --fingerprint to pair.
 */
import net from "node:net";
import tls from "node:tls";
import {
  fingerprintFromPeerCert,
  parseSamsungPairArgv,
  resolveSamsungPairTls,
  samsungPairHelpText,
} from "./samsung-pair-trust.mjs";

const parsed = parseSamsungPairArgv(process.argv);
if (parsed.help) {
  console.log(samsungPairHelpText());
  process.exit(0);
}
if (parsed.unknown.length) {
  console.error(`Unknown option(s): ${parsed.unknown.join(" ")}`);
  console.error(samsungPairHelpText());
  process.exit(1);
}
if (!parsed.host) {
  console.error(samsungPairHelpText());
  process.exit(1);
}

const host = parsed.host;
const port = parsed.port;
const secure = port === 8002;
const trust = resolveSamsungPairTls({
  secure,
  caPath: parsed.caPath,
  fingerprint: parsed.fingerprint,
  insecure: parsed.insecure,
  env: process.env,
});
if (!trust.ok) {
  console.error(trust.message);
  console.error("See: node scripts/samsung-pair.mjs --help");
  process.exit(1);
}

const name = Buffer.from("Relay").toString("base64");
const path = `/api/v2/channels/samsung.remote.control?name=${name}`;
const key = Buffer.from("relaypairkey1234").toString("base64");

console.log(`Connecting ${secure ? "wss" : "ws"}://${host}:${port}${path}`);
if (trust.mode === "discover") {
  console.log("Discover mode (--insecure): will print leaf fingerprint only (no pairing).\n");
} else {
  console.log("Accept Allow on the TV if it appears.\n");
}

/** @type {import('node:net').Socket | import('node:tls').TLSSocket} */
const sock = secure
  ? tls.connect({ host, port, ...(trust.tlsOptions || {}) })
  : net.connect({ host, port });

let buf = Buffer.alloc(0);
let upgraded = false;
const timer = setTimeout(() => {
  console.error("Timed out. TV on? Same LAN? Try the other port.");
  sock.destroy();
  process.exit(1);
}, 12000);

function finishDiscover() {
  const tlsSock = /** @type {import('node:tls').TLSSocket} */ (sock);
  const cert = tlsSock.getPeerCertificate?.(true);
  const fp = fingerprintFromPeerCert(cert);
  if (!fp) {
    console.error("Connected but could not read leaf sha256 fingerprint.");
    clearTimeout(timer);
    sock.destroy();
    process.exit(1);
  }
  const colon = fp.match(/.{1,2}/g)?.join(":") ?? fp;
  console.log("Leaf certificate SHA-256 fingerprint:");
  console.log(`  ${fp}`);
  console.log(`  ${colon}`);
  console.log("");
  console.log(trust.message || "Re-run with --fingerprint=<sha256> to pair.");
  console.log(`Example: node scripts/samsung-pair.mjs ${host} ${port} --fingerprint=${fp}`);
  clearTimeout(timer);
  sock.destroy();
  process.exit(2);
}

sock.on("secureConnect", () => {
  if (trust.mode === "discover") finishDiscover();
});

sock.on("connect", () => {
  if (trust.mode === "discover") {
    // Wait for secureConnect on TLS; plain should never be discover.
    if (!secure) finishDiscover();
    return;
  }
  sock.write(
    `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nOrigin: http://${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
  );
});

sock.on("data", (chunk) => {
  if (trust.mode === "discover") return;
  buf = Buffer.concat([buf, chunk]);
  const text = buf.toString("utf8");
  if (!upgraded) {
    if (!text.includes("\r\n\r\n")) return;
    const head = text.slice(0, text.indexOf("\r\n\r\n"));
    if (!/101/.test(head.split("\r\n")[0] || "")) {
      console.error("TV did not upgrade:\n" + head.slice(0, 300));
      sock.destroy();
      process.exit(1);
    }
    upgraded = true;
    console.log("Socket upgraded. Waiting for token…");
    return;
  }
  const body = text.slice(text.indexOf("\r\n\r\n") + 4);
  console.log(body.slice(0, 500));
  const token = body.match(/"token"\s*:\s*"([^"]+)"/);
  if (token) {
    console.log("\nPAIRING TOKEN:\n" + token[1]);
    console.log("\nPut port 8002 and this token on the device, then Save all.");
  }
  clearTimeout(timer);
  sock.destroy();
  process.exit(0);
});

sock.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
