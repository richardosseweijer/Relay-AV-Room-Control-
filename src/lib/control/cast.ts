import type { CommandResult } from "./types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractCastApp(buf: Buffer): string | undefined {
  const text = buf.toString("utf8");
  return text.match(/"displayName"\s*:\s*"([^"]+)"/)?.[1];
}

function extractCastVolume(buf: Buffer): number | undefined {
  const n = buf.toString("utf8").match(/"volume"\s*:\s*\{[^}]{0,120}"level"\s*:\s*([0-9.]+)/)?.[1];
  return n !== undefined && Number.isFinite(Number(n)) ? Number(n) : undefined;
}

function extractCastType(buf: Buffer): string | undefined {
  return buf.toString("utf8").match(/"type"\s*:\s*"([^"]+)"/)?.[1];
}

function castStatusJson(buf: Buffer): string {
  const app = extractCastApp(buf) || "idle";
  const type = extractCastType(buf) || "RECEIVER_STATUS";
  const level = extractCastVolume(buf);
  return JSON.stringify({
    type,
    displayName: app,
    status: {
      applications: [{ displayName: app }],
      volume: { level: level ?? 0 },
    },
  });
}

function extractCastTransport(buf: Buffer): string | undefined {
  const text = buf.toString("utf8");
  const apps = [...text.matchAll(/"appId"\s*:\s*"([^"]+)"[\s\S]{0,500}?"transportId"\s*:\s*"([^"]+)"/g)];
  const hit = apps.find((row) => row[1] !== "E8C28D3C") || apps[0];
  return hit?.[2] || text.match(/"transportId"\s*:\s*"([^"]+)"/)?.[1];
}

function extractCastMediaSession(buf: Buffer): number | undefined {
  const n = buf.toString("utf8").match(/"mediaSessionId"\s*:\s*(\d+)/)?.[1];
  return n ? Number(n) : undefined;
}

function castFrame(ns: string, body: string, dest = "receiver-0") {
  const parts: Buffer[] = [];
  const putVarint = (tag: number, n: number) => {
    const out = [tag];
    let v = n >>> 0;
    while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
    parts.push(Buffer.from(out));
  };
  const putBytes = (tag: number, data: Buffer) => {
    const head = [tag];
    let len = data.length;
    while (len > 0x7f) { head.push((len & 0x7f) | 0x80); len >>>= 7; }
    head.push(len);
    parts.push(Buffer.concat([Buffer.from(head), data]));
  };
  putVarint(8, 0);
  putBytes(18, Buffer.from("sender-0"));
  putBytes(26, Buffer.from(dest));
  putBytes(34, Buffer.from(ns));
  putVarint(40, 0);
  putBytes(50, Buffer.from(body));
  const proto = Buffer.concat(parts);
  const out = Buffer.alloc(4 + proto.length);
  out.writeUInt32BE(proto.length, 0);
  proto.copy(out, 4);
  return out;
}

type CastLive = {
  sock: import("node:tls").TLSSocket;
  timer?: ReturnType<typeof setTimeout>;
  req: number;
  transportId?: string;
  mediaSessionId?: number;
};

export function castPoolSize() { return keepCast.size; }

const keepCast = ((globalThis as typeof globalThis & { __relayCast__?: Map<string, CastLive> }).__relayCast__ ??= new Map());
const CAST_CONN = "urn:x-cast:com.google.cast.tp.connection";
const CAST_BEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const CAST_RECV = "urn:x-cast:com.google.cast.receiver";
const CAST_MEDIA = "urn:x-cast:com.google.cast.media";

function bumpCast(key: string, live: CastLive) {
  if (live.timer) clearTimeout(live.timer);
  live.timer = setTimeout(() => { live.sock.destroy(); keepCast.delete(key); }, 25000);
}

function waitCast(sock: import("node:tls").TLSSocket, timeout: number, test: (buf: Buffer) => boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      sock.off("data", onData);
      if (test(buf)) resolve(buf);
      else reject(new Error("Cast timeout"));
    }, timeout);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (test(buf)) {
        clearTimeout(timer);
        sock.off("data", onData);
        resolve(buf);
      }
    };
    sock.on("data", onData);
  });
}

