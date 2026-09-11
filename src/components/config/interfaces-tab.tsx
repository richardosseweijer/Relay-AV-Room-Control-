import { ChevronDown, ChevronUp } from "lucide-react";
import { debugScan } from "@/lib/control/actions";
import { GATEWAY_PROFILES, gatewayProfile, gatewaySlot, isGatewayKind } from "@/lib/control/gateway";
import type { RoomConfig } from "@/lib/control/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";

async function pingHost(host: string, port?: number, path?: string) {
  const { pingDevice } = await import("@/lib/control/actions");
  return pingDevice({
    data: {
      token: sessionStorage.getItem("relay-config-token") || "",
      host,
      port,
      path,
    },
  });
}

export function InterfacesTab(props: {
  draft: RoomConfig;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  openIfaces: Record<string, boolean>;
  setOpenIfaces: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  hostPorts: { kind: string; path: string; label: string }[];
  scanPorts: (quiet?: boolean) => Promise<void>;
}) {
  const { draft, token, update, flash, openIfaces, setOpenIfaces, hostPorts, scanPorts } = props;
  return (
    <section className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted">Ports on this machine, or a LAN I/O box (gateway).</p>
              <Button size="sm" variant="secondary" onClick={() => scanPorts()}>Scan</Button>
            </div>
            {(draft.interfaces ?? []).map((iface, ii) => {
              const paths = hostPorts.filter((p) => p.kind === iface.kind && !/not detected/i.test(p.label));
              const open = openIfaces[iface.id] === true;
              return (
              <article
                key={iface.id}
                className="rounded-xl border border-border bg-surface p-4"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", `iface:${iface.id}`)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData("text/plain");
                  if (!raw.startsWith("iface:")) return;
                  e.preventDefault();
                  const fromId = raw.slice(6);
                  update((c) => {
                    const list = c.interfaces ?? [];
                    const from = list.findIndex((item) => item.id === fromId);
                    if (from < 0 || from === ii) return;
                    const [row] = list.splice(from, 1);
                    if (row) list.splice(ii, 0, row);
                    c.interfaces = list;
                  });
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="cursor-grab text-subtle">::</span>
                  <button type="button" className="flex flex-1 text-left font-medium" onClick={() => setOpenIfaces((cur) => ({ ...cur, [iface.id]: !open }))}>
                    {iface.label || "Interface"}
                    <span className="ml-2 font-normal text-muted">{iface.kind}{iface.kind === "gateway" && iface.host ? ` · ${iface.host}` : iface.path ? ` · ${iface.path}` : ""}</span>
                  </button>
                  <Button size="sm" variant="danger" onClick={() => update((c) => { c.interfaces = (c.interfaces ?? []).filter((item) => item.id !== iface.id); c.devices.forEach((d) => { if (d.interfaceId === iface.id) { d.interfaceId = null; d.transport = "lan"; } }); })}>Delete</Button>
                </div>
                {open ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-muted">Label
                  <input className={fieldClass()} value={iface.label} onChange={(e) => update((c) => { c.interfaces = c.interfaces ?? []; c.interfaces[ii]!.label = e.target.value; })} />
                </label>
                <label className="grid gap-1 text-sm text-muted">Kind
                <select className={fieldClass()} value={iface.kind} onChange={(e) => update((c) => {
                  const kind = e.target.value as typeof iface.kind;
                  c.interfaces![ii]!.kind = kind;
                  if (kind === "gateway") {
                    c.interfaces![ii]!.vendor = c.interfaces![ii]!.vendor || "extron-ipl-t-sfi244";
                    c.interfaces![ii]!.slot = c.interfaces![ii]!.slot || "com1";
                    c.interfaces![ii]!.controlPort = c.interfaces![ii]!.controlPort || 23;
                  }
                })}>
                  <option value="serial">Serial / COM</option>
                  <option value="gpio">GPIO</option>
                  <option value="i2c">I2C</option>
                  <option value="spi">SPI</option>
                  <option value="ir">IR blaster</option>
                  <option value="cec">HDMI CEC</option>
                  <option value="gateway">Gateway (IPL / I/O box)</option>
                </select>
                </label>
                {iface.kind === "gateway" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">Box
                      <select className={fieldClass()} value={iface.vendor ?? "extron-ipl-t-sfi244"} onChange={(e) => update((c) => {
                        const vendor = e.target.value;
                        const profile = gatewayProfile(vendor);
                        c.interfaces![ii]!.vendor = vendor;
                        c.interfaces![ii]!.controlPort = profile?.controlPort;
                        const slots = profile?.slots ?? [];
                        if (!slots.some((s) => s.id === c.interfaces![ii]!.slot)) c.interfaces![ii]!.slot = slots[0]?.id;
                      })}>
                        {Object.values(GATEWAY_PROFILES).map((profile) => (
                          <option key={profile.id} value={profile.id}>{profile.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Slot
                      <select className={fieldClass()} value={iface.slot ?? "com1"} onChange={(e) => update((c) => { c.interfaces![ii]!.slot = e.target.value; })}>
                        {(gatewayProfile(iface.vendor)?.slots ?? []).map((slot) => (
                          <option key={slot.id} value={slot.id}>{slot.label}{slot.mapPort ? ` → ${slot.mapPort}` : ""}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-muted">IP
                      <input className={fieldClass()} placeholder="10.0.0.10" value={iface.host ?? ""} onChange={(e) => update((c) => { c.interfaces![ii]!.host = e.target.value; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">Control port
                      <InputNum placeholder="23" value={iface.controlPort} onNumber={(n) => update((c) => { c.interfaces![ii]!.controlPort = n; })} />
                    </label>
                    {gatewaySlot(iface.vendor, iface.slot)?.mapPort != null ? (
                      <label className="grid gap-1 text-sm text-muted">Baud
                        <InputNum placeholder="9600" value={iface.baud} onNumber={(n) => update((c) => { c.interfaces![ii]!.baud = n; })} />
                      </label>
                    ) : null}
                    <div className="sm:col-span-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={async () => {
                        if (!iface.host) { flash("No IP", "Set the box IP first."); return; }
                        const control = iface.controlPort ?? gatewayProfile(iface.vendor)?.controlPort ?? 23;
                        const res = await pingHost(iface.host, control);
                        flash(res.ok ? "SIS open" : "SIS closed", `${iface.host}:${control} · ${res.message}`);
                      }}>Probe SIS</Button>
                      {gatewaySlot(iface.vendor, iface.slot)?.mapPort != null ? (
                        <Button size="sm" variant="secondary" onClick={async () => {
                          if (!iface.host) { flash("No IP", "Set the box IP first."); return; }
                          const map = gatewaySlot(iface.vendor, iface.slot)!.mapPort!;
                          const res = await pingHost(iface.host, map);
                          flash(res.ok ? "Slot open" : "Slot closed", `${iface.host}:${map} · ${res.message}`);
                        }}>Probe slot</Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onClick={async () => {
                        if (!iface.host) { flash("No IP", "Set the box IP first."); return; }
                        const profile = gatewayProfile(iface.vendor);
                        const ports = [...new Set([
                          iface.controlPort ?? profile?.controlPort ?? 23,
                          ...(profile?.slots.map((s) => s.mapPort).filter((n): n is number => typeof n === "number") ?? []),
                        ])];
                        const res = await debugScan({ data: { token: token || "", host: iface.host, ports } });
                        flash(res.ok ? "Open ports" : "No open ports", res.message);
                      }}>Scan</Button>
                    </div>
                  </>
                ) : null}
                {iface.kind === "serial" || iface.kind === "spi" || iface.kind === "ir" ? (
                  <>
                  <label className="grid gap-1 text-sm text-muted">{iface.kind === "serial" ? "Port" : iface.kind === "spi" ? "SPI device" : "IR device"}
                    <select className={fieldClass()} value={paths.some((p) => p.path === iface.path) ? (iface.path ?? "") : ""} onChange={(e) => update((c) => { c.interfaces![ii]!.path = e.target.value; })}>
                      <option value="">{paths.length ? "Select…" : "None found"}</option>
                      {paths.map((p) => <option key={`${p.kind}-${p.path}`} value={p.path}>{p.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-muted">Path
                    <input className={fieldClass()} placeholder="/dev/serial0 or COM3" value={iface.path ?? ""} onChange={(e) => update((c) => { c.interfaces![ii]!.path = e.target.value; })} />
                  </label>
                  </>
                ) : null}
                {iface.kind === "gpio" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">GPIO chip
                      <input className={fieldClass()} placeholder="gpiochip0" value={iface.chip ?? "gpiochip0"} onChange={(e) => update((c) => { c.interfaces![ii]!.chip = e.target.value; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">GPIO pin
                      <InputNum placeholder="17" value={iface.line} onNumber={(n) => update((c) => { c.interfaces![ii]!.line = n; })} />
                    </label>
                  </>
                ) : null}
                {iface.kind === "i2c" ? (
                  <>
                    <label className="grid gap-1 text-sm text-muted">I2C bus
                      <InputNum placeholder="1" value={iface.bus} onNumber={(n) => update((c) => { c.interfaces![ii]!.bus = n; })} />
                    </label>
                    <label className="grid gap-1 text-sm text-muted">I2C address
                      <input className={fieldClass()} placeholder="0x3c" value={iface.address ?? ""} onChange={(e) => update((c) => { c.interfaces![ii]!.address = e.target.value; })} />
                    </label>
                  </>
                ) : null}
                </div>
                ) : null}
              </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => {
              c.interfaces = c.interfaces ?? [];
              const first = hostPorts.find((p) => p.kind === "serial") ?? hostPorts[0];
              c.interfaces.push({ id: `if-${Date.now().toString(36)}`, label: first?.label || "Serial", kind: (first?.kind as "serial") || "serial", path: first?.path || "", baud: 9600 });
            })}>Add interface</Button>
            <Button variant="secondary" onClick={() => update((c) => {
              c.interfaces = c.interfaces ?? [];
              c.interfaces.push({
                id: `if-${Date.now().toString(36)}`,
                label: "IPL T SFI244",
                kind: "gateway",
                vendor: "extron-ipl-t-sfi244",
                host: "",
                controlPort: 23,
                slot: "com1",
                baud: 9600,
              });
            })}>Add gateway</Button>
          </section>
  );
}
