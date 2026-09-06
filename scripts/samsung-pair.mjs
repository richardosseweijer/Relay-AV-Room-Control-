#!/usr/bin/env node
/** Usage: node scripts/samsung-pair.mjs 10.0.25.234 [8001|8002] */
import net from "node:net";
import tls from "node:tls";

const host = process.argv[2];
const port = Number(process.argv[3] || 8002);
if (!host) {
  console.error("Usage: node scripts/samsung-pair.mjs <tv-ip> [8001|8002]");
  process.exit(1);
}

const name = Buffer.from("Relay").toString("base64");
const path = `/api/v2/channels/samsung.remote.control?name=${name}`;
const secure = port === 8002;
const key = Buffer.from("relaypairkey1234").toString("base64");

console.log(`Connecting ${secure ? "wss" : "ws"}://${host}:${port}${path}`);
console.log("Accept Allow on the TV if it appears.\n");

const sock = secure
  ? tls.connect({ host, port, rejectUnauthorized: false })
  : net.connect({ host, port });

let buf = Buffer.alloc(0);
let upgraded = false;
const timer = setTimeout(() => {
  console.error("Timed out. TV on? Same LAN? Try the other port.");
  sock.destroy();
  process.exit(1);
}, 12000);

sock.on("connect", () => {
  sock.write(
    `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nOrigin: http://${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
  );
});

sock.on("data", (chunk) => {
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
