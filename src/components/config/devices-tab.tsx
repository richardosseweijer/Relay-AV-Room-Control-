import { authenticate, clearDeviceError, debugScan, debugSend, fireCommand, pullInventory } from "@/lib/control/actions";
import { gatewayProfile, gatewaySlot, isGatewayKind } from "@/lib/control/gateway";
import type { RoomConfig, RoomSnapshot } from "@/lib/control/types";
import { orphanBindings } from "@/lib/control/schema";
import { deviceInUse } from "@/lib/control/vars";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "./config-ui";
import { InputNum } from "./config-fields";
import { InventoryBoard } from "./inventory-board";

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

export function DevicesTab(props: {
  draft: RoomConfig;
  snap: RoomSnapshot;
  token: string;
  update: (mut: (c: RoomConfig) => void) => void;
  flash: (title: string, body: string) => void;
  refresh: () => Promise<unknown>;
  openDevices: Record<string, boolean>;
  setOpenDevices: (fn: (cur: Record<string, boolean>) => Record<string, boolean>) => void;
  reach: Record<string, "sim" | "up" | "down" | "wait">;
}) {
  const { draft, snap, token, update, flash, refresh, openDevices, setOpenDevices, reach } = props;
  return (
    <section className="grid gap-4">
            {orphanBindings(draft, snap.drivers).length ? (
              <p className="rounded-md border border-sand/40 bg-sand/10 px-3 py-2 text-sm">
                Broken after a driver swap: {orphanBindings(draft, snap.drivers).slice(0, 8).join(" · ")}
              </p>
            ) : null}
            {draft.devices.map((device, index) => {
              const driver = snap.drivers[device.driver];
              const features = [...(driver?.commands.map((c) => c.id) ?? []), ...(driver?.feedback.map((f) => f.id) ?? [])];
              const allOn = device.enabledFeatures.length === 0;
              const open = openDevices[device.id] === true;
              return (
                <article key={device.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", reach[device.id] === "up" || device.simulate ? "bg-sage" : reach[device.id] === "wait" ? "bg-sand" : "bg-clay")} />
                    <input className={fieldClass()} value={device.name} onChange={(e) => update((c) => { c.devices[index]!.name = e.target.value; })} />
                    <button type="button" className="shrink-0 text-xs text-muted" onClick={() => setOpenDevices((cur) => ({ ...cur, [device.id]: !open }))}>{open ? "Hide" : "Show"}</button>
                  </div>
                  {open ? (
                  <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <select className={fieldClass()} value={device.driver} onChange={(e) => update((c) => {
                      const next = e.target.value;
                      c.devices[index]!.driver = next;
                      const spec = snap.drivers[next];
                      const baud = spec?.transports.local?.baud ?? spec?.transports.rs232?.baud;
                      if (baud) c.devices[index]!.baud = baud;
                      if (spec?.transports.local?.bus) c.devices[index]!.bus = spec.transports.local.bus;
                      if (spec?.transports.local?.address) c.devices[index]!.address = spec.transports.local.address;
                      if (spec?.transports.local?.speed) c.devices[index]!.speed = spec.transports.local.speed;
                    })}>
                      {Object.keys(snap.drivers).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <label className="grid gap-1 text-sm text-muted">Interface
                      <select className={fieldClass()} value={device.interfaceId ?? ""} onChange={(e) => update((c) => {
                        const id = e.target.value || null;
                        const iface = (c.interfaces ?? []).find((item) => item.id === id);
                        c.devices[index]!.interfaceId = id;
                        if (!id) {
                          c.devices[index]!.transport = "lan";
                          return;
                        }
                        if (isGatewayKind(iface?.kind)) {
                          const slot = gatewaySlot(iface?.vendor, iface?.slot);
                          c.devices[index]!.transport = "lan";
                          c.devices[index]!.host = iface?.host || c.devices[index]!.host;
                          c.devices[index]!.port = slot?.mapPort ?? iface?.controlPort ?? gatewayProfile(iface?.vendor)?.controlPort;
                          if (slot?.baudDefault && !c.devices[index]!.baud) c.devices[index]!.baud = slot.baudDefault;
                        } else {
                          c.devices[index]!.transport = "local";
                        }
                      })}>
                        <option value="">LAN</option>
                        {(draft.interfaces ?? []).map((iface) => (
                          <option key={iface.id} value={iface.id}>{iface.label}{iface.slot ? ` / ${gatewaySlot(iface.vendor, iface.slot)?.label || iface.slot}` : iface.kind !== "gateway" ? ` (${iface.kind} ${iface.path || iface.line || ""})` : ""}</option>
                        ))}
                      </select>
                    </label>
                    {(() => {
                      const kind = (draft.interfaces ?? []).find((item) => item.id === device.interfaceId)?.kind;
                      const bound = (draft.interfaces ?? []).find((item) => item.id === device.interfaceId);
                      const gateway = isGatewayKind(kind);
                      const comSlot = gatewaySlot(bound?.vendor, bound?.slot)?.mapPort != null;
                      const fields = driver?.auth?.instanceFields ?? [];
                      const needsToken = fields.includes("token") || (!fields.length && (!!driver?.auth?.pairing || driver?.auth?.type === "token"));
                      const needsSecret = driver?.auth?.type === "password" || fields.includes("password") || fields.includes("mac") || driver?.transports.lan?.protocol === "wol";
                      return (
                        <>
                          {!kind || gateway ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">IP
                                <input className={fieldClass()} value={device.host} placeholder="10.0.0.10 or localhost" onChange={(e) => update((c) => { c.devices[index]!.host = e.target.value; })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">Port
                                <InputNum placeholder={String(driver?.transports.lan?.port ?? 80)} value={device.port} onNumber={(n) => update((c) => { c.devices[index]!.port = n; })} />
                              </label>
                            </>
                          ) : null}
                          {kind === "serial" || comSlot ? (
                            <label className="grid gap-1 text-sm text-muted">Baud
                              <InputNum placeholder="9600" value={device.baud} onNumber={(n) => update((c) => { c.devices[index]!.baud = n; })} />
                            </label>
                          ) : null}
                          {kind === "i2c" ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">I2C bus
                                <InputNum placeholder="1" value={device.bus} onNumber={(n) => update((c) => { c.devices[index]!.bus = n; })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">I2C address
                                <input className={fieldClass()} value={device.address ?? driver?.transports.local?.address ?? ""} placeholder="0x3c" onChange={(e) => update((c) => { c.devices[index]!.address = e.target.value; })} />
                              </label>
                            </>
                          ) : null}
                          {kind === "spi" ? (
                            <label className="grid gap-1 text-sm text-muted">SPI speed
                              <InputNum placeholder="500000" value={device.speed} onNumber={(n) => update((c) => { c.devices[index]!.speed = n; })} />
                            </label>
                          ) : null}
                          {needsToken ? (
                            <label className="grid gap-1 text-sm text-muted">Token
                              <input className={fieldClass()} type="password" placeholder="token" value={device.auth?.token ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, token: e.target.value }; })} />
                            </label>
                          ) : null}
                          {needsSecret && (fields.includes("mac") || driver?.transports.lan?.protocol === "wol") ? (
                            <label className="grid gap-1 text-sm text-muted">MAC (wired if on Ethernet)
                              <input className={fieldClass()} placeholder="AA:BB:CC:DD:EE:FF" value={device.auth?.mac ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, mac: e.target.value }; })} />
                            </label>
                          ) : null}
                          {(driver?.auth?.type === "password" || driver?.auth?.type === "userpass" || fields.includes("user") || fields.includes("password")) ? (
                            <>
                              <label className="grid gap-1 text-sm text-muted">User
                                <input className={fieldClass()} value={device.auth?.user ?? device.auth?.username ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, user: e.target.value }; })} />
                              </label>
                              <label className="grid gap-1 text-sm text-muted">Password
                                <input className={fieldClass()} type="password" value={device.auth?.password ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, password: e.target.value }; })} />
                              </label>
                            </>
                          ) : null}
                          {fields.filter((name) => !["token", "mac", "password", "user"].includes(name)).map((name) => (
                            <label key={name} className="grid gap-1 text-sm text-muted">
                              {name === "secret" ? "Secret (other room’s peer secret)" : name === "path" ? "HTTP shutdown path" : name}
                              <input className={fieldClass()} value={device.auth?.[name] ?? ""} onChange={(e) => update((c) => { c.devices[index]!.auth = { ...c.devices[index]!.auth, [name]: e.target.value }; })} />
                              {name === "secret" ? <span className="text-xs">From the other Relay: Security → This room’s peer secret.</span> : null}
                            </label>
                          ))}
                        </>
                      );
                    })()}
                    <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={device.simulate} onChange={(e) => update((c) => { c.devices[index]!.simulate = e.target.checked; })} />Simulate</label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {features.map((id) => {
                      const isCommand = (driver?.commands ?? []).some((c) => c.id === id);
                      const on = allOn || device.enabledFeatures.includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-raised text-fg" : "border-border text-subtle")}
                          onClick={async () => {
                            if (isCommand) {
                              const res = await fireCommand({ data: { deviceId: device.id, commandId: id, raw: true, token: token || "" } });
                              flash(res.ok ? id : `${id} failed`, res.message);
                              await refresh();
                              return;
                            }
                            update((c) => {
                              const d = c.devices[index]!;
                              d.enabledFeatures = on ? d.enabledFeatures.filter((x) => x !== id) : [...d.enabledFeatures, id];
                            });
                          }}
                        >{id}</button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={async () => {
                      if (device.interfaceId && !isGatewayKind((draft.interfaces ?? []).find((item) => item.id === device.interfaceId)?.kind)) {
                        flash("Local port", "Probe is LAN only.");
                        return;
                      }
                      const probePort = driver?.auth?.pairing?.ports?.[0] ?? device.port ?? driver?.transports.lan?.port;
                      const probePath = driver?.auth?.pairing?.discoverPath || "/";
                      const res = await pingHost(device.host, probePort, probePath);
                      flash(res.ok ? "Reachable" : "No answer", res.message);
                      await refresh();
                    }}>Probe</Button>
                    {driver?.auth?.pairing ? (
                      <Button size="sm" variant="secondary" onClick={async () => {
                        const res = await authenticate({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth } });
                        const grabbed = res.pairedToken || res.message.match(/Token stored:\s*(\S+)/)?.[1];
                        if (grabbed) update((c) => {
                          c.devices[index]!.auth = { ...c.devices[index]!.auth, token: grabbed, paired: "yes" };
                          if (res.pairedPort) c.devices[index]!.port = res.pairedPort;
                        });
                        flash(res.ok ? "Authenticated" : "Auth failed", res.message);
                        await refresh();
                      }}>Authenticate</Button>
                    ) : null}
                    {driver?.inventory?.resources?.length ? (
                      <Button size="sm" variant="secondary" onClick={async () => {
                        const res = await pullInventory({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth, simulate: device.simulate } });
                        if (res.inventory) update((c) => { c.devices[index]!.inventory = res.inventory; });
                        flash(res.ok ? "Inventory" : "Sync failed", res.message);
                        await refresh();
                      }}>Sync inventory</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={async () => {
                      const ports = [...new Set([device.port, driver?.transports.lan?.port, ...(driver?.auth?.pairing?.ports ?? [])].filter((n): n is number => typeof n === "number"))];
                      const res = await debugScan({ data: { token: token || "", host: device.host, ports } });
                      flash(res.ok ? "Open ports" : "No open ports", res.message);
                      await refresh();
                    }}>Scan ports</Button>
                    <Button size="sm" variant="danger" onClick={() => {
                      const used = deviceInUse(draft, device.id);
                      if (used.length) { flash("In use", used.join(", ")); return; }
                      update((c) => { c.devices = c.devices.filter((d) => d.id !== device.id); });
                    }}>Delete</Button>
                  </div>
                  {driver?.inventory?.resources?.length ? (
                    <InventoryBoard
                      lists={driver.inventory.resources.map((resource) => ({
                        id: resource.id,
                        label: resource.label,
                        items: device.inventory?.[resource.id] ?? [],
                        command: resource.useCommand,
                      }))}
                      onRefresh={async () => {
                        const res = await pullInventory({ data: { token: token || "", deviceId: device.id, host: device.host, port: device.port, driver: device.driver, auth: device.auth, simulate: device.simulate } });
                        if (res.inventory) update((c) => { c.devices[index]!.inventory = res.inventory; });
                        flash(res.ok ? "Inventory" : "Sync failed", res.message);
                        await refresh();
                      }}
                      onUse={async (command, id) => {
                        const res = await fireCommand({ data: { deviceId: device.id, commandId: command, value: command === "var.set" ? `${id}=` : id, raw: true, token: token || "" } });
                        flash(res.ok ? command : `${command} failed`, res.message);
                        await refresh();
                      }}
                    />
                  ) : null}
                  {snap.health?.[device.id] && !snap.health[device.id]!.ok ? (
                    <div className="mt-2 flex items-center gap-2 text-sm text-clay">
                      {snap.health[device.id]!.message}
                      <Button size="sm" variant="secondary" onClick={async () => { await clearDeviceError({ data: { deviceId: device.id, token: token || "" } }); await refresh(); }}>Retry</Button>
                    </div>
                  ) : null}
                  <textarea className={`${fieldClass()} mt-3 min-h-16 font-mono text-xs`} placeholder="Raw payload" id={`raw-${device.id}`} />
                  <Button size="sm" variant="secondary" className="mt-2" onClick={async () => {
                    const el = document.getElementById(`raw-${device.id}`) as HTMLTextAreaElement | null;
                    const res = await debugSend({ data: { token: token || "", deviceId: device.id, payload: el?.value ?? "", host: device.host, port: device.port, driver: device.driver, auth: device.auth } });
                    flash(res.ok ? "Raw reply" : "Raw failed", res.message);
                    await refresh();
                  }}>Send raw</Button>
                  <ol className="mt-2 max-h-32 overflow-auto font-mono text-[11px] text-muted">
                    {[
                      ...(snap.traces?.[device.id] ?? []),
                      ...(device.interfaceId && device.interfaceId !== device.id ? (snap.traces?.[device.interfaceId] ?? []) : []),
                    ].sort((a, b) => b.at - a.at).map((line, i) => (
                      <li key={`${line.at}-${line.dir}-${i}`}>{line.dir} {line.text}</li>
                    ))}
                  </ol>
                  </>
                  ) : null}
                </article>
              );
            })}
            <Button variant="secondary" onClick={() => update((c) => {
              const id = `dev-${Date.now().toString(36)}`;
              const driver = Object.keys(snap.drivers)[0] ?? "lg-oled55c3.json";
              c.devices.push({ id, name: "New device", driver, transport: "lan", host: "", auth: {}, enabledFeatures: [], simulate: false });
            })}>Add device</Button>
          </section>
  );
}
