import type { CommandResult } from "./types";

export function fillWsValue(raw: string, token?: string) {
  if (raw === "{token}") return token || "";
  const b64 = raw.match(/^\{base64:(.+)\}$/i);
  if (b64) return Buffer.from(b64[1]!).toString("base64");
  return raw;
}

export function buildWsTarget(opts: {
  path?: string;
  query?: Record<string, string>;
  port?: number;
  tls?: boolean;
  token?: string;
}): { path: string; port: number; tls: boolean } {
  const tls = Boolean(opts.tls);
  const port = Number(opts.port) || (tls ? 443 : 80);
  let path = opts.path || "/";
  if (/^file:/i.test(path)) path = "/";
  const params = new URLSearchParams();
  if (opts.query && Object.keys(opts.query).length) {
    for (const [key, val] of Object.entries(opts.query)) {
      const filled = fillWsValue(String(val ?? ""), opts.token);
      if (filled) params.set(key, filled);
    }
  }
  const qs = params.toString();
  if (qs) path += (path.includes("?") ? "&" : "?") + qs;
  return { path, port, tls };
}

function maskWsFrame(text: string) {
  const data = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length]) : Buffer.concat([Buffer.from([0x81, 0xfe]), Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])]);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

function decodeWsText(buf: Buffer) {
  if (buf.length < 2) return "";
  const len = buf[1]! & 0x7f;
  const start = len === 126 ? 4 : 2;
  return buf.slice(start).toString("utf8").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

function wsPong(payload: Buffer) {
  const mask = Buffer.from([0x21, 0x43, 0x65, 0x87]);
  const n = payload.length;
  const head = n < 126
    ? Buffer.from([0x8a, 0x80 | n])
    : Buffer.concat([Buffer.from([0x8a, 0xfe]), Buffer.from([(n >> 8) & 0xff, n & 0xff])]);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([head, mask, body]);
}

function decodeWsFrames(buf: Buffer, onPing?: (payload: Buffer) => void) {
  const idx = buf.indexOf("\r\n\r\n");
  let rest = idx >= 0 ? buf.subarray(idx + 4) : buf;
  let out = "";
  while (rest.length >= 2) {
    const opcode = rest[0]! & 0x0f;
    const masked = (rest[1]! & 0x80) !== 0;
    let len = rest[1]! & 0x7f;
    let off = 2;
    if (len === 126) {
      if (rest.length < 4) break;
      len = rest.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (rest.length < 10) break;
      const hi = rest.readUInt32BE(2);
      const lo = rest.readUInt32BE(6);
      if (hi !== 0 || lo > 4 * 1024 * 1024) break;
      len = lo;
      off = 10;
    }
    if (masked) off += 4;
    if (rest.length < off + len) break;
    let payload = Buffer.from(rest.subarray(off, off + len));
    if (masked) {
      const mask = rest.subarray(off - 4, off);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]!;
    }
    if (opcode === 9) onPing?.(payload);
    if (opcode === 1 || opcode === 0 || opcode === 2) out += payload.toString("utf8");
    rest = rest.subarray(off + len);
  }
  return out;
}

function waitWsBody(sock: import("node:net").Socket, timeout: number, test: (body: string) => boolean, seed = Buffer.alloc(0)): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = seed;
    const timer = setTimeout(() => {
      sock.off("data", onData);
      const body = decodeWsFrames(buf);
      if (test(body)) resolve(body);
      else reject(new Error("control timeout"));
    }, timeout);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 2 * 1024 * 1024) buf = buf.subarray(buf.length - 512 * 1024);
      const body = decodeWsFrames(buf);
      if (test(body)) {
        clearTimeout(timer);
        sock.off("data", onData);
        resolve(body);
      }
    };
    sock.on("data", onData);
    if (test(decodeWsFrames(buf))) {
      clearTimeout(timer);
      sock.off("data", onData);
      resolve(decodeWsFrames(buf));
    }
  });
}

const keepWs = ((globalThis as typeof globalThis & { __relayWs__?: Map<string, { sock: import("node:net").Socket; timer?: ReturnType<typeof setTimeout> }> }).__relayWs__ ??= new Map());

export function wsPoolSize() {
  return keepWs.size;
}

function bumpKeep(key: string, sock: import("node:net").Socket, ms = 20000) {
  const row = keepWs.get(key);
  if (row?.timer) clearTimeout(row.timer);
  if (row?.sock && row.sock !== sock && !row.sock.destroyed) row.sock.destroy();
  const next = { sock, timer: setTimeout(() => {
    sock.destroy();
    keepWs.delete(key);
  }, ms) };
  keepWs.set(key, next);
}

function waitNeedles(waitFor?: string) {
  return (waitFor ?? "").split("|").map((s) => s.trim()).filter(Boolean);
}

function bodyHasWait(body: string, waitFor?: string) {
  return waitNeedles(waitFor).some((n) => body.includes(n));
}

function extractJsonContaining(text: string, needle: string): string {
  const hit = waitNeedles(needle).find((n) => text.includes(n)) || "";
  if (!hit) {
    const i = text.indexOf("{");
    return i >= 0 ? text.slice(i) : text;
  }
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf("{", from);
    if (start < 0) break;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const blob = text.slice(start, i + 1);
          if (blob.includes(hit)) return blob;
          from = i + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
    from = start + 1;
  }
  const i = text.indexOf("{");
  return i >= 0 ? text.slice(i) : text;
}

