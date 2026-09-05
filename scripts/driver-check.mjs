#!/usr/bin/env node
/**
 * Offline + optional live driver check.
 *
 *   node scripts/driver-check.mjs data/drivers/samsung-qe50q65t.json
 *   node scripts/driver-check.mjs path.json --host 10.0.0.20 --command power.on --feedback power.state
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const file = process.argv[2];
if (!file || file.startsWith("-")) {
  console.error("Usage: node scripts/driver-check.mjs <driver.json> [--host IP] [--port N] [--command id] [--value x] [--feedback id] [--token t]");
  process.exit(2);
}

const abs = path.resolve(file);
const spec = JSON.parse(fs.readFileSync(abs, "utf8"));
const args = new Map();
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const val = process.argv[i + 1];
  if (key?.startsWith("--") && val) args.set(key.slice(2), val);
}

const harnessUrl = pathToFileURL(path.resolve("src/lib/control/harness.ts")).href;
const { inspectDriver, liveDriverCheck } = await import(harnessUrl);

const issues = inspectDriver(spec);
for (const row of issues) console.log(`${row.level.toUpperCase()}\t${row.message}`);
if (!issues.length) console.log("OK\tstatic checks passed");
if (issues.some((row) => row.level === "error")) process.exit(1);

if (!args.has("host")) process.exit(0);

const live = await liveDriverCheck({
  spec,
  file: path.basename(abs),
  host: args.get("host"),
  port: args.has("port") ? Number(args.get("port")) : undefined,
  auth: args.has("token") ? { token: args.get("token") } : {},
  command: args.get("command"),
  value: args.get("value"),
  feedback: args.get("feedback"),
});
console.log(`PROBE\t${live.probe}`);
if (live.command !== undefined) console.log(`COMMAND\t${live.command}`);
if (live.feedback !== undefined) console.log(`FEEDBACK\t${live.feedback}`);
