import { posix as posixPath } from "node:path";
import type {
  CommandResult,
  DeviceInstance,
  DriverSpec,
  HostInterface,
} from "./types";
import { isGatewayKind } from "./gateway.ts";
import { sendUsbMidi } from "./midi.ts";
import { pushTrace } from "./engine-policy.ts";

async function runToolStdin(cmd: string, args: string[], stdin: string, timeout = 2000): Promise<CommandResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${cmd} timeout` }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `${cmd} ${code}` }); });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

async function runTool(cmd: string, args: string[], timeout = 2000): Promise<CommandResult> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, message: `${cmd} timeout` }); }, timeout);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, message: err.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, message: out.trim().slice(0, 200) || `${cmd} ${code}` }); });
  });
}

export type HostPort = { kind: string; path: string; label: string };

export async function listHostInterfaces(): Promise<{ ok: boolean; message: string; ports: HostPort[] }> {
  const ports: HostPort[] = [];
  const seen = new Set<string>();
  const add = (kind: string, path: string, label?: string) => {
    const key = `${kind}:${path}`;
    if (!path || seen.has(key)) return;
    seen.add(key);
    ports.push({ kind, path, label: label || path });
  };
  const win = process.platform === "win32";
  try {
    if (win) {
      const { execFile } = await import("node:child_process");
      const raw = await new Promise<string>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames()"], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of raw.split(/\r?\n/)) {
        const name = line.trim();
        if (/^COM\d+$/i.test(name)) add("serial", name.toUpperCase(), name.toUpperCase());
      }
      const cim = await new Promise<string>((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_SerialPort | ForEach-Object { $_.DeviceID + '|' + $_.Name }"], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of cim.split(/\r?\n/)) {
        const [id, name] = line.split("|");
        if (id && /^COM\d+/i.test(id.trim())) add("serial", id.trim().toUpperCase(), (name || id).trim());
      }
    } else {
      const fs = await import("node:fs/promises");
      const names = await fs.readdir("/dev").catch(() => [] as string[]);
      for (const name of names) {
        if (/^tty(USB|ACM|AMA|S)\d+$/i.test(name)) add("serial", `/dev/${name}`);
        if (/^serial[0-9]+$/i.test(name)) add("serial", `/dev/${name}`, `${name} (Pi UART)`);
        if (/^gpiochip\d+$/i.test(name)) add("gpio", `/dev/${name}`, name);
        if (/^i2c-\d+$/i.test(name)) add("i2c", `/dev/${name}`, name);
        if (/^spidev\d+\.\d+$/i.test(name)) add("spi", `/dev/${name}`);
        if (/^cec\d+$/i.test(name)) add("cec", `/dev/${name}`);
        if (/^lirc\d+$/i.test(name)) add("ir", `/dev/${name}`);
      }
      const { execFile } = await import("node:child_process");
      const amidi = await new Promise<string>((resolve) => {
        execFile("amidi", ["-l"], { timeout: 2000, windowsHide: true }, (err, stdout) => {
          resolve(err ? "" : String(stdout || ""));
        });
      });
      for (const line of amidi.split(/\r?\n/)) {
        const hw = line.match(/\b(hw:[A-Za-z0-9:_,-]{1,24})\b/)?.[1];
        if (hw) add("midi", hw, line.trim());
      }
      for (const alias of ["/dev/serial0", "/dev/serial1", "/dev/ttyAMA0", "/dev/ttyS0"]) {
        const exists = await fs.access(alias).then(() => true).catch(() => false);
        if (exists) add("serial", alias, alias.includes("serial") ? `${alias} (Pi UART)` : alias);
      }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "scan failed", ports };
  }
  return { ok: true, message: ports.length ? `${ports.length} found` : "None found", ports };
}

/** Windows COM* and Unix /dev serial nodes already scanned by listHostInterfaces. */
export function serialPathOk(raw: string): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.includes("\0")) return false;
  if (/^COM\d+$/i.test(s)) return true;
  if (!s.startsWith("/")) return false;
  const resolved = posixPath.resolve(s);
  if (!resolved.startsWith("/dev/")) return false;
  const base = resolved.slice("/dev/".length);
  if (!base || base.includes("/")) return false;
  return /^(tty(USB|ACM|AMA|S)\d+|serial\d+)$/i.test(base);
}

export function usesLocalPort(iface?: HostInterface) {
  return Boolean(iface && !isGatewayKind(iface.kind));
}

function localArg(value: string | number | undefined, re: RegExp) {
  const s = String(value ?? "").trim();
  return re.test(s) ? s : null;
}

export async function sendLocal(driver: DriverSpec, device: DeviceInstance, payload: string): Promise<CommandResult> {
  const local = driver.transports.local;
  const serial = driver.transports.rs232;
  const kind = device.auth?.ifaceKind || local?.kind || (device.transport === "rs232" || serial ? "serial" : null);
  if (!kind) return { ok: false, message: "No local transport on this driver" };
  const path = device.interface || device.host || local?.path || "COM1";
  pushTrace(device.id, "tx", `${kind} ${path} ${payload.slice(0, 80)}`);
  if (kind === "gpio") {
    const line = localArg(device.auth?.pin ?? device.port ?? local?.line ?? 0, /^(0|[1-9]\d{0,2})$/);
    const chip = localArg(device.auth?.chip || local?.chip || "gpiochip0", /^gpiochip\d+$/);
    const level = /off|low|0/i.test(payload) ? "0" : /on|high|1/i.test(payload) ? "1" : null;
    if (!chip || !line || Number(line) > 511 || (level !== "0" && level !== "1")) {
      return { ok: false, message: "GPIO chip/line/level rejected" };
    }
    return runTool("gpioset", [chip, `${line}=${level}`], local?.timeoutMs ?? 1500);
  }
  if (kind === "serial") {
    if (!serialPathOk(path)) return { ok: false, message: "Serial path rejected" };
    try {
      const fs = await import("node:fs/promises");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const baud = String(device.baud ?? serial?.baud ?? local?.baud ?? 9600);
      const com = /^COM\d+$/i.test(path) ? path.toUpperCase() : null;
      const target = com ? `\\\\.\\${com}` : posixPath.resolve(path);
      if (com) {
        await exec("mode", [`${com}:`, `baud=${baud}`, "parity=n", "data=8", "stop=1"]).catch(() => undefined);
      } else {
        await exec("stty", ["-F", target, baud, "cs8", "-cstopb", "-parenb", "-echo"]).catch(() => undefined);
      }
      const fh = await fs.open(target, "r+");
      try {
        await fh.write(payload + (serial?.lineEnding ?? local?.lineEnding ?? "\r"));
      } finally {
        await fh.close();
      }
      return { ok: true, message: `${target} @ ${baud}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "serial failed" };
    }
  }
  if (kind === "i2c") {
    const bus = localArg(device.bus ?? local?.bus ?? 1, /^(0|[1-9]\d?)$/);
    const address = localArg(device.address || local?.address || "0x3c", /^0x[0-9a-f]{1,2}$/i);
    const hex = payload.replace(/[^0-9a-f]/gi, "");
    if (!bus || !address || !hex.length || hex.length % 2) return { ok: false, message: "I2C bus/address/data rejected" };
    const bytes: string[] = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(`0x${hex.slice(i, i + 2)}`);
    return runTool("i2cset", ["-y", bus, address, ...bytes]);
  }
  if (kind === "ir") {
    const remote = localArg(device.auth?.remote || "relay", /^[A-Za-z0-9._-]{1,32}$/);
    const scan = localArg(payload, /^[A-Za-z0-9:_-]{1,64}$/);
    if (!remote || !scan) return { ok: false, message: "IR remote/scancode rejected" };
    if (/^[a-z0-9]+:/i.test(scan)) {
      const dev = path === "COM1" ? "/dev/lirc0" : path;
      if (!localArg(dev, /^\/dev\/lirc\d+$/)) return { ok: false, message: "IR device rejected" };
      return runTool("ir-ctl", ["-d", dev, `--scancode=${scan}`], local?.timeoutMs ?? 2000);
    }
    return runTool("irsend", ["SEND_ONCE", remote, scan], local?.timeoutMs ?? 2000);
  }
  if (kind === "cec") {
    const args = ["-s", "-d", "1"];
    if (path && path !== "COM1") {
      const dev = localArg(path, /^\/dev\/cec\d+$/);
      if (!dev) return { ok: false, message: "CEC device rejected" };
      args.unshift("-p", dev);
    }
    const body = localArg(payload.replace(/\s+/g, " ").trim(), /^[A-Za-z0-9 .:_-]{1,80}$/);
    if (!body) return { ok: false, message: "CEC payload rejected" };
    return runToolStdin("cec-client", args, `${body}\n`, local?.timeoutMs ?? 4000);
  }
  if (kind === "midi") {
    return sendUsbMidi({ port: path, payload, timeoutMs: local?.timeoutMs });
  }
  const spiDev = localArg(path || "/dev/spidev0.0", /^\/dev\/spidev\d+\.\d+$/);
  const spiData = localArg(payload, /^[0-9A-Fa-f]{2,128}$/);
  if (!spiDev || !spiData) return { ok: false, message: "SPI device/payload rejected" };
  return runTool("spidev_test", ["-D", spiDev, "-p", spiData]);
}

