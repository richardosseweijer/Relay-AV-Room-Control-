import type { RoomConfig, RoomVariable } from "./types";
import { fetchTextBounded } from "./http-client.ts";

export const FOYER_KIND_ID = "foyer.kind";
export const FOYER_TITLE_ID = "foyer.title";
export const FOYER_START_ID = "foyer.start";
export const FOYER_END_ID = "foyer.end";
export const DEFAULT_FOYER_PEER_URL = "http://127.0.0.1:8080";

export type FoyerSessionKind = "now" | "next" | "none";

export type FoyerSession = {
  kind: "now" | "next";
  title: string;
  startIso: string;
  endIso: string;
};

const TIMEOUT_MS = 4_000;

export function foyerSessionVars(): RoomVariable[] {
  return [
    { id: FOYER_KIND_ID, label: "Foyer session", kind: "enum", values: ["now", "next", "none"], default: "none" },
    { id: FOYER_TITLE_ID, label: "Foyer title", kind: "text", default: "" },
    { id: FOYER_START_ID, label: "Foyer start", kind: "text", default: "" },
    { id: FOYER_END_ID, label: "Foyer end", kind: "text", default: "" },
  ];
}

export function withFoyerSessionVars(config: RoomConfig): RoomConfig {
  const list = [...(config.variables ?? [])];
  for (const baked of foyerSessionVars()) {
    const i = list.findIndex((item) => item.id === baked.id);
    if (i < 0) list.push({ ...baked, tag: null });
    else {
      const cur = list[i]!;
      list[i] = { ...cur, ...baked, tag: cur.tag ?? null };
    }
  }
  return { ...config, variables: list };
}

export function applyFoyerSession(vars: Record<string, string | number>, session: FoyerSession | null) {
  if (!session) {
    vars[FOYER_KIND_ID] = "none";
    vars[FOYER_TITLE_ID] = "";
    vars[FOYER_START_ID] = "";
    vars[FOYER_END_ID] = "";
    return;
  }
  vars[FOYER_KIND_ID] = session.kind;
  vars[FOYER_TITLE_ID] = session.title;
  vars[FOYER_START_ID] = session.startIso;
  vars[FOYER_END_ID] = session.endIso;
}

export function hostnameOf(host: string) {
  const t = host.trim().toLowerCase();
  if (!t) return "";
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    return end > 0 ? t.slice(1, end) : t;
  }
  if (/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(t)) return t.split(":")[0];
  if (t.includes(":") && !t.startsWith("::") && t.split(":").length === 2) return t.split(":")[0];
  return t;
}

export function isLoopbackHostname(host: string) {
  const name = hostnameOf(host);
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

export function foyerPeerEndpoint(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  try {
    return new URL("/api/peer", withSlash);
  } catch {
    try {
      return new URL("/api/peer", `http://${withSlash.replace(/^\/+/, "")}`);
    } catch {
      return null;
    }
  }
}

export function parseFoyerSession(payload: unknown): FoyerSession | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as { session?: unknown };
  const session = row.session;
  if (!session || typeof session !== "object") return null;
  const item = session as Record<string, unknown>;
  const kind = item.kind === "now" || item.kind === "next" ? item.kind : null;
  const title = typeof item.title === "string" ? item.title : "";
  const startIso = typeof item.startIso === "string" ? item.startIso : "";
  const endIso = typeof item.endIso === "string" ? item.endIso : "";
  if (!kind || !startIso || !endIso) return null;
  return { kind, title, startIso, endIso };
}

export async function fetchFoyerSession(opts: {
  url: string;
  secret: string;
}): Promise<{ ok: boolean; session: FoyerSession | null; message: string }> {
  const endpoint = foyerPeerEndpoint(opts.url);
  if (!endpoint) return { ok: false, session: null, message: "No Foyer URL" };
  if (!isLoopbackHostname(endpoint.hostname)) return { ok: false, session: null, message: "Foyer URL must be loopback" };
  // Loopback GET is unsigned. A mismatched peer secret must not hide the session.
  const res = await fetchTextBounded(endpoint.toString(), { method: "GET" }, TIMEOUT_MS);
  if (!res.ok) return { ok: false, session: null, message: res.text || `Foyer ${res.status}` };
  try {
    const payload = JSON.parse(res.text) as { ok?: boolean; session?: unknown };
    if (!payload?.ok) return { ok: false, session: null, message: "Foyer denied" };
    return { ok: true, session: parseFoyerSession(payload), message: "ok" };
  } catch {
    return { ok: false, session: null, message: "Bad Foyer JSON" };
  }
}
