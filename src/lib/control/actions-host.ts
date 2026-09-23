import { createServerFn } from "@tanstack/react-start";
import { applyHost, listHostInterfaces, scanDevicePorts, sendRaw } from "./engine";
import { loadControl } from "./actions-context";

export const restartHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    return applyHost("system.restart", undefined, memory().host, memory().vars, { allowAdmin: true });
  });

export const updateHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    const { roomOutboundBind, OUTBOUND_NONE_UPDATE_MESSAGE } = await import("./nics");
    const bind = roomOutboundBind(memory().config);
    if (!bind.ok) return { ok: false, message: bind.message };
    if (bind.none) return { ok: false, message: OUTBOUND_NONE_UPDATE_MESSAGE };
    return applyHost("system.update", undefined, memory().host, memory().vars, { allowAdmin: true });
  });

export const rebootHost = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
  const {
    ensureLoaded, memory, verifyStoredPin, validToken
  } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) return { ok: false, message: "PIN did not match" };
    return applyHost("system.reboot", undefined, memory().host, memory().vars, { allowReboot: true });
  });

export const listHostPorts = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
  const { validToken } = await loadControl();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", ports: [] as { kind: string; path: string; label: string }[] };
    return listHostInterfaces();
  });

export const listLanNics = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { ensureLoaded, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required", nics: [] as { index: number; name: string; ipv4: string | null; label: string }[] };
    const { listLanNics: scan } = await import("./nics");
    return { ok: true as const, nics: scan() };
  });

export const debugScan = createServerFn({ method: "POST" })
  .validator((data: { token: string; host: string; ports: number[] }) => data)
  .handler(async ({ data }) => {
  const { validToken } = await loadControl();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required", open: [] as number[] };
    return scanDevicePorts(data.host, data.ports);
  });