export async function readHostFeedback(id: string, host?: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null }): Promise<{ ok: boolean; value: string; message: string }> {
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  if (id === "system.uptime") return { ok: true, value: String(Math.round(os.uptime())), message: `${Math.round(os.uptime())}s` };
  if (id === "relay.uptime") return { ok: true, value: String(Math.round(process.uptime())), message: `${Math.round(process.uptime())}s` };
  if (id === "system.temp") {
    try {
      const raw = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
      const c = (Number(raw) / 1000).toFixed(1);
      return { ok: true, value: c, message: `${c}°C` };
    } catch {
      return { ok: true, value: "", message: "n/a" };
    }
  }
  if (id === "system.version") {
    try {
      const pkg = JSON.parse(await fs.readFile("package.json", "utf8")) as { version?: string; name?: string };
      return { ok: true, value: pkg.version || "dev", message: pkg.version || "dev" };
    } catch {
      return { ok: true, value: "dev", message: "dev" };
    }
  }
  if (id === "system.platform") return { ok: true, value: `${os.platform()}-${os.arch()}`, message: `${os.platform()} ${os.arch()}` };
  if (id === "system.memory") {
    const free = Math.round(os.freemem() / 1048576);
    const total = Math.round(os.totalmem() / 1048576);
    return { ok: true, value: String(free), message: `${free}/${total} MB` };
  }
  if (id === "system.load") return { ok: true, value: os.loadavg()[0].toFixed(2), message: os.loadavg()[0].toFixed(2) };
  if (id === "panel.locked") return { ok: true, value: host?.locked ? "1" : "0", message: host?.locked ? "locked" : "open" };
  if (id === "display.dimmed") return { ok: true, value: host?.dim ? "1" : "0", message: host?.dim ? "dim" : "awake" };
  return { ok: false, value: "", message: "Unknown host feedback" };
}

