import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "./ssr.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/actions-MWPO7Yz5.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
function applySim(command, value, slot) {
	const id = command.id;
	if (id.endsWith(".on")) {
		const prefix = id.slice(0, -3);
		if (`${prefix}.state` in slot || true) slot[`${prefix}.state`] = "on";
		if (prefix === "power") slot["power.state"] = "on";
		if (id === "mute.on") slot["mute.state"] = "on";
		if (id === "lights" || prefix === "power") {}
	}
	if (id.endsWith(".off")) {
		const prefix = id.slice(0, -4);
		slot[`${prefix}.state`] = "off";
		if (prefix === "power") slot["power.state"] = "off";
		if (id === "mute.off") slot["mute.state"] = "off";
	}
	if (command.kind === "range" && value !== void 0) {
		if (id === "volume.set") slot["volume.level"] = Number(value);
		else if (id === "level.set") {
			slot["level.value"] = Number(value);
			slot["power.state"] = Number(value) > 0 ? "on" : "off";
		} else if (id === "position.set") slot["position.level"] = Number(value);
		else slot[id] = Number(value);
	}
	if (id === "position.open") slot["position.level"] = 100;
	if (id === "position.close") slot["position.level"] = 0;
	if (id.startsWith("input.")) slot["input.current"] = id.split(".")[1] ?? "";
	if (id.startsWith("source.")) slot["source.current"] = id.split(".")[1] ?? "";
	if (id.startsWith("scene.")) {
		slot["scene.current"] = id.split(".")[1] ?? "";
		slot["power.state"] = "on";
		if (id === "scene.movie") slot["level.value"] = 18;
		if (id === "scene.present") slot["level.value"] = 85;
	}
	if (id.startsWith("preset.")) slot["preset.current"] = id.split(".")[1] ?? "";
}
function renderPayload(template, value, auth = {}) {
	let out = template.replaceAll("{value}", String(value ?? ""));
	out = out.replaceAll("{value:ascii}", String(value ?? ""));
	if (out.includes("{value:hex2}")) {
		const n = Number(value ?? 0);
		const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
		out = out.replaceAll("{value:hex2}", hex);
	}
	for (const [k, v] of Object.entries(auth)) out = out.replaceAll(`{auth.${k}}`, v);
	return out;
}
async function sendLan(driver, device, payload) {
	const lan = driver.transports.lan;
	if (!lan) return {
		ok: false,
		message: "No LAN transport on this driver"
	};
	if (device.transport === "rs232") return {
		ok: false,
		message: "RS-232 is stubbed for a later hardware release"
	};
	const timeout = lan.timeoutMs ?? 1e3;
	if (lan.protocol === "http") {
		const path = lan.http?.path ?? "/";
		const url = `http://${device.host}:${lan.port}${path}`;
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), timeout);
		try {
			const res = await fetch(url, {
				method: lan.http?.method ?? "POST",
				headers: {
					"content-type": lan.http?.contentType ?? "text/plain",
					...lan.http?.headers ?? {}
				},
				body: payload,
				signal: ctrl.signal
			});
			const text = await res.text();
			return {
				ok: res.ok,
				message: text.slice(0, 200) || res.statusText
			};
		} catch (err) {
			return {
				ok: false,
				message: err instanceof Error ? err.message : "LAN request failed"
			};
		} finally {
			clearTimeout(t);
		}
	}
	if (lan.protocol === "tcp") try {
		const net = await import("node:net");
		return {
			ok: true,
			message: (await new Promise((resolve, reject) => {
				const sock = net.connect({
					host: device.host,
					port: lan.port
				});
				let buf = "";
				const timer = setTimeout(() => {
					sock.destroy();
					reject(/* @__PURE__ */ new Error("TCP timeout"));
				}, timeout);
				sock.on("connect", () => {
					sock.write(payload + (lan.lineEnding ?? "\r"));
				});
				sock.on("data", (d) => {
					buf += d.toString();
					if (buf.length > 0) {
						clearTimeout(timer);
						sock.end();
						resolve(buf);
					}
				});
				sock.on("error", (e) => {
					clearTimeout(timer);
					reject(e);
				});
				sock.on("end", () => {
					clearTimeout(timer);
					resolve(buf);
				});
			})).slice(0, 200)
		};
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : "TCP failed"
		};
	}
	return {
		ok: false,
		message: `Protocol ${lan.protocol} not implemented in v1`
	};
}
function commandById(driver, id) {
	return driver.commands.find((c) => c.id === id);
}
function featureAllowed(device, featureId) {
	return device.enabledFeatures.includes(featureId);
}
function guardOk(requires, slot) {
	if (!requires?.length) return true;
	return requires.every((rule) => {
		const [key, val] = rule.split("=");
		if (!key) return true;
		if (val === void 0) return true;
		return String(slot[key] ?? "") === val;
	});
}
async function executeCommand(opts) {
	const device = opts.config.devices.find((d) => d.id === opts.deviceId);
	if (!device) return {
		ok: false,
		message: "Unknown device"
	};
	const driver = opts.drivers[device.driver];
	if (!driver) return {
		ok: false,
		message: "Driver missing"
	};
	if (!featureAllowed(device, opts.commandId)) return {
		ok: false,
		message: "Feature not enabled"
	};
	const command = commandById(driver, opts.commandId);
	if (!command) return {
		ok: false,
		message: "Unknown command"
	};
	const slot = opts.state[device.id] ??= {};
	if (!guardOk(command.requires, slot)) return {
		ok: false,
		message: `Blocked: ${command.requires?.join(", ")}`
	};
	if (device.simulate) {
		await sleep(Math.min(driver.pacing?.minIntervalMs ?? 80, 400));
		applySim(command, opts.value, slot);
		return {
			ok: true,
			message: "simulated"
		};
	}
	const result = await sendLan(driver, device, renderPayload(command.payload, opts.value, device.auth));
	if (result.ok) applySim(command, opts.value, slot);
	return result;
}
async function runMacro(opts) {
	const attempts = Math.max(0, opts.macro.retries) + 1;
	let last = {
		ok: false,
		message: "empty macro"
	};
	for (let i = 0; i < attempts; i++) {
		last = await runMacroOnce(opts);
		if (last.ok) return last;
	}
	if (opts.macro.onFail.kind === "macro" && opts.macro.onFail.id) {
		const fallback = opts.config.macros.find((m) => m.id === opts.macro.onFail.id);
		if (fallback && fallback.id !== opts.macro.id) return runMacro({
			...opts,
			macro: fallback
		});
	}
	return last;
}
async function runMacroOnce(opts) {
	for (const step of opts.macro.steps) {
		const slot = opts.state[step.device] ?? {};
		if (step.skipIf && String(slot[step.skipIf.feedback] ?? "") === step.skipIf.equals) continue;
		const result = await executeCommand({
			config: opts.config,
			drivers: opts.drivers,
			state: opts.state,
			deviceId: step.device,
			commandId: step.command,
			value: step.value
		});
		if (!result.ok) return {
			ok: false,
			message: `${step.device}.${step.command}: ${result.message}`
		};
		if (step.delayMsAfter) await sleep(step.delayMsAfter);
	}
	return {
		ok: true,
		message: "ok"
	};
}
async function probeDevice(opts) {
	const device = opts.config.devices.find((d) => d.id === opts.deviceId);
	if (!device) return {
		ok: false,
		message: "Unknown device"
	};
	const driver = opts.drivers[device.driver];
	if (!driver) return {
		ok: false,
		message: "Driver missing"
	};
	if (device.simulate) return {
		ok: true,
		message: "Simulation online"
	};
	if (!driver.probe) return {
		ok: false,
		message: "No probe defined"
	};
	return sendLan(driver, device, driver.probe.payload);
}
var DEFAULT_CONFIG_PIN = "1234";
var lgDisplayDriver = {
	specVersion: "1.0",
	device: {
		manufacturer: "LG",
		model: "OLED55C3",
		type: "display",
		notes: "IP control demo driver. Simulated by default."
	},
	transports: {
		lan: {
			protocol: "tcp",
			port: 9761,
			encoding: "ascii",
			lineEnding: "\r",
			timeoutMs: 1e3
		},
		rs232: {
			baud: 9600,
			dataBits: 8,
			parity: "none",
			stopBits: 1,
			encoding: "ascii",
			lineEnding: "\r",
			timeoutMs: 1e3
		}
	},
	auth: {
		type: "none",
		instanceFields: []
	},
	session: {
		connect: [],
		keepalive: {
			payload: null,
			intervalMs: 0
		},
		disconnect: []
	},
	pacing: {
		minIntervalMs: 120,
		powerOnDelayMs: 3e3
	},
	probe: {
		transport: "lan",
		payload: "ka 01 ff",
		success: {
			type: "contains",
			value: "OK"
		}
	},
	helpers: { checksum: "none" },
	commands: [
		{
			id: "power.on",
			label: "Power On",
			kind: "action",
			transport: "lan",
			payload: "ka 01 01",
			requires: [],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "power.off",
			label: "Power Off",
			kind: "action",
			transport: "lan",
			payload: "ka 01 00",
			requires: [],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "volume.set",
			label: "Set Volume",
			kind: "range",
			min: 0,
			max: 100,
			step: 1,
			unit: "%",
			transport: "lan",
			payload: "kf 01 {value:hex2}",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "input.hdmi1",
			label: "HDMI 1",
			kind: "action",
			transport: "lan",
			payload: "xb 01 90",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "input.hdmi2",
			label: "HDMI 2",
			kind: "action",
			transport: "lan",
			payload: "xb 01 91",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "input.usb",
			label: "USB",
			kind: "action",
			transport: "lan",
			payload: "xb 01 10",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "mute.on",
			label: "Mute",
			kind: "action",
			transport: "lan",
			payload: "ke 01 01",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		},
		{
			id: "mute.off",
			label: "Unmute",
			kind: "action",
			transport: "lan",
			payload: "ke 01 00",
			requires: ["power.state=on"],
			ack: { success: {
				type: "contains",
				value: "OK"
			} }
		}
	],
	feedback: [
		{
			id: "power.state",
			label: "Power",
			kind: "enum",
			values: ["off", "on"],
			transport: "lan",
			mode: "poll",
			query: "ka 01 ff",
			pollMs: 2e3,
			parse: {
				type: "regex",
				pattern: "OK([0-9A-Fa-f]+)",
				map: {
					"00": "off",
					"01": "on"
				}
			}
		},
		{
			id: "volume.level",
			label: "Volume",
			kind: "range",
			min: 0,
			max: 100,
			transport: "lan",
			mode: "poll",
			query: "kf 01 ff",
			pollMs: 2e3,
			parse: {
				type: "regex",
				pattern: "OK([0-9A-Fa-f]+)"
			}
		},
		{
			id: "input.current",
			label: "Input",
			kind: "enum",
			values: [
				"hdmi1",
				"hdmi2",
				"usb"
			],
			transport: "lan",
			mode: "poll",
			query: "xb 01 ff",
			pollMs: 3e3,
			parse: {
				type: "contains",
				value: "OK"
			}
		},
		{
			id: "mute.state",
			label: "Mute",
			kind: "enum",
			values: ["off", "on"],
			transport: "lan",
			mode: "poll",
			query: "ke 01 ff",
			pollMs: 3e3,
			parse: {
				type: "regex",
				pattern: "OK([0-9A-Fa-f]+)",
				map: {
					"00": "off",
					"01": "on"
				}
			}
		}
	]
};
var ampDriver = {
	specVersion: "1.0",
	device: {
		manufacturer: "Generic",
		model: "LAN-AMP",
		type: "amplifier",
		notes: "HTTP JSON demo amplifier."
	},
	transports: { lan: {
		protocol: "http",
		port: 80,
		timeoutMs: 1500,
		http: {
			method: "POST",
			path: "/api",
			contentType: "application/json"
		}
	} },
	auth: {
		type: "none",
		instanceFields: []
	},
	pacing: {
		minIntervalMs: 80,
		powerOnDelayMs: 800
	},
	probe: {
		transport: "lan",
		payload: "{\"cmd\":\"ping\"}",
		success: {
			type: "contains",
			value: "ok"
		}
	},
	helpers: { checksum: "none" },
	commands: [
		{
			id: "power.on",
			label: "Power On",
			kind: "action",
			transport: "lan",
			payload: "{\"cmd\":\"power\",\"value\":\"on\"}"
		},
		{
			id: "power.off",
			label: "Power Off",
			kind: "action",
			transport: "lan",
			payload: "{\"cmd\":\"power\",\"value\":\"off\"}"
		},
		{
			id: "volume.set",
			label: "Set Volume",
			kind: "range",
			min: 0,
			max: 80,
			step: 1,
			unit: "dB",
			transport: "lan",
			payload: "{\"cmd\":\"volume\",\"value\":{value}}"
		},
		{
			id: "source.tv",
			label: "Source TV",
			kind: "action",
			transport: "lan",
			payload: "{\"cmd\":\"source\",\"value\":\"tv\"}"
		},
		{
			id: "source.aux",
			label: "Source Aux",
			kind: "action",
			transport: "lan",
			payload: "{\"cmd\":\"source\",\"value\":\"aux\"}"
		}
	],
	feedback: [
		{
			id: "power.state",
			label: "Power",
			kind: "enum",
			values: ["off", "on"],
			transport: "lan",
			mode: "poll",
			query: "{\"cmd\":\"power?\"}",
			pollMs: 2e3,
			parse: {
				type: "jsonpath",
				path: "power"
			}
		},
		{
			id: "volume.level",
			label: "Volume",
			kind: "range",
			min: 0,
			max: 80,
			transport: "lan",
			mode: "poll",
			query: "{\"cmd\":\"volume?\"}",
			pollMs: 2e3,
			parse: {
				type: "jsonpath",
				path: "volume"
			}
		},
		{
			id: "source.current",
			label: "Source",
			kind: "enum",
			values: ["tv", "aux"],
			transport: "lan",
			mode: "poll",
			query: "{\"cmd\":\"source?\"}",
			pollMs: 3e3,
			parse: {
				type: "jsonpath",
				path: "source"
			}
		}
	]
};
var lightsDriver = {
	specVersion: "1.0",
	device: {
		manufacturer: "Generic",
		model: "RoomLights",
		type: "lighting"
	},
	transports: { lan: {
		protocol: "http",
		port: 8088,
		timeoutMs: 1200,
		http: {
			method: "PUT",
			path: "/light",
			contentType: "application/json"
		}
	} },
	auth: {
		type: "token",
		instanceFields: ["token"]
	},
	pacing: { minIntervalMs: 50 },
	probe: {
		transport: "lan",
		payload: "{}",
		success: {
			type: "contains",
			value: "ok"
		}
	},
	helpers: { checksum: "none" },
	commands: [
		{
			id: "power.on",
			label: "Lights On",
			kind: "action",
			transport: "lan",
			payload: "{\"on\":true}"
		},
		{
			id: "power.off",
			label: "Lights Off",
			kind: "action",
			transport: "lan",
			payload: "{\"on\":false}"
		},
		{
			id: "level.set",
			label: "Dimmer",
			kind: "range",
			min: 0,
			max: 100,
			step: 1,
			unit: "%",
			transport: "lan",
			payload: "{\"bri\":{value}}"
		},
		{
			id: "scene.present",
			label: "Present scene",
			kind: "action",
			transport: "lan",
			payload: "{\"scene\":\"present\"}"
		},
		{
			id: "scene.movie",
			label: "Movie scene",
			kind: "action",
			transport: "lan",
			payload: "{\"scene\":\"movie\"}"
		}
	],
	feedback: [
		{
			id: "power.state",
			label: "Power",
			kind: "enum",
			values: ["off", "on"],
			transport: "lan",
			mode: "poll",
			pollMs: 2500,
			parse: {
				type: "jsonpath",
				path: "on"
			}
		},
		{
			id: "level.value",
			label: "Level",
			kind: "range",
			min: 0,
			max: 100,
			transport: "lan",
			mode: "poll",
			pollMs: 2500,
			parse: {
				type: "jsonpath",
				path: "bri"
			}
		},
		{
			id: "scene.current",
			label: "Scene",
			kind: "enum",
			values: [
				"present",
				"movie",
				"off"
			],
			transport: "lan",
			mode: "poll",
			pollMs: 4e3,
			parse: {
				type: "jsonpath",
				path: "scene"
			}
		}
	]
};
var blindsDriver = {
	specVersion: "1.0",
	device: {
		manufacturer: "Generic",
		model: "ShadeBus",
		type: "shades"
	},
	transports: { lan: {
		protocol: "tcp",
		port: 23,
		encoding: "ascii",
		lineEnding: "\r\n",
		timeoutMs: 1500
	} },
	auth: { type: "none" },
	pacing: { minIntervalMs: 200 },
	probe: {
		transport: "lan",
		payload: "STATUS",
		success: {
			type: "contains",
			value: "OK"
		}
	},
	helpers: { checksum: "none" },
	commands: [
		{
			id: "position.open",
			label: "Open",
			kind: "action",
			transport: "lan",
			payload: "OPEN"
		},
		{
			id: "position.close",
			label: "Close",
			kind: "action",
			transport: "lan",
			payload: "CLOSE"
		},
		{
			id: "position.set",
			label: "Set position",
			kind: "range",
			min: 0,
			max: 100,
			step: 5,
			unit: "%",
			transport: "lan",
			payload: "POS {value}"
		}
	],
	feedback: [{
		id: "position.level",
		label: "Position",
		kind: "range",
		min: 0,
		max: 100,
		transport: "lan",
		mode: "poll",
		query: "STATUS",
		pollMs: 3e3,
		parse: {
			type: "regex",
			pattern: "POS=(\\d+)"
		}
	}]
};
var ptzDriver = {
	specVersion: "1.0",
	device: {
		manufacturer: "Generic",
		model: "PTZ-20x",
		type: "camera"
	},
	transports: { lan: {
		protocol: "http",
		port: 80,
		timeoutMs: 2e3,
		http: {
			method: "GET",
			path: "/cgi-bin/ptz"
		}
	} },
	auth: {
		type: "password",
		instanceFields: ["user", "password"]
	},
	pacing: { minIntervalMs: 150 },
	probe: {
		transport: "lan",
		payload: "cmd=version",
		success: {
			type: "contains",
			value: "PTZ"
		}
	},
	helpers: { checksum: "none" },
	commands: [
		{
			id: "preset.1",
			label: "Preset 1",
			kind: "action",
			transport: "lan",
			payload: "cmd=preset&n=1"
		},
		{
			id: "preset.2",
			label: "Preset 2",
			kind: "action",
			transport: "lan",
			payload: "cmd=preset&n=2"
		},
		{
			id: "preset.3",
			label: "Preset 3",
			kind: "action",
			transport: "lan",
			payload: "cmd=preset&n=3"
		},
		{
			id: "power.on",
			label: "Camera On",
			kind: "action",
			transport: "lan",
			payload: "cmd=power&v=on"
		},
		{
			id: "power.off",
			label: "Camera Off",
			kind: "action",
			transport: "lan",
			payload: "cmd=power&v=off"
		}
	],
	feedback: [{
		id: "power.state",
		label: "Power",
		kind: "enum",
		values: ["off", "on"],
		transport: "lan",
		mode: "poll",
		pollMs: 4e3,
		parse: {
			type: "contains",
			value: "on"
		}
	}, {
		id: "preset.current",
		label: "Preset",
		kind: "enum",
		values: [
			"1",
			"2",
			"3"
		],
		transport: "lan",
		mode: "poll",
		pollMs: 4e3,
		parse: {
			type: "regex",
			pattern: "preset=(\\d+)"
		}
	}]
};
var bundledDrivers = {
	"lg-oled55c3.json": lgDisplayDriver,
	"lan-amp.json": ampDriver,
	"room-lights.json": lightsDriver,
	"shade-bus.json": blindsDriver,
	"ptz-20x.json": ptzDriver
};
function defaultRoomConfig() {
	return {
		configVersion: "1.0",
		exportedAt: null,
		sourceRoomId: null,
		room: {
			id: "room-a",
			name: "Conference A",
			panelAccess: "open",
			panelPin: null,
			configPin: DEFAULT_CONFIG_PIN,
			theme: "dark",
			idleDimSeconds: 90
		},
		devices: [
			{
				id: "tv",
				name: "Display",
				driver: "lg-oled55c3.json",
				transport: "lan",
				host: "10.0.10.21",
				auth: {},
				enabledFeatures: [
					"power.on",
					"power.off",
					"volume.set",
					"input.hdmi1",
					"input.hdmi2",
					"input.usb",
					"mute.on",
					"mute.off",
					"power.state",
					"volume.level",
					"input.current",
					"mute.state"
				],
				simulate: true
			},
			{
				id: "amp",
				name: "Amplifier",
				driver: "lan-amp.json",
				transport: "lan",
				host: "10.0.10.22",
				auth: {},
				enabledFeatures: [
					"power.on",
					"power.off",
					"volume.set",
					"source.tv",
					"source.aux",
					"power.state",
					"volume.level",
					"source.current"
				],
				simulate: true
			},
			{
				id: "lights",
				name: "Lights",
				driver: "room-lights.json",
				transport: "lan",
				host: "10.0.10.30",
				auth: {},
				enabledFeatures: [
					"power.on",
					"power.off",
					"level.set",
					"scene.present",
					"scene.movie",
					"power.state",
					"level.value",
					"scene.current"
				],
				simulate: true
			},
			{
				id: "blinds",
				name: "Blinds",
				driver: "shade-bus.json",
				transport: "lan",
				host: "10.0.10.31",
				auth: {},
				enabledFeatures: [
					"position.open",
					"position.close",
					"position.set",
					"position.level"
				],
				simulate: true
			},
			{
				id: "cam",
				name: "Camera",
				driver: "ptz-20x.json",
				transport: "lan",
				host: "10.0.10.40",
				auth: {},
				enabledFeatures: [
					"preset.1",
					"preset.2",
					"preset.3",
					"power.on",
					"power.off",
					"power.state",
					"preset.current"
				],
				simulate: true
			}
		],
		pages: [
			{
				id: "home",
				label: "Home",
				grid: {
					cols: 6,
					rows: 8
				},
				widgets: [
					{
						id: "w-watch",
						type: "button",
						x: 0,
						y: 0,
						w: 2,
						h: 2,
						label: "Watch",
						color: "steel",
						icon: "tv",
						confirm: false,
						bind: {
							kind: "macro",
							id: "watch-tv"
						}
					},
					{
						id: "w-present",
						type: "button",
						x: 2,
						y: 0,
						w: 2,
						h: 2,
						label: "Present",
						color: "sage",
						icon: "presentation",
						confirm: false,
						bind: {
							kind: "macro",
							id: "present"
						}
					},
					{
						id: "w-off",
						type: "button",
						x: 4,
						y: 0,
						w: 2,
						h: 2,
						label: "All Off",
						color: "clay",
						icon: "power",
						confirm: true,
						bind: {
							kind: "macro",
							id: "all-off"
						}
					},
					{
						id: "w-tv-pwr",
						type: "status",
						x: 0,
						y: 2,
						w: 3,
						h: 1,
						label: "Display",
						color: "fog",
						icon: "monitor",
						bind: {
							kind: "feedback",
							device: "tv",
							feedback: "power.state"
						}
					},
					{
						id: "w-amp-pwr",
						type: "status",
						x: 3,
						y: 2,
						w: 3,
						h: 1,
						label: "Amp",
						color: "fog",
						icon: "speaker",
						bind: {
							kind: "feedback",
							device: "amp",
							feedback: "power.state"
						}
					},
					{
						id: "w-vol",
						type: "slider",
						x: 0,
						y: 3,
						w: 6,
						h: 1,
						label: "Volume",
						color: "steel",
						enableWhen: {
							device: "tv",
							feedback: "power.state",
							equals: "on"
						},
						bind: {
							kind: "range",
							device: "tv",
							command: "volume.set",
							feedback: "volume.level"
						}
					},
					{
						id: "w-lights",
						type: "slider",
						x: 0,
						y: 4,
						w: 6,
						h: 1,
						label: "Lights",
						color: "sage",
						bind: {
							kind: "range",
							device: "lights",
							command: "level.set",
							feedback: "level.value"
						}
					},
					{
						id: "w-blinds",
						type: "slider",
						x: 0,
						y: 5,
						w: 6,
						h: 1,
						label: "Blinds",
						color: "fog",
						bind: {
							kind: "range",
							device: "blinds",
							command: "position.set",
							feedback: "position.level"
						}
					},
					{
						id: "w-src",
						type: "button",
						x: 0,
						y: 6,
						w: 3,
						h: 2,
						label: "Sources",
						color: "ink",
						icon: "waypoints",
						bind: {
							kind: "gotoPage",
							id: "sources"
						}
					},
					{
						id: "w-cam",
						type: "button",
						x: 3,
						y: 6,
						w: 3,
						h: 2,
						label: "Camera",
						color: "ink",
						icon: "video",
						bind: {
							kind: "gotoPage",
							id: "camera"
						}
					}
				]
			},
			{
				id: "sources",
				label: "Sources",
				grid: {
					cols: 6,
					rows: 6
				},
				widgets: [
					{
						id: "s-home",
						type: "button",
						x: 0,
						y: 0,
						w: 2,
						h: 1,
						label: "Home",
						color: "ink",
						icon: "house",
						bind: {
							kind: "gotoPage",
							id: "home"
						}
					},
					{
						id: "s-title",
						type: "label",
						x: 2,
						y: 0,
						w: 4,
						h: 1,
						label: "Inputs",
						color: "fog",
						bind: {
							kind: "gotoPage",
							id: "sources"
						}
					},
					{
						id: "s-hdmi1",
						type: "button",
						x: 0,
						y: 1,
						w: 3,
						h: 2,
						label: "HDMI 1",
						color: "steel",
						icon: "hdmi",
						enableWhen: {
							device: "tv",
							feedback: "power.state",
							equals: "on"
						},
						bind: {
							kind: "command",
							device: "tv",
							command: "input.hdmi1"
						}
					},
					{
						id: "s-hdmi2",
						type: "button",
						x: 3,
						y: 1,
						w: 3,
						h: 2,
						label: "HDMI 2",
						color: "steel",
						icon: "hdmi",
						enableWhen: {
							device: "tv",
							feedback: "power.state",
							equals: "on"
						},
						bind: {
							kind: "command",
							device: "tv",
							command: "input.hdmi2"
						}
					},
					{
						id: "s-usb",
						type: "button",
						x: 0,
						y: 3,
						w: 3,
						h: 2,
						label: "USB",
						color: "fog",
						bind: {
							kind: "command",
							device: "tv",
							command: "input.usb"
						}
					},
					{
						id: "s-aux",
						type: "button",
						x: 3,
						y: 3,
						w: 3,
						h: 2,
						label: "Amp Aux",
						color: "sage",
						bind: {
							kind: "command",
							device: "amp",
							command: "source.aux"
						}
					}
				]
			},
			{
				id: "camera",
				label: "Camera",
				grid: {
					cols: 6,
					rows: 6
				},
				widgets: [
					{
						id: "c-home",
						type: "button",
						x: 0,
						y: 0,
						w: 2,
						h: 1,
						label: "Home",
						color: "ink",
						icon: "house",
						bind: {
							kind: "gotoPage",
							id: "home"
						}
					},
					{
						id: "c-st",
						type: "status",
						x: 2,
						y: 0,
						w: 4,
						h: 1,
						label: "Preset",
						color: "fog",
						bind: {
							kind: "feedback",
							device: "cam",
							feedback: "preset.current"
						}
					},
					{
						id: "c-p1",
						type: "button",
						x: 0,
						y: 1,
						w: 2,
						h: 2,
						label: "Desk",
						color: "steel",
						icon: "user",
						bind: {
							kind: "command",
							device: "cam",
							command: "preset.1"
						}
					},
					{
						id: "c-p2",
						type: "button",
						x: 2,
						y: 1,
						w: 2,
						h: 2,
						label: "Board",
						color: "steel",
						icon: "users",
						bind: {
							kind: "command",
							device: "cam",
							command: "preset.2"
						}
					},
					{
						id: "c-p3",
						type: "button",
						x: 4,
						y: 1,
						w: 2,
						h: 2,
						label: "Wide",
						color: "steel",
						icon: "scan",
						bind: {
							kind: "command",
							device: "cam",
							command: "preset.3"
						}
					},
					{
						id: "c-on",
						type: "button",
						x: 0,
						y: 3,
						w: 3,
						h: 2,
						label: "Camera On",
						color: "sage",
						bind: {
							kind: "command",
							device: "cam",
							command: "power.on"
						}
					},
					{
						id: "c-off",
						type: "button",
						x: 3,
						y: 3,
						w: 3,
						h: 2,
						label: "Camera Off",
						color: "clay",
						confirm: true,
						bind: {
							kind: "command",
							device: "cam",
							command: "power.off"
						}
					}
				]
			}
		],
		macros: [
			{
				id: "watch-tv",
				label: "Watch TV",
				retries: 2,
				onFail: { kind: "none" },
				steps: [
					{
						device: "tv",
						command: "power.on",
						skipIf: {
							feedback: "power.state",
							equals: "on"
						},
						delayMsAfter: 400
					},
					{
						device: "amp",
						command: "power.on",
						skipIf: {
							feedback: "power.state",
							equals: "on"
						},
						delayMsAfter: 200
					},
					{
						device: "tv",
						command: "input.hdmi1",
						delayMsAfter: 150
					},
					{
						device: "amp",
						command: "source.tv",
						delayMsAfter: 150
					},
					{
						device: "tv",
						command: "volume.set",
						value: 22,
						delayMsAfter: 80
					},
					{
						device: "lights",
						command: "scene.movie",
						delayMsAfter: 80
					},
					{
						device: "blinds",
						command: "position.set",
						value: 20
					}
				]
			},
			{
				id: "present",
				label: "Present",
				retries: 2,
				onFail: { kind: "none" },
				steps: [
					{
						device: "tv",
						command: "power.on",
						skipIf: {
							feedback: "power.state",
							equals: "on"
						},
						delayMsAfter: 400
					},
					{
						device: "amp",
						command: "power.on",
						delayMsAfter: 200
					},
					{
						device: "tv",
						command: "input.hdmi2",
						delayMsAfter: 150
					},
					{
						device: "lights",
						command: "scene.present",
						delayMsAfter: 80
					},
					{
						device: "blinds",
						command: "position.open",
						delayMsAfter: 80
					},
					{
						device: "cam",
						command: "power.on",
						delayMsAfter: 80
					},
					{
						device: "cam",
						command: "preset.2"
					}
				]
			},
			{
				id: "all-off",
				label: "All Off",
				retries: 1,
				onFail: { kind: "none" },
				steps: [
					{
						device: "tv",
						command: "power.off",
						delayMsAfter: 120
					},
					{
						device: "amp",
						command: "power.off",
						delayMsAfter: 120
					},
					{
						device: "cam",
						command: "power.off",
						delayMsAfter: 120
					},
					{
						device: "lights",
						command: "power.off",
						delayMsAfter: 80
					},
					{
						device: "blinds",
						command: "position.close"
					}
				]
			}
		]
	};
}
function defaultDeviceState() {
	return {
		tv: {
			"power.state": "off",
			"volume.level": 18,
			"input.current": "hdmi1",
			"mute.state": "off"
		},
		amp: {
			"power.state": "off",
			"volume.level": 30,
			"source.current": "tv"
		},
		lights: {
			"power.state": "on",
			"level.value": 70,
			"scene.current": "present"
		},
		blinds: { "position.level": 40 },
		cam: {
			"power.state": "off",
			"preset.current": "1"
		}
	};
}
var ROW_ID = "current";
var g = globalThis;
function emptyMemory() {
	return {
		config: defaultRoomConfig(),
		drivers: { ...bundledDrivers },
		state: defaultDeviceState(),
		lastError: null,
		runningMacro: null
	};
}
function memory() {
	if (!g.__relayMemory__) g.__relayMemory__ = emptyMemory();
	return g.__relayMemory__;
}
async function sqlOrNull() {
	if (!(typeof process !== "undefined" ? process.env.DATABASE_URL : void 0)) return null;
	try {
		const { getSql } = await import("./db-CSxY9Xea.mjs");
		return await getSql();
	} catch {
		return null;
	}
}
async function loadPersisted() {
	const mem = memory();
	const sql = await sqlOrNull();
	if (!sql) return mem;
	try {
		const row = (await sql`select config_json, drivers_json, state_json from room_store where id = ${ROW_ID}`)[0];
		if (!row) {
			await persist();
			return mem;
		}
		mem.config = JSON.parse(row.config_json);
		mem.drivers = {
			...bundledDrivers,
			...JSON.parse(row.drivers_json)
		};
		mem.state = JSON.parse(row.state_json);
	} catch {}
	return mem;
}
async function persist() {
	const mem = memory();
	const sql = await sqlOrNull();
	if (!sql) return;
	try {
		await sql`
      insert into room_store (id, config_json, drivers_json, state_json, updated_at)
      values (${ROW_ID}, ${JSON.stringify(mem.config)}, ${JSON.stringify(mem.drivers)}, ${JSON.stringify(mem.state)}, now())
      on conflict (id) do update set
        config_json = excluded.config_json,
        drivers_json = excluded.drivers_json,
        state_json = excluded.state_json,
        updated_at = now()
    `;
	} catch {}
}
function snapshot() {
	const mem = memory();
	return {
		config: mem.config,
		drivers: mem.drivers,
		state: mem.state,
		lastError: mem.lastError,
		runningMacro: mem.runningMacro
	};
}
var boot = null;
function ensureLoaded() {
	if (!boot) boot = loadPersisted();
	return boot;
}
var tokens = /* @__PURE__ */ new Map();
function mint(kind) {
	const token = `${kind}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
	tokens.set(token, {
		kind,
		exp: Date.now() + 288e5
	});
	return token;
}
function validToken(token, kind) {
	if (!token) return false;
	const row = tokens.get(token);
	if (!row || row.kind !== kind) return false;
	if (row.exp < Date.now()) {
		tokens.delete(token);
		return false;
	}
	return true;
}
var getSnapshot_createServerFn_handler = createServerRpc({
	id: "5eb4dd2f12a08e122bef1c7d0f6e276978f5036e500ae860095d9f0cb44361d8",
	name: "getSnapshot",
	filename: "src/lib/control/actions.ts"
}, (opts) => getSnapshot.__executeServer(opts));
var getSnapshot = createServerFn({ method: "GET" }).handler(getSnapshot_createServerFn_handler, async () => {
	await ensureLoaded();
	const snap = snapshot();
	return {
		...snap,
		config: {
			...snap.config,
			room: {
				...snap.config.room,
				configPin: "",
				panelPin: snap.config.room.panelAccess === "pin" ? "" : null
			}
		}
	};
});
var verifyConfigPin_createServerFn_handler = createServerRpc({
	id: "0fcb393be24441a22e8e3ff943b5c031394d8f730cf7f9265d626eec168a5793",
	name: "verifyConfigPin",
	filename: "src/lib/control/actions.ts"
}, (opts) => verifyConfigPin.__executeServer(opts));
var verifyConfigPin = createServerFn({ method: "POST" }).validator((data) => data).handler(verifyConfigPin_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	return data.pin === memory().config.room.configPin ? {
		ok: true,
		token: mint("config")
	} : {
		ok: false,
		token: null
	};
});
var verifyPanelPin_createServerFn_handler = createServerRpc({
	id: "2052872efe9347be94b6cb3e01a7d46d16181a4fbf3a55dbfeaefa002b1fa43c",
	name: "verifyPanelPin",
	filename: "src/lib/control/actions.ts"
}, (opts) => verifyPanelPin.__executeServer(opts));
var verifyPanelPin = createServerFn({ method: "POST" }).validator((data) => data).handler(verifyPanelPin_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	const cfg = memory().config;
	if (cfg.room.panelAccess !== "pin") return {
		ok: true,
		token: mint("panel")
	};
	return data.pin === (cfg.room.panelPin ?? "") ? {
		ok: true,
		token: mint("panel")
	} : {
		ok: false,
		token: null
	};
});
var saveConfig_createServerFn_handler = createServerRpc({
	id: "5dcf73da037da68afaa0ecf9c3803c1982e75a4a083c4ad3926ab93c3e873279",
	name: "saveConfig",
	filename: "src/lib/control/actions.ts"
}, (opts) => saveConfig.__executeServer(opts));
var saveConfig = createServerFn({ method: "POST" }).validator((data) => data).handler(saveConfig_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	if (!validToken(data.token, "config")) return {
		ok: false,
		message: "Config lock required"
	};
	const pin = data.config.room.configPin?.trim() || memory().config.room.configPin;
	memory().config = {
		...data.config,
		room: {
			...data.config.room,
			configPin: pin
		}
	};
	await persist();
	return {
		ok: true,
		message: "Saved"
	};
});
var saveDriver_createServerFn_handler = createServerRpc({
	id: "a03ca2b8b56854c5a87f4c44cb275f070b93d1a51963f7fef862bf985ab6c06e",
	name: "saveDriver",
	filename: "src/lib/control/actions.ts"
}, (opts) => saveDriver.__executeServer(opts));
var saveDriver = createServerFn({ method: "POST" }).validator((data) => data).handler(saveDriver_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	if (!validToken(data.token, "config")) return {
		ok: false,
		message: "Config lock required"
	};
	const name = data.filename.endsWith(".json") ? data.filename : `${data.filename}.json`;
	memory().drivers[name] = data.spec;
	await persist();
	return {
		ok: true,
		message: name
	};
});
var resetDemo_createServerFn_handler = createServerRpc({
	id: "47b9583c64bbcbc1f56b89153a003467d07c6ef08dda0a6f034c61a3221210c6",
	name: "resetDemo",
	filename: "src/lib/control/actions.ts"
}, (opts) => resetDemo.__executeServer(opts));
var resetDemo = createServerFn({ method: "POST" }).validator((data) => data).handler(resetDemo_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	if (!validToken(data.token, "config")) return {
		ok: false,
		message: "Config lock required"
	};
	const { defaultRoomConfig, defaultDeviceState } = await import("./defaults-CN3Os7wB.mjs");
	memory().config = defaultRoomConfig();
	memory().drivers = { ...bundledDrivers };
	memory().state = defaultDeviceState();
	memory().lastError = null;
	await persist();
	return {
		ok: true,
		message: "Demo room restored"
	};
});
var fireCommand_createServerFn_handler = createServerRpc({
	id: "685f2ae9e64e9c91c88c9cc1ab446b9338022a743718c7491713f9537440b898",
	name: "fireCommand",
	filename: "src/lib/control/actions.ts"
}, (opts) => fireCommand.__executeServer(opts));
var fireCommand = createServerFn({ method: "POST" }).validator((data) => data).handler(fireCommand_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	const mem = memory();
	const result = await executeCommand({
		config: mem.config,
		drivers: mem.drivers,
		state: mem.state,
		deviceId: data.deviceId,
		commandId: data.commandId,
		value: data.value
	});
	mem.lastError = result.ok ? null : result.message;
	await persist();
	return result;
});
var fireMacro_createServerFn_handler = createServerRpc({
	id: "097e2ad42941a0773840676316dd7f12f02db6490cfddb8997c0a10ed6c0b03e",
	name: "fireMacro",
	filename: "src/lib/control/actions.ts"
}, (opts) => fireMacro.__executeServer(opts));
var fireMacro = createServerFn({ method: "POST" }).validator((data) => data).handler(fireMacro_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	const mem = memory();
	const macro = mem.config.macros.find((m) => m.id === data.macroId);
	if (!macro) return {
		ok: false,
		message: "Unknown macro"
	};
	mem.runningMacro = macro.id;
	const result = await runMacro({
		config: mem.config,
		drivers: mem.drivers,
		state: mem.state,
		macro
	});
	mem.runningMacro = null;
	mem.lastError = result.ok ? null : result.message;
	await persist();
	return result;
});
var testDevice_createServerFn_handler = createServerRpc({
	id: "00668a5b80b7eefdc30b3c8630fe550b71ad73a3101f8c158bcb17853aa9e876",
	name: "testDevice",
	filename: "src/lib/control/actions.ts"
}, (opts) => testDevice.__executeServer(opts));
var testDevice = createServerFn({ method: "POST" }).validator((data) => data).handler(testDevice_createServerFn_handler, async ({ data }) => {
	await ensureLoaded();
	if (!validToken(data.token, "config")) return {
		ok: false,
		message: "Config lock required"
	};
	const mem = memory();
	return probeDevice({
		config: mem.config,
		drivers: mem.drivers,
		deviceId: data.deviceId
	});
});
var exportBundle_createServerFn_handler = createServerRpc({
	id: "a0b25662c22253b1cdd97b3cad88f6e0d2e8ef98fbee04ac51a56ba94bcb7562",
	name: "exportBundle",
	filename: "src/lib/control/actions.ts"
}, (opts) => exportBundle.__executeServer(opts));
var exportBundle = createServerFn({ method: "GET" }).handler(exportBundle_createServerFn_handler, async () => {
	await ensureLoaded();
	const mem = memory();
	return {
		configVersion: mem.config.configVersion,
		exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
		sourceRoomId: mem.config.room.id,
		config: {
			...mem.config,
			exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
			sourceRoomId: mem.config.room.id
		},
		drivers: mem.drivers
	};
});
//#endregion
export { defaultDeviceState as a, lightsDriver as c, exportBundle_createServerFn_handler, fireCommand_createServerFn_handler, fireMacro_createServerFn_handler, getSnapshot_createServerFn_handler, bundledDrivers as i, ptzDriver as l, ampDriver as n, defaultRoomConfig as o, blindsDriver as r, resetDemo_createServerFn_handler, lgDisplayDriver as s, saveConfig_createServerFn_handler, saveDriver_createServerFn_handler, DEFAULT_CONFIG_PIN as t, testDevice_createServerFn_handler, verifyConfigPin_createServerFn_handler, verifyPanelPin_createServerFn_handler };
