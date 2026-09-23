import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateVenueTls, getEditorConfig, getVenueTlsStatus, importBundle, listLanNics, rebootHost, restartHost, updateHost } from "@/lib/control/actions";
import { liveNicIpv4Label } from "@/lib/control/nic-live-ip";
import {
  venueTlsCaInstallHintList,
  venueTlsGenerateGate,
  venueTlsSanMismatch,
  venueTlsStatusLines,
} from "@/lib/control/venue-tls-ui";
import type { RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { FOYER_END_ID, FOYER_KIND_ID, FOYER_START_ID, FOYER_TITLE_ID } from "@/lib/control/foyer-peer";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { ROOM_THEME_LABELS, resolveRoomTheme, type RoomTheme } from "@/lib/theme";

const TIMEZONES = ["system", "Europe/Brussels", "Europe/Amsterdam", "Europe/London", "Europe/Berlin", "UTC", "America/New_York"];

type NicRow = { index: number; name: string; ipv4: string | null; label: string };

function nicKey(name?: string | null, index?: number | null) {
  if (name) return `name:${name}`;
  if (index != null && Number.isFinite(index)) return `index:${index}`;
  return "";
}

function withStoredNic(nics: NicRow[], name?: string | null, index?: number | null): NicRow[] {
  const trimmed = String(name ?? "").trim();
  if (!trimmed || trimmed === "__none__") return nics;
  if (nics.some((row) => row.name === trimmed)) return nics;
  return [...nics, { index: index ?? -1, name: trimmed, ipv4: null, label: `${trimmed} (not listed now)` }];
}

function isOutboundNone(name?: string | null, index?: number | null) {
  const trimmed = String(name ?? "").trim();
  if (trimmed === "__none__") return true;
  if (trimmed) return false;
  return index == null || !Number.isFinite(Number(index));
}

export function RoomTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  refresh: () => Promise<RoomSnapshot | null | undefined>;
  setDraft: (c: RoomConfig) => void;
  importRef: RefObject<HTMLInputElement | null>;
  setGate: (g: { action: "wipe"; pin: string } | null) => void;
  downloadRoomFile: (draft: RoomConfig, drivers: RoomSnapshot["drivers"]) => void;
}) {
  const { draft, snap, token, update, flash, refresh, setDraft, importRef, setGate, downloadRoomFile } = props;
  const [nics, setNics] = useState<NicRow[]>([]);
  const [nicError, setNicError] = useState("");
  const loadNics = useCallback(async () => {
    try {
      const res = await listLanNics({ data: { token: token || "" } });
      if (res.ok) {
        setNics(res.nics);
        setNicError(res.nics.length ? "" : "No NICs listed (loopback is skipped).");
      } else {
        setNics([]);
        setNicError(res.message || "Could not list NICs. Unlock, then Refresh.");
      }
    } catch {
      setNics([]);
      setNicError("Could not list NICs. Unlock, then Refresh.");
    }
  }, [token]);
  useEffect(() => { void loadNics(); }, [loadNics]);

  type VenueTlsStatusView = {
    present?: boolean;
    active?: boolean;
    sanIp?: string | null;
    leafNotAfter?: string | null;
    leafFingerprint256?: string | null;
  } | null;
  const [venueTls, setVenueTls] = useState<VenueTlsStatusView>(null);
  const [venueTlsBusy, setVenueTlsBusy] = useState(false);
  const [venueTlsMsg, setVenueTlsMsg] = useState("");
  const loadVenueTls = useCallback(async () => {
    try {
      const res = await getVenueTlsStatus({ data: { token: token || "" } });
      if (res.ok) {
        setVenueTls(res.status as VenueTlsStatusView);
        setVenueTlsMsg("");
      } else {
        setVenueTls(null);
        setVenueTlsMsg(res.message || "Unlock config to read venue TLS status.");
      }
    } catch {
      setVenueTls(null);
      setVenueTlsMsg("Could not load venue TLS status.");
    }
  }, [token]);
  useEffect(() => { void loadVenueTls(); }, [loadVenueTls]);

  const nicChoices = useMemo(
    () => withStoredNic(
      withStoredNic(nics, draft.room.avLanNicName, draft.room.avLanNicIndex),
      draft.room.outboundNicName,
      draft.room.outboundNicIndex,
    ),
    [nics, draft.room.avLanNicName, draft.room.avLanNicIndex, draft.room.outboundNicName, draft.room.outboundNicIndex],
  );
  const outboundNone = isOutboundNone(draft.room.outboundNicName, draft.room.outboundNicIndex);
  const sameNic = !outboundNone && Boolean(
    (draft.room.avLanNicName && draft.room.outboundNicName && draft.room.avLanNicName === draft.room.outboundNicName)
    || (draft.room.avLanNicName == null && draft.room.outboundNicName == null
      && draft.room.avLanNicIndex != null && draft.room.avLanNicIndex === draft.room.outboundNicIndex),
  );
  const outboundPick = nicChoices.find((row) => nicKey(row.name, row.index) === nicKey(draft.room.outboundNicName, draft.room.outboundNicIndex));
  const outboundNoIp = !outboundNone && outboundPick != null && !outboundPick.ipv4;
  const avUnset = !String(draft.room.avLanNicName ?? "").trim() && (draft.room.avLanNicIndex == null || !Number.isFinite(Number(draft.room.avLanNicIndex)));
  const avPick = nicChoices.find((row) => nicKey(row.name, row.index) === nicKey(draft.room.avLanNicName, draft.room.avLanNicIndex));
  const avLiveIp = liveNicIpv4Label({ unset: avUnset, ipv4: avPick?.ipv4, unsetText: "—" });
  const outboundLiveIp = liveNicIpv4Label({ unset: outboundNone, ipv4: outboundPick?.ipv4 });
  const generateGate = venueTlsGenerateGate({
    outboundNone,
    liveIpv4: outboundLiveIp.kind === "ip" ? outboundLiveIp.ipv4 : null,
  });
  const sanMismatch = venueTlsSanMismatch({
    present: Boolean(venueTls?.present),
    sanIp: venueTls?.sanIp ?? null,
    liveIpv4: outboundLiveIp.kind === "ip" ? outboundLiveIp.ipv4 : null,
  });
  const tlsLines = venueTlsStatusLines(venueTls ?? { present: false });
  const caHints = venueTlsCaInstallHintList();
  const downloadVenueCa = async () => {
    if (!token) {
      flash("Download failed", "Config lock required");
      return;
    }
    try {
      const res = await fetch("/api/venue-tls-ca", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        flash("Download failed", body.message || `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "relay-venue-ca.cert.pem";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash("CA download started", "Install on tablets that will open the venue HTTPS URL. Same origin as this page (works after NIC2 click-through).");
    } catch {
      flash("Download failed", "Could not fetch CA cert from this origin.");
    }
  };
  const runGenerateVenueTls = async () => {
    if (!generateGate.allowed) {
      flash("Generate skipped", generateGate.reason || "Cannot generate");
      return;
    }
    setVenueTlsBusy(true);
    setVenueTlsMsg("");
    try {
      const res = await generateVenueTls({ data: { token: token || "" } });
      if (res.ok) {
        setVenueTls(("status" in res ? res.status : null) as VenueTlsStatusView);
        const reloadNote =
          "reload" in res && res.reload?.reloaded
            ? "Venue HTTPS reloaded."
            : "reload" in res && res.reload?.skipped
              ? `Venue HTTPS: ${res.reload.reason || "skipped"}`
              : "";
        flash("Venue certificate generated", reloadNote || "PEMs written and room paths wired.");
        await loadVenueTls();
      } else {
        const msg = res.message || "Generate failed";
        setVenueTlsMsg(msg);
        flash("Generate failed", msg);
      }
    } catch {
      setVenueTlsMsg("Generate failed");
      flash("Generate failed", "Request error");
    } finally {
      setVenueTlsBusy(false);
    }
  };
  const pickNic = (which: "av" | "out", key: string) => {
    update((c) => {
      if (!key) {
        if (which === "av") { c.room.avLanNicIndex = null; c.room.avLanNicName = null; }
        else { c.room.outboundNicIndex = null; c.room.outboundNicName = null; }
        return;
      }
      const nic = nicChoices.find((row) => nicKey(row.name, row.index) === key);
      if (!nic) return;
      if (which === "av") { c.room.avLanNicIndex = nic.index < 0 ? null : nic.index; c.room.avLanNicName = nic.name; }
      else { c.room.outboundNicIndex = nic.index < 0 ? null : nic.index; c.room.outboundNicName = nic.name; }
    });
  };
  return (
    <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Room name<input className={fieldClass()} value={draft.room.name} onChange={(e) => update((c) => { c.room.name = e.target.value; })} /></label>
            <p className="grid gap-1 text-sm text-muted">Relay version<span className="font-mono text-fg">{snap.version || "—"}</span></p>
            <label className="grid gap-1 text-sm text-muted">Theme
              <select className={fieldClass()} value={resolveRoomTheme(draft.room.theme)} onChange={(e) => update((c) => { c.room.theme = e.target.value as RoomTheme; })}>
                {(Object.keys(ROOM_THEME_LABELS) as RoomTheme[]).map((id) => (
                  <option key={id} value={id}>{ROOM_THEME_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Idle dim (s)
              <InputNum min={0} value={draft.room.idleDimSeconds} onNumber={(n) => update((c) => { if (n == null) return; c.room.idleDimSeconds = Math.max(0, n); })} />
              <span className="text-xs">0 = never</span>
            </label>
            <label className="grid gap-1 text-sm text-muted">Clock
              <select className={fieldClass()} value={draft.room.network?.timezone ?? "system"} onChange={(e) => update((c) => { c.room.network.timezone = e.target.value; })}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone === "system" ? "This computer" : zone}</option>)}
              </select>
              <span className="text-xs">Schedules use this host’s clock. Set the OS time if it is wrong.</span>
            </label>

            <article className="sm:col-span-2 grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Networks</p>
                <Button size="sm" variant="secondary" onClick={() => void loadNics()}>Refresh NICs</Button>
              </div>
              <p className="sm:col-span-2 text-xs text-muted">On two NICs, bind device I/O to AV-LAN and GitHub update to LAN (internet). On a one-NIC box pick that NIC for update, or None for air-gapped rooms. Same NIC is allowed for testing.</p>
              <label className="grid gap-1 text-sm text-muted">AV-LAN
                <select className={fieldClass()} value={nicKey(draft.room.avLanNicName, draft.room.avLanNicIndex)} onChange={(e) => pickNic("av", e.target.value)}>
                  <option value="">Default (kernel)</option>
                  {nicChoices.map((nic) => <option key={`av-${nic.name}`} value={nicKey(nic.name, nic.index)}>{nic.label}</option>)}
                </select>
                <span className="text-xs">
                  Live IP:{" "}
                  {avLiveIp.kind === "ip"
                    ? <span className="font-mono text-fg select-all">{avLiveIp.ipv4}</span>
                    : <span className="text-muted">{avLiveIp.text}</span>}
                  {" · "}Device sockets and tablets. No default route on a two-NIC room PC.
                </span>
              </label>
              <label className="grid gap-1 text-sm text-muted">LAN (internet)
                <select className={fieldClass()} value={outboundNone ? "" : nicKey(draft.room.outboundNicName, draft.room.outboundNicIndex)} onChange={(e) => pickNic("out", e.target.value)}>
                  <option value="">None</option>
                  {nicChoices.map((nic) => <option key={`out-${nic.name}`} value={nicKey(nic.name, nic.index)}>{nic.label}</option>)}
                </select>
                <span className="text-xs">
                  Live IP:{" "}
                  {outboundLiveIp.kind === "ip"
                    ? <span className="font-mono text-fg select-all">{outboundLiveIp.ipv4}</span>
                    : <span className={outboundLiveIp.kind === "waiting" ? "text-clay" : "text-muted"}>{outboundLiveIp.text}</span>}
                  {" · "}Venue/internet NIC for GitHub update. None = no internet-facing NIC; Update disabled. Not used for device I/O.
                </span>
              </label>
              {nicError ? <p className="sm:col-span-2 text-xs text-clay">{nicError}</p> : null}
              {sameNic ? <p className="sm:col-span-2 text-xs text-muted">Same NIC on both pickers (test box). Allowed.</p> : null}
              {outboundNone ? <p className="sm:col-span-2 text-xs text-muted">Outbound is None — Update from GitHub is disabled until you pick a venue/internet NIC.</p> : null}
              {outboundNoIp ? <p className="sm:col-span-2 text-xs text-clay">LAN (internet) has no IPv4. Update from GitHub will refuse until you pick a NIC with an address.</p> : null}

              <div className="sm:col-span-2 grid gap-2 rounded-lg border border-border bg-raised/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-subtle">Venue TLS</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={venueTlsBusy || !generateGate.allowed}
                      title={generateGate.reason ?? undefined}
                      onClick={() => void runGenerateVenueTls()}
                    >
                      Generate venue certificate
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!venueTls?.present || venueTlsBusy}
                      title={!venueTls?.present ? "Generate first to create the room CA." : "Download ca.cert.pem from this origin"}
                      onClick={() => void downloadVenueCa()}
                    >
                      Download CA
                    </Button>
                  </div>
                </div>
                {!generateGate.allowed ? (
                  <p className="text-xs text-muted">{generateGate.reason}</p>
                ) : null}
                <p className="text-xs text-muted">
                  Active: <span className="font-mono text-fg">{tlsLines.activeLabel}</span>
                  {" · "}SAN IP:{" "}
                  <span className="font-mono text-fg select-all">{tlsLines.sanIp}</span>
                  {" · "}Leaf expiry:{" "}
                  <span className="font-mono text-fg">{tlsLines.expiry}</span>
                  {" · "}Fingerprint:{" "}
                  <span className="font-mono text-fg select-all" title={venueTls?.leafFingerprint256 ?? undefined}>{tlsLines.fingerprint}</span>
                </p>
                {sanMismatch.mismatch ? (
                  <p className="text-xs text-clay">
                    Regenerate needed — {sanMismatch.message} Use Generate again (confirm flow arrives in C3).
                  </p>
                ) : null}
                {venueTlsMsg ? <p className="text-xs text-clay">{venueTlsMsg}</p> : null}
                <div className="grid gap-1">
                  <p className="text-[11px] uppercase tracking-[0.15em] text-subtle">Install CA on tablets</p>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
                    {caHints.map((hint) => (
                      <li key={hint.id}>{hint.text}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>

            <article className="sm:col-span-2 grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[11px] uppercase tracking-[0.2em] text-subtle">Occupancy / Foyer</p>
              <p className="sm:col-span-2 text-xs text-muted">Foyer Auto on this PC reads occupancy. Set it with the Occupancy variable (0 closed, 1 open, 2 in session, 3 do not disturb) or a Relay Occupancy command / macro. Room names do not need to match.</p>
              <label className="grid gap-1 text-sm text-muted sm:col-span-2">Foyer URL
                <input className={fieldClass()} value={draft.room.foyerPeerUrl ?? "http://127.0.0.1:8080"} onChange={(e) => update((c) => { c.room.foyerPeerUrl = e.target.value; })} placeholder="http://127.0.0.1:8080" autoComplete="off" spellCheck={false} />
                <span className="text-xs">Loopback only. Relay reads the current (or next) calendar session from Foyer GET /api/peer. Same peer secret as Security if you set one.</span>
              </label>
              <p className="sm:col-span-2 text-sm text-fg">
                {String(snap.vars?.[FOYER_KIND_ID] ?? "none") === "none"
                  ? "No session from Foyer yet."
                  : `${String(snap.vars?.[FOYER_KIND_ID])} · ${String(snap.vars?.[FOYER_TITLE_ID] || "Untitled")} · ${String(snap.vars?.[FOYER_START_ID] || "—")} → ${String(snap.vars?.[FOYER_END_ID] || "—")}`}
              </p>
            </article>

            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => {
                downloadRoomFile(draft, snap.drivers);
                flash("Download started", "PINs and tokens are blank in the file. This does not save the room.");
              }}>Export</Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (!window.confirm("Replace this room with the file? Save all first if you still need the current layout. Device tokens that are blank in the file keep the ones already on this host.")) return;
                  try {
                    const parsed = JSON.parse(await file.text()) as { config?: RoomConfig; drivers?: Record<string, never> };
                    const res = await importBundle({ data: { token: token || "", bundle: parsed } });
                    flash(res.ok ? "Imported" : "Import failed", res.message);
                    const next = await refresh();
                    if (res.ok) {
                      const ed = await getEditorConfig({ data: { token: token || "" } });
                      if (ed.config) setDraft(structuredClone(ed.config));
                      else if (next?.config) setDraft(structuredClone(next.config));
                    }
                  } catch {
                    flash("Import failed", "Not valid JSON");
                  }
                }}
              />
              <Button variant="secondary" onClick={() => importRef.current?.click()}>Import</Button>
              <Button variant="danger" onClick={() => setGate({ action: "wipe", pin: "" })}>Clear config</Button>
              <Button variant="secondary" onClick={async () => {
                if (!window.confirm("Restart Relay? The page will drop for a few seconds.")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await restartHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Restarting Relay" : "Restart failed", res.message);
              }}>Restart Relay</Button>
              <Button variant="secondary" disabled={outboundNone || outboundNoIp} title={outboundNone ? "Outbound NIC is None — pick a venue/internet NIC to enable Update." : outboundNoIp ? "LAN (internet) has no IPv4." : undefined} onClick={async () => {
                if (outboundNone || outboundNoIp) {
                  flash("Update failed", outboundNone ? "Outbound NIC is None — Update requires a venue/internet NIC." : "LAN (internet) has no IPv4.");
                  return;
                }
                if (!window.confirm("Update Relay from GitHub?\n\nSave all first. The room will go offline for a minute.")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await updateHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Updating from GitHub" : "Update failed", res.message);
              }}>Update from GitHub</Button>
              <Button variant="danger" onClick={async () => {
                if (!window.confirm("Reboot the whole machine?")) return;
                const pin = window.prompt("Config PIN") || "";
                const res = await rebootHost({ data: { token: token || "", pin } });
                flash(res.ok ? "Rebooting machine" : "Reboot failed", res.message);
              }}>Reboot machine</Button>
            </div>
          </section>
  );
}