export async function applyHost(
  commandId: string,
  value: string | number | undefined,
  host: { dim: boolean; locked: boolean; toast: string | null; toastAt?: number; block?: string | null; pageId: string | null; pageAt?: number; fullscreenAt?: number },
  vars?: Record<string, string | number>,
  flags?: { allowReboot?: boolean; allowAdmin?: boolean },
): Promise<CommandResult> {
  if (commandId === "display.dim") host.dim = true;
  else if (commandId === "display.wake") host.dim = false;
  else if (commandId === "panel.lock") host.locked = true;
  else if (commandId === "panel.unlock") host.locked = false;
  else if (commandId === "ui.toast") { host.toast = String(value ?? ""); host.toastAt = Date.now(); }
  else if (commandId === "ui.block") { host.block = String(value ?? ""); }
  else if (commandId === "ui.unblock") { host.block = null; }
  else if (commandId === "ui.clear") { host.toast = null; host.toastAt = Date.now(); }
  else if (commandId === "ui.page") { host.pageId = String(value ?? ""); host.pageAt = Date.now(); }
  else if (commandId === "display.fullscreen") { host.fullscreenAt = Date.now(); }
  else if (commandId === "var.get") {
    if (!vars) return { ok: false, message: "No vars" };
    const id = String(value ?? "").split("=")[0] ?? "";
    return { ok: id in vars, message: String(vars[id] ?? "") };
  }
  else if (commandId === "var.set") {
    if (!vars) return { ok: false, message: "No vars" };
    const raw = String(value ?? "");
    const eq = raw.indexOf("=");
    if (eq < 0) return { ok: false, message: "Use id=value" };
    const id = raw.slice(0, eq).trim();
    const next = raw.slice(eq + 1);
    if (!id) return { ok: false, message: "Missing var id" };
    vars[id] = next;
    return { ok: true, message: `${id}=${next}` };
  }
  else if (commandId === "system.restart") {
    if (!flags?.allowAdmin) return { ok: false, message: "Restart only from configurator" };
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { bootResolveHttpListenHost } = await import("../../../scripts/http-listen-host.mjs");
    let root = process.cwd();
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(root, "package.json")) && fs.existsSync(path.join(root, "src", "lib", "control"))) break;
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
    const port = process.env.PORT || process.argv.find((a, i, all) => all[i - 1] === "--port") || "8081";
    const listen = bootResolveHttpListenHost(root, process.env);
    if (!listen.ok) return { ok: false, message: listen.reason };
    if (listen.warning) console.warn(`[relay] ${listen.warning}`);
    const host = listen.host;
    if (process.env.INVOCATION_ID && process.platform !== "win32") {
      setTimeout(() => process.exit(1), 400);
      return { ok: true, message: "Restarting (systemd Restart=always)" };
    }
    const preview = process.env.npm_lifecycle_event === "start" || process.argv.includes("preview") || process.env.NODE_ENV === "production";
    const viteJs = path.join(root, "node_modules", "vite", "bin", "vite.js");
    const args = preview
      ? (fs.existsSync(viteJs) ? [viteJs, "preview", "--host", host, "--port", String(port)] : ["--yes", "vite", "preview", "--host", host, "--port", String(port)])
      : (fs.existsSync(viteJs) ? [viteJs, "dev", "--host", host, "--port", String(port)] : ["--yes", "vite", "dev", "--host", host, "--port", String(port)]);
    const cmd = fs.existsSync(viteJs) ? process.execPath : "npx";
    // Pass --host for bind; only keep RELAY_LISTEN_HOST when it was an explicit
    // override (do not sticky-stamp the resolved AV IPv4 — Apply would refuse changes).
    const restartEnv: NodeJS.ProcessEnv = { ...process.env, CHOKIDAR_USEPOLLING: "1" };
    const explicitListen = String(process.env.RELAY_LISTEN_HOST ?? "").trim();
    if (explicitListen) restartEnv.RELAY_LISTEN_HOST = explicitListen;
    else delete restartEnv.RELAY_LISTEN_HOST;
    spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      cwd: root,
      shell: !fs.existsSync(viteJs),
      env: restartEnv,
    }).unref();
    setTimeout(() => process.exit(0), 400);
    return { ok: true, message: preview ? `Relay preview restarting in ${root} on ${host}` : `Relay restarting in ${root} on ${host}` };
  }
  else if (commandId === "system.update") {
    if (!flags?.allowAdmin) return { ok: false, message: "Update only from configurator" };
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const path = await import("node:path");
    let root = process.cwd();
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(root, "package.json")) && fs.existsSync(path.join(root, "src", "lib", "control"))) break;
      const parent = path.dirname(root);
      if (parent === root) break;
      root = parent;
    }
    if (!fs.existsSync(path.join(root, ".git"))) return { ok: false, message: "Not a git checkout. Clone the GitHub repo to use Update." };
    const script = path.join(root, "scripts", "update-relay.mjs");
    if (!fs.existsSync(script)) return { ok: false, message: "Update script missing" };
    const port = process.env.PORT || process.argv.find((a, i, all) => all[i - 1] === "--port") || "8081";
    spawn(process.execPath, [script], {
      detached: true,
      stdio: "ignore",
      cwd: root,
      env: { ...process.env, PORT: String(port), CHOKIDAR_USEPOLLING: "1", RELAY_PID: String(process.pid), MAINPID: process.env.MAINPID || String(process.pid) },
    }).unref();
    return { ok: true, message: "Updating from GitHub. The room stays up until the new build is ready." };
  }
  else if (commandId === "system.reboot") {
    if (!flags?.allowReboot) return { ok: false, message: "OS reboot only from configurator" };
    const { spawn } = await import("node:child_process");
    const cmd = process.platform === "win32" ? "shutdown" : "reboot";
    const args = process.platform === "win32" ? ["/r", "/t", "0"] : [];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "Reboot sent" };
  } else return { ok: false, message: "Unknown host command" };
  return { ok: true, message: commandId };
}
