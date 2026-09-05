import type { DriverPairing, DriverSpec, PairingStep, RoomConfig } from "./types";

export function validateDriver(spec: DriverSpec): string | null {
  if (!spec?.device?.manufacturer || !spec?.device?.model) return "Driver needs device.manufacturer and device.model";
  if (!spec.commands?.length) return "Driver needs at least one command";
  const ids = spec.commands.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return "Duplicate command ids";
  const proto = spec.transports.lan?.protocol;
  if (spec.transports.lan && !proto) return "LAN transport needs a protocol";
  return null;
}

export function inferPairingSteps(pairing?: DriverPairing): PairingStep[] {
  if (pairing?.steps?.length) return pairing.steps;
  if (!pairing || pairing.kind === "none") return [];
  if (pairing.kind === "http-handshake") {
    return [{
      action: "http-post",
      port: pairing.ports?.[0] ?? 80,
      path: pairing.path || "/api",
      body: pairing.discoverPath ? undefined : "{\"devicetype\":\"relay#room\"}",
      tokenJsonPath: pairing.tokenJsonPath || "username",
      timeoutMs: 8000,
    }];
  }
  if (pairing.kind === "websocket-handshake") {
    const ports = pairing.ports?.length ? pairing.ports : [8001, 8002];
    return ports.map((port) => ({
      action: "websocket" as const,
      port,
      tls: pairing.tlsPorts?.includes(port) || port === 8002,
      path: pairing.path || "/api/v2/channels/samsung.remote.control",
      waitContains: pairing.waitContains || "ms.channel.connect",
      tokenJsonPath: pairing.tokenJsonPath || "token",
      nextPort: port === 8001 ? 8002 : undefined,
      timeoutMs: 12000,
    }));
  }
  if (pairing.kind === "http-probe") {
    return [{
      action: "http-get",
      port: pairing.ports?.[0] ?? 80,
      path: pairing.discoverPath || pairing.path || "/",
      timeoutMs: 3000,
    }];
  }
  return [];
}

export function orphanBindings(config: RoomConfig, drivers: Record<string, DriverSpec>) {
  const broken: string[] = [];
  for (const device of config.devices) {
    const driver = drivers[device.driver];
    if (!driver) {
      broken.push(`${device.name}: missing driver ${device.driver}`);
      continue;
    }
    const cmds = new Set(driver.commands.map((c) => c.id));
    const fbs = new Set(driver.feedback.map((f) => f.id));
    for (const macro of config.macros) {
      for (const step of macro.steps) {
        if (step.device === device.id && step.command && !cmds.has(step.command)) {
          broken.push(`${macro.label}: ${step.command}`);
        }
      }
    }
    for (const page of config.pages) {
      for (const widget of page.widgets) {
        if (widget.bind.device === device.id && widget.bind.command && !cmds.has(widget.bind.command)) {
          broken.push(`${page.label} / ${widget.label}: ${widget.bind.command}`);
        }
      }
    }
    for (const rule of config.monitors ?? []) {
      if (rule.device === device.id && rule.feedback && !fbs.has(rule.feedback)) {
        broken.push(`Monitor ${rule.label}: ${rule.feedback}`);
      }
    }
  }
  return broken;
}
