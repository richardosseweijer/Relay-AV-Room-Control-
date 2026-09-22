import type { CommandResult, DriverCommand, DriverSpec } from "./types";
import { sleep } from "./engine-policy";

const paceClock = ((globalThis as typeof globalThis & { __relayPace__?: Map<string, number> }).__relayPace__ ??= new Map());

export async function paceDevice(id: string, minIntervalMs?: number) {
  const gap = Math.max(0, minIntervalMs ?? 0);
  if (!gap) return;
  const wait = (paceClock.get(id) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  paceClock.set(id, Date.now());
}

export function wireEncoding(driver: DriverSpec, command?: DriverCommand) {
  const lan = driver.transports.lan;
  return command?.payloadEncoding || lan?.payloadEncoding || lan?.encoding;
}

export function encodeWire(payload: string, encoding: string | undefined, lineEnding?: string): Buffer | { error: string } {
  const ending = lineEnding === undefined ? "" : lineEnding.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  if (encoding === "hex") {
    const hex = payload.replace(/[^0-9a-f]/gi, "");
    if (!hex.length || hex.length % 2) return { error: "Odd hex payload" };
    return Buffer.from(hex, "hex");
  }
  return Buffer.from(`${payload}${ending}`, "utf8");
}

export function decodeWire(buf: Buffer, encoding: string | undefined) {
  if (!buf.length) return "ok";
  if (encoding === "hex") return buf.toString("hex");
  return buf.toString("utf8").slice(0, 400);
}

export async function tcpWrite(host: string, port: number, payload: Buffer, timeout: number, encoding?: string, localAddress?: string): Promise<CommandResult> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, localAddress });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: "timeout" }); }, timeout);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    sock.on("connect", () => {
      // Connect-write-close on purpose. Persistent MIDI/TCP is KNOWN_ISSUES.md #4.
      sock.write(payload);
      setTimeout(() => sock.end(), 80);
    });
    sock.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    sock.on("close", () => { clearTimeout(timer); resolve({ ok: true, message: decodeWire(buf, encoding) }); });
  });
}

type SessionSock = { sock: import("node:net").Socket; timer?: ReturnType<typeof setTimeout>; ready: Promise<void> };
const sessions = ((globalThis as typeof globalThis & { __relayTcp__?: Map<string, SessionSock> }).__relayTcp__ ??= new Map());

export function tcpPoolSize() {
  return sessions.size;
}

export async function tcpSessionWrite(
  key: string,
  host: string,
  port: number,
  payload: Buffer,
  session: NonNullable<NonNullable<DriverSpec["transports"]["lan"]>["session"]>,
  auth: Record<string, string>,
  timeout: number,
  localAddress?: string,
): Promise<CommandResult> {
  const net = await import("node:net");
  let row = sessions.get(key);
  if (!row || row.sock.destroyed) {
    const sock = net.connect({ host, port, localAddress });
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (d) => {
      buf += d.toString();
      if (buf.length > 32768) buf = buf.slice(-8192);
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("login timeout")), timeout);
      sock.once("error", reject);
      sock.once("connect", async () => {
        try {
          const waitFor = async (token?: string) => {
            if (!token) return;
            const start = Date.now();
            while (!buf.toLowerCase().includes(token.toLowerCase())) {
              if (Date.now() - start > timeout) throw new Error(`no ${token}`);
              await sleep(50);
            }
          };
          await waitFor(session.loginPrompt);
          const user = auth[session.usernameFrom || "user"] || auth.user || "";
          if (user) sock.write(`${user}\r`);
          await waitFor(session.passwordPrompt);
          const pass = auth[session.passwordFrom || "password"] || auth.password || "";
          if (pass) sock.write(`${pass}\r`);
          if (session.readyContains) {
            try {
              await waitFor(session.readyContains);
            } catch {
              if (session.reply) sock.write(session.reply);
              try {
                await waitFor(session.readyContains);
              } catch {
                if (/password/i.test(buf)) throw new Error("Turn authentication off (got PASSWORD banner)");
              }
            }
          }
          clearTimeout(timer);
          resolve();
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
    row = { sock, ready };
    sessions.set(key, row);
  }
  try {
    await row.ready;
    let reply = "";
    const onData = (d: Buffer | string) => { reply += d.toString(); };
    row.sock.on("data", onData);
    row.sock.write(payload);
    await sleep(Math.min(800, Math.max(200, timeout / 8)));
    row.sock.off("data", onData);
    if (row.timer) clearTimeout(row.timer);
    row.timer = setTimeout(() => {
      row?.sock.destroy();
      sessions.delete(key);
    }, session.keepMs ?? 15000);
    return { ok: true, message: reply.slice(0, 300) || "ok" };
  } catch (err) {
    row.sock.destroy();
    sessions.delete(key);
    return { ok: false, message: err instanceof Error ? err.message : "session failed" };
  }
}
