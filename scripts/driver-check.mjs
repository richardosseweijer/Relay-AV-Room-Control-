#!/usr/bin/env node
/**
 * Offline driver check (no TypeScript loader).
 *
 *   node scripts/driver-check.mjs data/drivers/samsung-qe50q65t.json
 *   node scripts/driver-check.mjs path.json --host 10.0.0.20
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const file = process.argv[2];
if (!file || file.startsWith("-")) {
  console.error("Usage: node scripts/driver-check.mjs <driver.json> [--host IP] [--port N]");
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const val = process.argv[i + 1];
  if (key?.startsWith("--") && val) args.set(key.slice(2), val);
}

const issues = [];
if (!spec?.device?.manufacturer || !spec?.device?.model) issues.push(["ERROR", "Driver needs device.manufacturer and device.model"]);
if (!spec.commands?.length) issues.push(["ERROR", "Driver needs at least one command"]);
const ids = (spec.commands ?? []).map((c) => c.id);
if (new Set(ids).size !== ids.length) issues.push(["ERROR", "Duplicate command ids"]);
if (spec.transports?.lan && !spec.transports.lan.protocol) issues.push(["ERROR", "LAN transport needs a protocol"]);
if (spec.transports?.lan?.protocol === "tcp" && spec.probe && !spec.probe.payload && spec.probe.success?.value === "ok") {
  issues.push(["WARN", "Empty TCP probe with success \"ok\" — drop the needle"]);
}
const known = new Set(["value", "value:hex2", "value:nrpn14", "token", "host", "port", "id", "midiChannel"]);
const blobs = [];
for (const cmd of spec.commands ?? []) {
  if (cmd.payload) blobs.push(cmd.payload);
  if (cmd.httpPath) blobs.push(cmd.httpPath);
}
for (const fb of spec.feedback ?? []) {
  if (fb.query) blobs.push(fb.query);
  if (fb.httpPath) blobs.push(fb.httpPath);
  if (fb.parse && !["regex", "jsonpath", "contains", "exact", "map"].includes(fb.parse.type)) {
    issues.push(["ERROR", `Feedback ${fb.id} uses parse type ${fb.parse.type}`]);
  }
}
for (const blob of blobs) {
  for (const match of String(blob).matchAll(/\{([a-zA-Z0-9_.:]+)\}/g)) {
    const name = match[1] ?? "";
    if (name.startsWith("auth.") || known.has(name) || /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) continue;
    issues.push(["WARN", `Unknown token {${name}}`]);
  }
}

for (const [level, message] of issues) console.log(`${level}\t${message}`);
if (!issues.length) console.log("OK\tstatic checks passed");
if (issues.some((row) => row[0] === "ERROR")) process.exit(1);

if (!args.has("host")) process.exit(0);

const host = args.get("host");
const port = Number(args.get("port") || spec.transports?.lan?.port || 80);
await new Promise((resolve) => {
  const sock = net.connect({ host, port });
  const timer = setTimeout(() => { sock.destroy(); console.log("PROBE\ttimeout"); resolve(); }, 2500);
  sock.on("connect", () => { clearTimeout(timer); sock.end(); console.log(`PROBE\topen ${host}:${port}`); resolve(); });
  sock.on("error", (err) => { clearTimeout(timer); console.log(`PROBE\t${err.message}`); resolve(); });
});
