import { executeCommand, probeDevice, readMonitorValue } from "./engine";
import { validateDriver } from "./schema";
import type { DeviceInstance, DriverSpec, RoomConfig } from "./types";
import { emptyRoomConfig } from "./defaults";

const TOKENS = /\{([a-zA-Z0-9_.:]+)\}/g;
const KNOWN = new Set([
  "value", "value:hex2", "value:nrpn14", "token", "host", "port", "id", "midiChannel",
]);

export type HarnessIssue = { level: "error" | "warn"; message: string };

export function inspectDriver(spec: DriverSpec): HarnessIssue[] {
  const issues: HarnessIssue[] = [];
  const invalid = validateDriver(spec);
  if (invalid) issues.push({ level: "error", message: invalid });
  const lan = spec.transports.lan;
  if (lan?.protocol === "tcp" && spec.probe && !spec.probe.payload && spec.probe.success?.value === "ok") {
    issues.push({ level: "warn", message: "Empty TCP probe with success \"ok\" — engine treats empty probe as connect-only. Drop the needle." });
  }
  const blobs: string[] = [];
  for (const cmd of spec.commands ?? []) {
    if (cmd.payload) blobs.push(cmd.payload);
    if (cmd.httpPath) blobs.push(cmd.httpPath);
  }
  for (const fb of spec.feedback ?? []) {
    if (fb.query) blobs.push(fb.query);
    if (fb.httpPath) blobs.push(fb.httpPath);
  }
  if (spec.probe?.payload) blobs.push(spec.probe.payload);
  for (const blob of blobs) {
    for (const match of blob.matchAll(TOKENS)) {
      const name = match[1] ?? "";
      if (name.startsWith("auth.")) continue;
      if (KNOWN.has(name)) continue;
      if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) continue;
      issues.push({ level: "warn", message: `Unknown token {${name}}` });
    }
  }
  for (const fb of spec.feedback ?? []) {
    if (fb.parse && !["regex", "jsonpath", "contains", "exact", "map"].includes(fb.parse.type)) {
      issues.push({ level: "error", message: `Feedback ${fb.id} uses parse type ${fb.parse.type}` });
    }
  }
  if (lan?.encoding === "hex" && lan.payloadEncoding === "ascii") {
    issues.push({ level: "warn", message: "lan.encoding is hex but payloadEncoding is ascii" });
  }
  return issues;
}

function stubConfig(spec: DriverSpec, file: string, host: string, port?: number, auth?: Record<string, string>): RoomConfig {
  const device: DeviceInstance = {
    id: "dut",
    name: "DUT",
    driver: file,
    transport: "lan",
    host,
    port: port ?? spec.transports.lan?.port,
    auth: auth ?? {},
    enabledFeatures: [],
    simulate: false,
  };
  const cfg = emptyRoomConfig("1234");
  cfg.devices = [device];
  return cfg;
}

export async function liveDriverCheck(opts: {
  spec: DriverSpec;
  file: string;
  host: string;
  port?: number;
  auth?: Record<string, string>;
  command?: string;
  value?: string;
  feedback?: string;
}): Promise<{ probe: string; command?: string; feedback?: string }> {
  const config = stubConfig(opts.spec, opts.file, opts.host, opts.port, opts.auth);
  const drivers = { [opts.file]: opts.spec };
  const state = {};
  const probe = await probeDevice({ config, drivers, deviceId: "dut", host: opts.host });
  let command: string | undefined;
  let feedback: string | undefined;
  if (opts.command) {
    const sent = await executeCommand({
      config,
      drivers,
      state,
      deviceId: "dut",
      commandId: opts.command,
      value: opts.value,
      raw: true,
    });
    command = sent.ok ? sent.message || "ok" : sent.message || "failed";
  }
  if (opts.feedback) {
    const read = await readMonitorValue({ config, drivers, state, deviceId: "dut", feedbackId: opts.feedback });
    feedback = read.ok ? read.value : read.message;
  }
  return { probe: probe.ok ? probe.message || "reachable" : probe.message || "unreachable", command, feedback };
}
