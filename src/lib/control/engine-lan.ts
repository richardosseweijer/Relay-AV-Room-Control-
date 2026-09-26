import type {
  CommandResult,
  DeviceInstance,
  DriverCommand,
  DriverSpec,
  RoomConfig,
} from "./types";
import { requestHttpExact, DEFAULT_MAX_RESPONSE_BYTES } from "./http-client";
import { sendControlSocket, buildWsTarget } from "./ws";
import { sendPjlink } from "./pjlink";
import { sendCast } from "./cast";
import { sendWol } from "./wol";
import { sendUdp } from "./udp";
import { sendOscCommand } from "./osc";
import { sendSacnCommand } from "./sacn";
import { sendIpmidi } from "./ipmidi";
import { sendRtpMidiCommand } from "./rtp-midi";
import {
  deviceHostAllowed,
  nicFaceProtocolGate,
  planDeviceBindForDevice,
  protocolNeedsTls,
  readNicFace,
} from "./device-face";
import { allowedLanHost, pushTrace, safeLanHttpUrl } from "./engine-policy";
import {
  telegramGetMe,
  telegramSendMessage,
} from "./telegram.ts";
import { renderPayload } from "./engine-payload";
import { paceDevice, wireEncoding, encodeWire, tcpWrite, tcpSessionWrite } from "./engine-wire";
import {
  smbBindInterfacesConf,
  netRpcShutdownArgs,
} from "../../../scripts/rpc-bind.mjs";
export { smbBindInterfacesConf, netRpcShutdownArgs };

