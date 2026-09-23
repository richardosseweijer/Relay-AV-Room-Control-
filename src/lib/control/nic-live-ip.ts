/** Read-only UI label for a NIC picker's live IPv4. Never invents an address. */
export type LiveNicIpv4Label = {
  kind: "unset" | "ip" | "waiting";
  text: string;
  ipv4: string | null;
};

export function liveNicIpv4Label(opts: {
  unset: boolean;
  ipv4?: string | null;
  unsetText?: string;
}): LiveNicIpv4Label {
  if (opts.unset) {
    return { kind: "unset", text: opts.unsetText ?? "No IP", ipv4: null };
  }
  const ip = String(opts.ipv4 ?? "").trim();
  if (ip) return { kind: "ip", text: ip, ipv4: ip };
  return { kind: "waiting", text: "No IPv4 — waiting", ipv4: null };
}
