import type { CommandResult } from "./types";

export async function sendPjlink(host: string, port: number, payload: string, password: string | undefined, timeout: number): Promise<CommandResult> {
  const net = await import("node:net");
  const crypto = await import("node:crypto");
  const body = payload.replace(/\r?\n/g, "") + "\r";
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let buf = "";
    let sent = false;
    const timer = setTimeout(() => { sock.destroy(); resolve({ ok: false, message: "PJLink timeout" }); }, timeout);
    const fail = (message: string) => { clearTimeout(timer); sock.destroy(); resolve({ ok: false, message }); };
    sock.setEncoding("utf8");
    sock.on("error", (err) => fail(err.message));
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const take = (): string | null => {
        const at = buf.search(/\r|\n/);
        if (at < 0) return null;
        const line = buf.slice(0, at).trim();
        buf = buf.slice(at + 1).replace(/^\n/, "");
        return line || take();
      };
      if (!sent) {
        const line = take();
        if (line == null) return;
        const banner = line.match(/PJLINK\s+(\d)(?:\s+([0-9a-fA-F]+))?/i);
        if (!banner) return fail("bad PJLink banner");
        const secured = banner[1] === "1";
        const rand = banner[2] ?? "";
        if (secured) {
          if (!password) return fail("PJLink password required");
          if (!rand) return fail("PJLink challenge incomplete");
          const digest = crypto.createHash("md5").update(rand + password).digest("hex");
          sock.write(digest + body);
        } else sock.write(body);
        sent = true;
        return;
      }
      const line = take();
      if (line == null) return;
      clearTimeout(timer);
      sock.end();
      if (/ERRA/i.test(line)) resolve({ ok: false, message: "PJLink auth failed" });
      else if (/ERR\d/i.test(line)) resolve({ ok: false, message: line.slice(0, 80) });
      else if (!/=/.test(line) && !/OK/i.test(line)) resolve({ ok: false, message: line.slice(0, 80) || "PJLink incomplete" });
      else resolve({ ok: true, message: line.slice(0, 200) });
    });
    sock.on("close", () => {
      if (!sent) fail("no PJLink banner");
    });
  });
}

