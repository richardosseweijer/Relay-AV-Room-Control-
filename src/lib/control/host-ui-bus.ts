/**
 * In-process pub/sub for panel host UI overlays (block/toast/lock/dim/page).
 * SSE at /api/host fans out mem.host after applyHost (and fail-clear paths).
 * Soft-fail: a bad listener must not break applyHost / macros.
 */
import type { HostUi } from "./types";

export type HostUiListener = (host: HostUi) => void;

const g = globalThis as typeof globalThis & {
  __relayHostUiListeners__?: Set<HostUiListener>;
};

function listeners(): Set<HostUiListener> {
  if (!g.__relayHostUiListeners__) g.__relayHostUiListeners__ = new Set();
  return g.__relayHostUiListeners__;
}

/** Public JSON shape for SSE / panel apply (timestamps included when set). */
export function hostUiPublic(host: HostUi | null | undefined): HostUi {
  const h = host ?? { dim: false, locked: false, toast: null, block: null, pageId: null };
  return {
    dim: Boolean(h.dim),
    locked: Boolean(h.locked),
    toast: h.toast ?? null,
    toastAt: h.toastAt,
    block: h.block ?? null,
    blockAt: h.blockAt,
    pageId: h.pageId ?? null,
    pageAt: h.pageAt,
    fullscreenAt: h.fullscreenAt,
  };
}

export function publishHostUi(host: HostUi | null | undefined) {
  const payload = hostUiPublic(host);
  for (const fn of listeners()) {
    try {
      fn(payload);
    } catch {
      /* soft-fail secondary listener */
    }
  }
}

export function subscribeHostUi(fn: HostUiListener): () => void {
  listeners().add(fn);
  return () => {
    listeners().delete(fn);
  };
}

/** Test helper */
export function hostUiListenerCount() {
  return listeners().size;
}

/** Test helper */
export function hostUiListenersReset() {
  listeners().clear();
}

/** Clear block overlay (macro fail path) and notify tablets. */
export function clearHostBlock(host: HostUi) {
  if (!host.block) return false;
  host.block = null;
  host.blockAt = Date.now();
  publishHostUi(host);
  return true;
}
