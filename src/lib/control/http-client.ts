import http from "node:http";
import https from "node:https";

export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export async function fetchTextBounded(
  url: string,
  init: RequestInit,
  timeout: number,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) return { ok: false, status: res.status, text: "response too large" };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel("response too large");
          return { ok: false, status: res.status, text: "response too large" };
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: res.ok, status: res.status, text: new TextDecoder().decode(bytes) };
  } catch (err) {
    const timedOut = ctrl.signal.aborted;
    return {
      ok: false,
      status: 0,
      text: timedOut ? "request timed out" : (err instanceof Error ? err.message : "request failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP/1.1 with caller header names (UPnP needs SOAPAction, not soapaction). */
export function requestHttpExact(
  url: string,
  method: string,
  body: string,
  headers: Record<string, string>,
  timeout: number,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, text: "bad url" });
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const payload = body || "";
    const hdrs: Record<string, string> = { ...headers };
    if (payload && !Object.keys(hdrs).some((k) => k.toLowerCase() === "content-length")) {
      hdrs["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: method.toUpperCase(),
      headers: hdrs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          overflow = true;
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (overflow) {
          resolve({ ok: false, status: res.statusCode ?? 0, text: "response too large" });
          return;
        }
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve({ ok: false, status: 0, text: "request timed out" });
    });
    req.on("error", (err) => resolve({ ok: false, status: 0, text: err.message }));
    if (payload && method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") req.write(payload);
    req.end();
  });
}