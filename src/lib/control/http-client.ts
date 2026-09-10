const MAX_RESPONSE_BYTES = 64 * 1024;

export async function fetchTextBounded(url: string, init: RequestInit, timeout: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_RESPONSE_BYTES) return { ok: false, status: res.status, text: "response too large" };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
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
  } finally {
    clearTimeout(timer);
  }
}