/** Local spawn helper for RPC shutdown only (host local tools live in engine-host.ts). */
async function runTool(cmd: string, args: string[], timeout = 2000): Promise<CommandResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${cmd} timeout` }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `${cmd} ${code}` }); });
  });
}

export async function sendHttp(
  url: string,
  method: string,
  body: string,
  timeout: number,
  limits: {
    maxBytes?: number;
    maxMessageChars?: number;
    headers?: Record<string, string>;
    localAddress?: string;
    rejectUnauthorized?: boolean;
    ca?: string | Buffer;
    checkServerIdentity?: (host: string, cert: import("node:tls").PeerCertificate) => Error | undefined;
  } = {},
): Promise<CommandResult> {
  try {
    const verb = method.toUpperCase();
    let target = url;
    if ((verb === "GET" || verb === "HEAD") && body) {
      target += (url.includes("?") ? "&" : "?") + body.replace(/^\?/, "");
    }
    const headers = limits.headers ?? { "content-type": "application/json" };
    const res = await requestHttpExact(
      target,
      verb,
      verb === "GET" || verb === "HEAD" ? "" : body,
      headers,
      timeout,
      limits.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      limits.localAddress,
      limits.rejectUnauthorized ?? true,
      limits.ca,
      limits.checkServerIdentity,
    );
    return { ok: res.ok, message: res.text.slice(0, limits.maxMessageChars ?? 400) || String(res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "http failed" };
  }
}

async function sendRpcShutdown(host: string, user: string, password: string, localAddress?: string): Promise<CommandResult> {
  if (!allowedLanHost(host)) return { ok: false, message: "Host not on room LAN" };
  if (process.platform === "win32") {
    // Windows shutdown /m uses the routing table; AV-LAN reachability is still gated above.
    return runTool("shutdown", ["/s", "/m", `\\\\${host}`, "/t", "0", "/f"], 8000);
  }
  if (!user) return { ok: false, message: "Set user and password (Windows RPC) or HTTP path" };
  if (!localAddress) {
    return runTool("net", netRpcShutdownArgs(host, user, password), 8000);
  }
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const confPath = pathMod.join(os.tmpdir(), `relay-smb-bind-${process.pid}.conf`);
  try {
    await fs.writeFile(confPath, smbBindInterfacesConf(localAddress), "utf8");
    return await runTool("net", netRpcShutdownArgs(host, user, password, confPath), 8000);
  } finally {
    try { await fs.unlink(confPath); } catch { /* ignore */ }
  }
}

export function wsQueryFromDriver(driver: DriverSpec, device: DeviceInstance): Record<string, string> | undefined {
  const out: Record<string, string> = { ...(driver.transports.lan?.query ?? {}) };
  const pairingQuery = driver.auth?.pairing?.query;
  if (pairingQuery?.nameParam) {
    const raw = pairingQuery.nameFrom === "auth.name" ? (device.auth?.name || "Relay") : "Relay";
    out[pairingQuery.nameParam] = `{base64:${raw}}`;
  }
  if (pairingQuery?.tokenParam) out[pairingQuery.tokenParam] = "{token}";
  return Object.keys(out).length ? out : undefined;
}

export async function sendLan(driver: DriverSpec, device: DeviceInstance, payload: string, command?: DriverCommand, config?: RoomConfig, value?: string | number): Promise<CommandResult> {
  const lan = driver.transports.lan;
  if (!lan) return { ok: false, message: "No LAN transport on this driver" };
  const proto = String(lan.protocol || "");
  if (!proto || /[/\\:]/.test(proto)) return { ok: false, message: "Unknown protocol" };
  const known = new Set(["tcp", "udp", "http", "https", "websocket", "tls-websocket", "pjlink", "cast", "wol", "osc", "sacn", "ipmidi", "rtp-midi", "telegram"]);
  if (!known.has(proto)) return { ok: false, message: "Unknown protocol" };
  const face = readNicFace(device);
  const protoGate = nicFaceProtocolGate(face, proto, lan);
  if (!protoGate.ok) return protoGate;
  const needsTls = protocolNeedsTls(proto);
  const bind = planDeviceBindForDevice(device, config, undefined, { needsTls });
  if (!bind.ok) return bind;
  const localAddress = bind.localAddress;
  const rejectUnauthorized = bind.rejectUnauthorized;
  const tlsCa = bind.ca;
  const tlsPinCheck = bind.checkServerIdentity;
  const host = device.host;
  const skipUnicastHost = proto === "sacn" || (proto === "ipmidi" && lan.multicast !== false) || proto === "telegram";
  const localOk = device.driver === "relay-host.json" || driver.device.type === "host";
  if (!skipUnicastHost) {
    const hostGate = deviceHostAllowed(face, host, { localOk });
    if (!hostGate.ok) return hostGate;
  }
  const port = device.port ?? lan.port;
  const timeout = lan.timeoutMs ?? 3000;
  const encoding = wireEncoding(driver, command);
  await paceDevice(device.id, driver.pacing?.minIntervalMs);
  pushTrace(device.id, "tx", `${command?.namespace ? command.namespace.split(".").pop() + " " : ""}${payload.slice(0, 160)}`);
  let result: CommandResult;
  const wire = encodeWire(payload, encoding, lan.lineEnding ?? (lan.protocol === "pjlink" ? "\r" : undefined));
  if ("error" in wire) return { ok: false, message: wire.error };
  if (command?.httpMethod === "RPC") result = await sendRpcShutdown(host, device.auth?.user || device.auth?.username || "", device.auth?.password || "", localAddress);
  else if (lan.protocol === "wol") result = await sendWol(device.auth?.mac || "", host, localAddress);
  else if (lan.protocol === "cast") result = await sendCast(host, port, payload, timeout, command?.namespace, localAddress);
  else if (lan.protocol === "telegram") {
    const auth = device.auth || {};
    const cmdId = String(command?.id || "");
    const isSend = cmdId === "message.send" || cmdId === "telegram.send";
    if (isSend) {
      result = await telegramSendMessage({
        token: auth.token || "",
        chatId: auth.chat_id || "",
        text: String(value ?? payload ?? ""),
        localAddress,
        timeoutMs: timeout,
      });
    } else {
      // Probe / Authenticate / feedback: getMe (send-only MR1 — no getUpdates).
      result = await telegramGetMe({
        token: auth.token || "",
        localAddress,
        timeoutMs: timeout,
      });
    }
  }
  else if (lan.protocol === "http" || lan.protocol === "https") {
    const auth = device.auth || {};
    const ctx = { host, port, id: device.id };
    const path = renderPayload(command?.httpPath || lan.http?.path || "/", undefined, auth, ctx);
    const rawHeaders: Record<string, string> = {
      "content-type": lan.http?.contentType || "application/json",
      ...(lan.http?.headers ?? {}),
      ...(command?.httpHeaders ?? {}),
    };
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawHeaders)) {
      headers[key] = renderPayload(String(val ?? ""), undefined, auth, ctx);
    }
    const built = safeLanHttpUrl(lan.protocol, host, port, path);
    if (!built.ok) result = { ok: false, message: built.message };
    else result = await sendHttp(built.url, command?.httpMethod || lan.http?.method || "GET", payload, timeout, {
      maxMessageChars: lan.http?.contentType?.includes("xml") ? 64 * 1024 : undefined,
      headers,
      localAddress,
      rejectUnauthorized,
      ca: tlsCa,
      checkServerIdentity: tlsPinCheck,
    });
  } else if (lan.protocol === "websocket" || lan.protocol === "tls-websocket") {
    if (/[/:]/.test(String(lan.protocol))) result = { ok: false, message: "Unknown protocol" };
    else if (/^file:/i.test(lan.path || lan.http?.path || "")) result = { ok: false, message: "Invalid path" };
    else {
      const target = buildWsTarget({
        path: lan.path || lan.http?.path,
        query: wsQueryFromDriver(driver, device),
        port: device.port ?? lan.port,
        tls: lan.protocol === "tls-websocket",
        token: device.auth?.token,
      });
      result = await sendControlSocket({
        host,
        ...target,
        payload,
        timeout: command?.waitContains ? Math.max(timeout, 20000) : timeout,
        waitFor: command?.waitContains,
        handshake: lan.handshake,
        alsoSend: lan.alsoSend,
        alsoSendRaw: command?.alsoSend,
        localAddress,
        rejectUnauthorized: lan.protocol === "tls-websocket" ? rejectUnauthorized : true,
        ca: lan.protocol === "tls-websocket" ? tlsCa : undefined,
        checkServerIdentity: lan.protocol === "tls-websocket" ? tlsPinCheck : undefined,
      });
    }
  }
  else if (lan.protocol === "pjlink") result = await sendPjlink(host, port, payload, device.auth?.password || device.auth?.pin, timeout, localAddress);
  else if (lan.protocol === "osc") {
    const oscPort = Number(port || 9000);
    const ctx = { host, port: oscPort, id: device.id };
    const auth = device.auth || {};
    result = await sendOscCommand({
      host,
      port: oscPort,
      path: renderPayload(payload, value, auth, ctx),
      types: command?.osc?.types,
      values: (command?.osc?.values ?? []).map((v) => renderPayload(String(v ?? ""), value, auth, ctx)),
      localAddress,
    });
  }
  else if (lan.protocol === "sacn") {
    const auth = device.auth || {};
    const ctx = { host, port: 5568, id: device.id };
    const universe = Number(auth.universe || 1);
    result = await sendSacnCommand({
      universe,
      slot: command?.sacn?.slot,
      value: command?.sacn ? renderPayload(String(command.sacn.value ?? payload ?? "0"), value, auth, ctx) : undefined,
      cidKey: device.id || host || "relay",
      localAddress,
    });
  }
  else if (lan.protocol === "ipmidi") {
    const midiWire = encoding === "hex" ? wire : encodeWire(payload, "hex");
    if ("error" in midiWire) return { ok: false, message: midiWire.error };
    result = await sendIpmidi({
      buf: midiWire,
      multicast: lan.multicast !== false,
      host,
      port: Number(port || 21928),
      localAddress,
    });
  }
  else if (lan.protocol === "rtp-midi") {
    const midiWire = encoding === "hex" ? wire : encodeWire(payload, "hex");
    if ("error" in midiWire) return { ok: false, message: midiWire.error };
    const controlPort = Number(port || 5004);
    result = await sendRtpMidiCommand({
      host,
      controlPort,
      dataPort: lan.rtpMidi?.dataPort ?? controlPort + 1,
      midi: midiWire,
      keepMs: lan.session?.keepMs ?? 60_000,
      timeoutMs: timeout,
      localAddress,
    });
  }
  else if (lan.protocol === "udp") result = await sendUdp(host, Number(port), wire, localAddress); else if (lan.session && encoding !== "hex") {
    result = await tcpSessionWrite(device.id, host, port, wire, lan.session, device.auth || {}, timeout, localAddress);
  } else result = await tcpWrite(host, port, wire, timeout, encoding, localAddress);
  pushTrace(device.id, result.ok ? "rx" : "note", result.message);
  return result;
}

