/** Browser-side H.264 access units. No Node imports. Annex-B in, AVCC units out. */

export type LiveUnit = {
  key: boolean;
  data: Uint8Array;
};

export type AnnexPush = {
  units: LiveUnit[];
  avcC?: Uint8Array;
  reject?: "hevc";
};

type Parser = {
  buf: Uint8Array;
  sps?: Uint8Array;
  pps?: Uint8Array;
  pending: Uint8Array[];
  hasVcl: boolean;
  seen: number;
  rejected: boolean;
};

const AVC_PROFILES = new Set([66, 77, 88, 100, 110, 122, 144, 244]);

export function createAnnexParser(): Parser {
  return { buf: new Uint8Array(0), pending: [], hasVcl: false, seen: 0, rejected: false };
}

export function avcCFromSpsPps(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out[0] = 1;
  out[1] = sps[1] ?? 0x42;
  out[2] = sps[2] ?? 0;
  out[3] = sps[3] ?? 0x1e;
  out[4] = 0xff;
  out[5] = 0xe1;
  out[6] = (sps.length >> 8) & 0xff;
  out[7] = sps.length & 0xff;
  out.set(sps, 8);
  const at = 8 + sps.length;
  out[at] = 1;
  out[at + 1] = (pps.length >> 8) & 0xff;
  out[at + 2] = pps.length & 0xff;
  out.set(pps, at + 3);
  return out;
}

export function codecFromAvcC(avcC: Uint8Array): string {
  const hex = (n: number) => (n & 0xff).toString(16).padStart(2, "0").toUpperCase();
  return `avc1.${hex(avcC[1] ?? 0)}${hex(avcC[2] ?? 0)}${hex(avcC[3] ?? 0)}`;
}

/** Keep the newest item. A late picture is not queued behind it. */
export function dropLateUnits<T>(pending: readonly T[]): T[] {
  if (!pending.length) return [];
  return [pending[pending.length - 1]!];
}

function concat(a: Uint8Array, b: Uint8Array) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function findStart(buf: Uint8Array, from: number): { at: number; sc: number } | null {
  for (let i = from; i + 2 < buf.length; i++) {
    if (buf[i] !== 0 || buf[i + 1] !== 0) continue;
    if (buf[i + 2] === 1) return { at: i, sc: 3 };
    if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) return { at: i, sc: 4 };
  }
  return null;
}

function nalType(nal: Uint8Array) {
  return nal[0]! & 0x1f;
}

function isHevc(nal: Uint8Array) {
  if (!nal.length) return false;
  if (nalType(nal) === 0) return true;
  if (nalType(nal) === 7 && !AVC_PROFILES.has(nal[1] ?? 0)) return true;
  return false;
}

function toAvcc(nals: Uint8Array[]) {
  let size = 0;
  for (const nal of nals) size += 4 + nal.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const nal of nals) {
    const len = nal.length;
    out[at] = (len >>> 24) & 0xff;
    out[at + 1] = (len >>> 16) & 0xff;
    out[at + 2] = (len >>> 8) & 0xff;
    out[at + 3] = len & 0xff;
    out.set(nal, at + 4);
    at += 4 + len;
  }
  return out;
}

function closeUnit(state: Parser): LiveUnit | null {
  if (!state.hasVcl) {
    state.pending = [];
    return null;
  }
  const key = state.pending.some((nal) => nalType(nal) === 5);
  const nals = state.pending;
  state.pending = [];
  state.hasVcl = false;
  return { key, data: toAvcc(nals) };
}

function takeNal(state: Parser, nal: Uint8Array, units: LiveUnit[]): "ok" | "hevc" {
  if (!nal.length) return "ok";
  if (isHevc(nal)) return "hevc";
  const type = nalType(nal);
  if (type === 7) state.sps = nal;
  else if (type === 8) state.pps = nal;
  const vcl = type === 1 || type === 5;
  if (type === 9 || (vcl && state.hasVcl)) {
    const unit = closeUnit(state);
    if (unit) units.push(unit);
  }
  if (type === 9) return "ok";
  state.pending.push(nal);
  if (vcl) state.hasVcl = true;
  return "ok";
}

export function pushAnnexB(state: Parser, chunk: Uint8Array): AnnexPush {
  if (state.rejected) return { units: [], reject: "hevc" };
  const merged = concat(state.buf, chunk);
  state.seen += chunk.length;
  const units: LiveUnit[] = [];
  let start = findStart(merged, 0);
  if (!start) {
    state.buf = merged.slice(Math.max(0, merged.length - 4));
    return done(state, units);
  }
  while (start) {
    const nalAt = start.at + start.sc;
    const next = findStart(merged, nalAt);
    if (!next) {
      state.buf = merged.slice(start.at);
      return done(state, units);
    }
    const nal = merged.slice(nalAt, next.at);
    if (takeNal(state, nal, units) === "hevc") {
      state.rejected = true;
      state.buf = new Uint8Array(0);
      return { units: [], reject: "hevc" };
    }
    start = next;
  }
  state.buf = new Uint8Array(0);
  return done(state, units);
}

function done(state: Parser, units: LiveUnit[]): AnnexPush {
  if (state.seen > 65536 && !state.sps) return { units, reject: "hevc" };
  const avcC = state.sps && state.pps ? avcCFromSpsPps(state.sps, state.pps) : undefined;
  return avcC ? { units, avcC } : { units };
}