export const debugSend = createServerFn({ method: "POST" })
  .validator((data: { token: string; deviceId: string; payload: string; host?: string; port?: number; driver?: string; auth?: Record<string, string> }) => data)
  .handler(async ({ data }) => {
  const { ensureLoaded, memory, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    const mem = memory();
    const existing = mem.config.devices.find((d) => d.id === data.deviceId);
    const device = existing
      ? { ...existing, host: data.host ?? existing.host, port: data.port ?? existing.port, driver: data.driver ?? existing.driver, auth: data.auth ?? existing.auth, simulate: false }
      : null;
    if (!device) return { ok: false, message: "Save the device first" };
    return sendRaw({
      config: { ...mem.config, devices: [device] },
      drivers: mem.drivers,
      deviceId: data.deviceId,
      payload: data.payload,
    });
  });

export const wipeLog = createServerFn({ method: "POST" })
  .validator((data: { token?: string }) => data)
  .handler(async ({ data }) => {
  const { ensureLoaded, clearLog, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false, message: "Config lock required" };
    clearLog();
    return { ok: true };
  });

export const applyAvLanIp = createServerFn({ method: "POST" })
  .validator((data: {
    token: string;
    pin: string;
    mode: "static" | "dhcp";
    address?: string;
    prefix?: number;
  }) => data)
  .handler(async ({ data }) => {
    const {
      ensureLoaded,
      memory,
      verifyStoredPin,
      validToken,
      installRoomConfig,
      persistNow,
    } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) {
      return { ok: false as const, message: "PIN did not match" };
    }

    const {
      platformGate,
      validateIpv4Unicast,
      validatePrefix,
      listenHostConflict,
      resolveAvTarget,
      addressOnOtherIface,
      applyAvLanIpViaNmcli,
      createNmcliRunner,
      avLanIpSuccessHint,
      AV_LAN_IP_ADDRESS_ON_OTHER,
    } = await import("./av-lan-ip");

    const plat = platformGate();
    if (!plat.ok) return { ok: false as const, message: plat.message };

    const mode: "static" | "dhcp" = data.mode === "dhcp" ? "dhcp" : "static";
    let address = "";
    let prefix = 24;
    if (mode === "static") {
      const ip = validateIpv4Unicast(data.address ?? "");
      if (!ip.ok) return { ok: false as const, message: ip.message };
      const pref = validatePrefix(data.prefix);
      if (!pref.ok) return { ok: false as const, message: pref.message };
      address = ip.address;
      prefix = pref.prefix;
    }

    const conflict = listenHostConflict(process.env.RELAY_LISTEN_HOST, mode, address || null);
    if (!conflict.ok) return { ok: false as const, message: conflict.message };

    const { listLanNics, resolveNic } = await import("./nics");
    const mem = memory();
    const nics = listLanNics();
    const target = resolveAvTarget(
      { name: mem.config.room.avLanNicName, index: mem.config.room.avLanNicIndex ?? null },
      nics,
      resolveNic,
    );
    if (!target.ok) return { ok: false as const, message: target.message };
    const iface = target.nic.name;

    if (mode === "static" && addressOnOtherIface(nics, address, iface)) {
      return { ok: false as const, message: AV_LAN_IP_ADDRESS_ON_OTHER };
    }

    const runNmcli = createNmcliRunner();
    const applied = await applyAvLanIpViaNmcli({
      mode,
      device: iface,
      address: mode === "static" ? address : undefined,
      prefix: mode === "static" ? prefix : undefined,
      runNmcli,
    });
    if (!applied.ok) return { ok: false as const, message: applied.message };

    const nextNetwork = {
      ...mem.config.room.network,
      mode,
      address: mode === "static" ? address : "",
      prefix: mode === "static" ? prefix : mem.config.room.network?.prefix ?? 24,
      gateway: "",
    };
    const nextConfig = {
      ...mem.config,
      room: {
        ...mem.config.room,
        network: nextNetwork,
      },
    };
    installRoomConfig(nextConfig);
    try {
      await persistNow();
    } catch {
      return {
        ok: false as const,
        message: "OS apply succeeded but room.network save failed on disk — fix disk, then Restart Relay.",
      };
    }

    const portRaw = process.env.PORT || "8081";
    const port = Number(portRaw);
    const hint = avLanIpSuccessHint({
      mode,
      address: mode === "static" ? address : null,
      prefix: mode === "static" ? prefix : null,
      port: Number.isFinite(port) && port > 0 ? port : 8081,
    });

    const restart = await applyHost("system.restart", undefined, memory().host, memory().vars, {
      allowAdmin: true,
    });
    if (!restart.ok) {
      return {
        ok: false as const,
        message: `${hint} Persist ok, but restart failed: ${restart.message || "unknown"}. Restart Relay manually.`,
      };
    }
    return {
      ok: true as const,
      message: hint,
      panelUrl:
        mode === "static" && address
          ? `http://${address}:${Number.isFinite(port) && port > 0 ? port : 8081}/`
          : null,
    };
  });

export const listVideoOutputs = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { ensureLoaded, validToken } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) {
      return { ok: false as const, message: "Config lock required", outputs: [] as { index: number; name: string; connected: boolean; label: string }[] };
    }
    const { listVideoOutputs: scan } = await import("./video-outputs");
    return { ok: true as const, outputs: scan() };
  });