async function ensureCast(host: string, port: number, timeout: number): Promise<CastLive> {
  const key = `${host}:${port}`;
  const live = keepCast.get(key);
  if (live && !live.sock.destroyed) {
    try {
      live.sock.write(castFrame(CAST_BEAT, '{"type":"PING"}'));
      bumpCast(key, live);
      return live;
    } catch {
      live.sock.destroy();
      keepCast.delete(key);
    }
  }
  const tls = await import("node:tls");
  const sock = tls.connect({ host, port, rejectUnauthorized: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Cast connect timeout")), timeout);
    sock.once("error", (err) => { clearTimeout(timer); reject(err); });
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      sock.write(castFrame(CAST_CONN, '{"type":"CONNECT","origin":{}}'));
      sock.write(castFrame(CAST_BEAT, '{"type":"PING"}'));
      resolve();
    });
  });
  const row: CastLive = { sock, req: 1 };
  keepCast.set(key, row);
  bumpCast(key, row);
  return row;
}

function nextCastReq(live: CastLive) {
  live.req = (live.req || 1) + 1;
  return live.req;
}

function withCastRequestId(json: string, id: number) {
  if (/"requestId"/.test(json)) return json.replace(/"requestId"\s*:\s*\d+/, `"requestId":${id}`);
  return json.replace(/\}$/, `,"requestId":${id}}`);
}

export async function sendCast(host: string, port: number, payload: string, timeout: number, namespace?: string): Promise<CommandResult> {
  let json = payload.trim().startsWith("{") ? payload.trim() : '{"type":"GET_STATUS"}';
  const media = namespace === CAST_MEDIA || /"(PLAY|PAUSE|QUEUE_NEXT|QUEUE_PREV|SEEK)"/.test(json);
  const ns = namespace || (media ? CAST_MEDIA : CAST_RECV);
  try {
    const live = await ensureCast(host, port, timeout);
    const key = `${host}:${port}`;
    const waitStatus = (wantMedia: boolean) => waitCast(live.sock, timeout, (buf) => {
      const text = buf.toString("utf8");
      if (wantMedia) return /MEDIA_STATUS/i.test(text) && /mediaSessionId/i.test(text);
      return /RECEIVER_STATUS/i.test(text) || Boolean(extractCastApp(buf));
    });
    if (media) {
      live.sock.write(castFrame(CAST_RECV, withCastRequestId('{"type":"GET_STATUS"}', nextCastReq(live))));
      const recv = await waitStatus(false);
      const transport = extractCastTransport(recv);
      if (!transport) return { ok: false, message: "No Cast app running" };
      if (live.transportId !== transport) {
        live.sock.write(castFrame(CAST_CONN, '{"type":"CONNECT","origin":{}}', transport));
        live.transportId = transport;
        await sleep(80);
      }
      live.sock.write(castFrame(CAST_MEDIA, withCastRequestId('{"type":"GET_STATUS"}', nextCastReq(live)), transport));
      const mediaBuf = await waitStatus(true).catch(() => Buffer.alloc(0));
      const session = extractCastMediaSession(mediaBuf);
      if (!session) return { ok: false, message: "No media session" };
      live.mediaSessionId = session;
      json = withCastRequestId(json, nextCastReq(live));
      json = /"mediaSessionId"/.test(json)
        ? json.replace(/"mediaSessionId"\s*:\s*\d+/, `"mediaSessionId":${session}`)
        : json.replace(/\}$/, `,"mediaSessionId":${session}}`);
      live.sock.write(castFrame(CAST_MEDIA, json, transport));
      bumpCast(key, live);
      await sleep(200);
      return { ok: true, message: `session ${session}` };
    }
    json = withCastRequestId(json, nextCastReq(live));
    live.sock.write(castFrame(ns, json));
    bumpCast(key, live);
    if (!/"GET_STATUS"/.test(json)) {
      await sleep(200);
      return { ok: true, message: "sent" };
    }
    const buf = await waitStatus(false);
    return { ok: true, message: castStatusJson(buf) };
  } catch (err) {
    keepCast.get(`${host}:${port}`)?.sock.destroy();
    keepCast.delete(`${host}:${port}`);
    return { ok: false, message: err instanceof Error ? err.message : "Cast failed" };
  }
}