export async function sendControlSocket(opts: {
  host: string;
  port: number;
  path: string;
  payload: string;
  timeout: number;
  tls: boolean;
  waitFor?: string;
  handshake?: { waitContains?: string; delayMs?: number };
  alsoSend?: { replace: Record<string, string> }[];
  alsoSendRaw?: string[];
}): Promise<CommandResult> {
  const key = `${opts.host}:${opts.port}:${opts.path.split("?")[0]}`;
  const live = keepWs.get(key);
  if (live && !live.sock.destroyed && opts.payload && !opts.waitFor) {
    try {
      live.sock.write(maskWsFrame(opts.payload));
      bumpKeep(key, live.sock);
      return { ok: true, message: "key sent" };
    } catch {
      live.sock.destroy();
      keepWs.delete(key);
    }
  }
  const mod = opts.tls ? await import("node:tls") : await import("node:net");
  const cryptoKey = (await import("node:crypto")).randomBytes(16).toString("base64");
  const req = `GET ${opts.path} HTTP/1.1\r\nHost: ${opts.host}:${opts.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${cryptoKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
  return new Promise((resolve) => {
    const sock = opts.tls
      ? (mod as typeof import("node:tls")).connect({ host: opts.host, port: opts.port, rejectUnauthorized: false })
      : (mod as typeof import("node:net")).connect({ host: opts.host, port: opts.port });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let sent = false;
    let token = "";
    let done = false;
    let tries = 0;
    let retryTick: ReturnType<typeof setInterval> | undefined;
    const onTimeout = () => {
      sock.off("data", onData);
      if (retryTick) clearInterval(retryTick);
      sock.destroy();
      if (done) return;
      done = true;
      const got = decodeWsFrames(buf).replace(/\s+/g, " ").slice(0, 180);
      const miss = opts.waitFor ? `no ${opts.waitFor}` : "control timeout";
      resolve({ ok: false, message: got ? `${miss} (${got})` : miss });
    };
    let timer = setTimeout(onTimeout, opts.timeout);
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, opts.timeout);
    };
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      sock.off("data", onData);
      clearTimeout(timer);
      if (retryTick) clearInterval(retryTick);
      buf = Buffer.alloc(0);
      if (ok) bumpKeep(key, sock);
      else sock.end();
      resolve({ ok, message });
    };
    sock.on("error", (err) => { sock.off("data", onData); clearTimeout(timer); keepWs.delete(key); if (!done) { done = true; resolve({ ok: false, message: err.message }); } });
    sock.on("connect", () => { if (!opts.tls) sock.write(req); });
    sock.on("secureConnect", () => sock.write(req));
    const fire = () => {
      try { sock.write(maskWsFrame(opts.payload)); } catch { /* ignore */ }
      for (const extra of opts.alsoSend ?? []) {
        let alt = opts.payload;
        for (const [from, to] of Object.entries(extra.replace ?? {})) alt = alt.split(from).join(to);
        if (alt !== opts.payload) {
          try { sock.write(maskWsFrame(alt)); } catch { /* ignore */ }
        }
      }
      for (const extra of opts.alsoSendRaw ?? []) {
        if (extra) {
          try { sock.write(maskWsFrame(extra)); } catch { /* ignore */ }
        }
      }
      arm();
    };
    const handshakeWait = opts.handshake?.waitContains;
    const handshakeDelay = opts.handshake?.delayMs ?? 0;
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 2 * 1024 * 1024) buf = buf.subarray(buf.length - 512 * 1024);
      if (!upgraded) {
        const text = buf.toString("utf8");
        if (!/101 Switching Protocols/i.test(text)) return;
        upgraded = true;
        if (!handshakeWait && opts.payload && !sent) {
          sent = true;
          if (opts.waitFor) setTimeout(fire, handshakeDelay);
          else {
            fire();
            finish(true, "key sent");
            return;
          }
        }
      }
      const body = decodeWsFrames(buf, (ping) => { try { sock.write(wsPong(ping)); } catch { /* ignore */ } });
      const found = body.match(/"token"\s*:\s*"([^"]+)"/)?.[1];
      if (found) token = found;
      const ready = handshakeWait ? bodyHasWait(body, handshakeWait) : upgraded;
      if (ready && opts.payload && !sent) {
        sent = true;
        if (opts.waitFor) {
          setTimeout(fire, handshakeDelay || 500);
          retryTick = setInterval(() => {
            if (done || ++tries >= 2) { if (retryTick) clearInterval(retryTick); return; }
            fire();
          }, 2500);
        } else {
          const go = () => { fire(); finish(true, token ? `token ${token}` : "key sent"); };
          if (handshakeDelay) setTimeout(go, handshakeDelay);
          else go();
          return;
        }
      }
      if (opts.waitFor && sent && bodyHasWait(body, opts.waitFor)) {
        finish(true, extractJsonContaining(body, opts.waitFor));
        return;
      }
      if (ready && !opts.payload) {
        finish(Boolean(token), token ? `token ${token}` : "waiting for pairing");
      }
    };
    sock.on("data", onData);
  });
}