export const applyPanelHdmi = createServerFn({ method: "POST" })
  .validator((data: {
    token: string;
    pin: string;
    enabled: boolean;
    outputName?: string | null;
    outputIndex?: number | null;
    restart?: boolean;
  }) => data)
  .handler(async ({ data }) => {
    const {
      ensureLoaded,
      memory,
      verifyStoredPin,
      validToken,
      installRoomConfig,
      persistNow,
    } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) {
      return { ok: false as const, message: "PIN did not match" };
    }

    const { platformGate, enableLocalOutput } = await import("./kiosk");
    const { listVideoOutputs: scan, resolveVideoOutput } = await import("./video-outputs");
    const { writeRelayKioskEnv, livePanelKioskUrl } = await import("./panel-kiosk-env");

    const outputs = scan();
    const enabled = Boolean(data.enabled);
    let outputName: string | null = data.outputName != null && String(data.outputName).trim()
      ? String(data.outputName).trim()
      : null;
    let outputIndex: number | null =
      data.outputIndex != null && Number.isFinite(Number(data.outputIndex))
        ? Number(data.outputIndex)
        : null;

    if (enabled) {
      const row = resolveVideoOutput(
        { panelHdmiOutputName: outputName, panelHdmiOutputIndex: outputIndex },
        outputs,
      );
      if (!row || row.name === "local") {
        return {
          ok: false as const,
          message: "Pick a local video output (HDMI/DP). None listed — check /sys/class/drm on Linux.",
        };
      }
      outputName = row.name;
      outputIndex = row.index;
    }

    const mem = memory();
    const nextConfig = {
      ...mem.config,
      room: {
        ...mem.config.room,
        panelHdmiEnabled: enabled,
        panelHdmiOutputName: enabled ? outputName : null,
        panelHdmiOutputIndex: enabled ? outputIndex : null,
      },
    };
    installRoomConfig(nextConfig);

    let kioskUrl: string | null = null;
    if (enabled) {
      const written = writeRelayKioskEnv(nextConfig.room, { outputs });
      if (!written.ok) {
        try {
          await persistNow();
        } catch {
          /* still report URL failure */
        }
        return {
          ok: false as const,
          message: written.reason,
        };
      }
      kioskUrl = written.url;
    }

    try {
      await persistNow();
    } catch {
      return { ok: false as const, message: "Could not save room HDMI settings to disk." };
    }

    if (!enabled) {
      return {
        ok: true as const,
        message: "Local HDMI panel disabled (saved). Kiosk unit was not restarted.",
        kioskUrl: null as string | null,
        restarted: false,
      };
    }

    const urlPreview = livePanelKioskUrl(nextConfig.room);
    if (urlPreview.ok) kioskUrl = urlPreview.url;

    const wantRestart = data.restart !== false;
    if (!wantRestart) {
      return {
        ok: true as const,
        message: `Saved. Kiosk URL ${kioskUrl}. Start/restart when ready.`,
        kioskUrl,
        restarted: false,
      };
    }

    const plat = platformGate();
    if (!plat.ok) {
      return {
        ok: true as const,
        message: `${plat.message} Settings and env saved${kioskUrl ? ` (${kioskUrl})` : ""}.`,
        kioskUrl,
        restarted: false,
      };
    }

    const restart = enableLocalOutput();
    if (!restart.ok) {
      return {
        ok: false as const,
        message: `Saved env (${kioskUrl}), but kiosk restart failed: ${restart.detail}`,
        kioskUrl,
        restarted: false,
      };
    }
    return {
      ok: true as const,
      message: `Panel kiosk restarted on ${outputName}. URL ${kioskUrl}`,
      kioskUrl,
      restarted: true,
      via: restart.via,
    };
  });

export const restartPanelKiosk = createServerFn({ method: "POST" })
  .validator((data: { token: string; pin: string }) => data)
  .handler(async ({ data }) => {
    const {
      ensureLoaded,
      memory,
      verifyStoredPin,
      validToken,
      persistNow,
    } = await loadControl();
    await ensureLoaded();
    if (!validToken(data.token, "config")) return { ok: false as const, message: "Config lock required" };
    if (!verifyStoredPin(data.pin, memory().config.room.configPin)) {
      return { ok: false as const, message: "PIN did not match" };
    }

    const room = memory().config.room;
    if (!room.panelHdmiEnabled) {
      return { ok: false as const, message: "Local HDMI panel is disabled. Enable it under Room → Local display, then retry." };
    }

    const { writeRelayKioskEnv } = await import("./panel-kiosk-env");
    const { platformGate, enableLocalOutput } = await import("./kiosk");

    const written = writeRelayKioskEnv(room);
    if (!written.ok) return { ok: false as const, message: written.reason };
    try {
      await persistNow();
    } catch {
      /* env already on disk; room unchanged */
    }

    const plat = platformGate();
    if (!plat.ok) return { ok: false as const, message: plat.message, kioskUrl: written.url };

    const restart = enableLocalOutput();
    if (!restart.ok) {
      return {
        ok: false as const,
        message: `Env written (${written.url}), but restart failed: ${restart.detail}`,
        kioskUrl: written.url,
      };
    }
    return {
      ok: true as const,
      message: `Panel kiosk restarted. URL ${written.url}`,
      kioskUrl: written.url,
      via: restart.via,
    };
  });
