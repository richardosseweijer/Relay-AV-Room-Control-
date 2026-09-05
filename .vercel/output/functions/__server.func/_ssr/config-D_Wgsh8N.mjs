import { o as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { _ as Link, y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as saveConfig, d as verifyConfigPin, l as saveDriver, n as cn, o as getSnapshot, r as exportBundle, s as resetDemo, t as Button, u as testDevice } from "./button-DFTBwGVP.mjs";
import { m as ArrowLeft } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/config-D_Wgsh8N.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var COLORS = [
	"steel",
	"sage",
	"clay",
	"fog",
	"ink"
];
function fieldClass() {
	return "h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg";
}
function ConfigApp() {
	const [snap, setSnap] = (0, import_react.useState)(null);
	const [draft, setDraft] = (0, import_react.useState)(null);
	const [token, setToken] = (0, import_react.useState)(null);
	const [pin, setPin] = (0, import_react.useState)("");
	const [tab, setTab] = (0, import_react.useState)("room");
	const [note, setNote] = (0, import_react.useState)(null);
	const [pageId, setPageId] = (0, import_react.useState)("home");
	const [selectedId, setSelectedId] = (0, import_react.useState)(null);
	const [driverName, setDriverName] = (0, import_react.useState)("");
	const [driverText, setDriverText] = (0, import_react.useState)("");
	async function refresh() {
		const next = await getSnapshot();
		setSnap(next);
		setDraft((cur) => cur ?? structuredClone(next.config));
		if (!driverName && Object.keys(next.drivers)[0]) {
			const first = Object.keys(next.drivers)[0];
			setDriverName(first);
			setDriverText(JSON.stringify(next.drivers[first], null, 2));
		}
		return next;
	}
	(0, import_react.useEffect)(() => {
		const stored = sessionStorage.getItem("relay-config-token");
		if (stored) setToken(stored);
		refresh().catch(() => void 0);
	}, []);
	const page = draft?.pages.find((p) => p.id === pageId) ?? draft?.pages[0];
	const selected = page?.widgets.find((w) => w.id === selectedId) ?? null;
	function update(mut) {
		if (!draft) return;
		const next = structuredClone(draft);
		mut(next);
		setDraft(next);
	}
	async function persist() {
		if (!draft || !token) return;
		const res = await saveConfig({ data: {
			token,
			config: draft
		} });
		setNote(res.message);
		await refresh();
	}
	if (!snap) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "flex min-h-dvh items-center justify-center bg-bg text-muted",
		children: "Loading config…"
	});
	if (!token) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs uppercase tracking-[0.2em] text-subtle",
				children: "Relay setup"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-3xl font-medium tracking-tight",
				children: "Configurator"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Default PIN for the demo room is 1234."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				className: fieldClass(),
				inputMode: "numeric",
				value: pin,
				onChange: (e) => setPin(e.target.value),
				placeholder: "PIN"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: async () => {
					const res = await verifyConfigPin({ data: { pin } });
					if (res.ok && res.token) {
						sessionStorage.setItem("relay-config-token", res.token);
						setToken(res.token);
						const next = await getSnapshot();
						setDraft(structuredClone(next.config));
					} else setNote("Wrong PIN");
				},
				children: "Unlock"
			}),
			note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-clay",
				children: note
			}) : null
		]
	});
	if (!draft || !page) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "min-h-dvh bg-bg pb-16",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "sticky top-0 z-10 border-b border-border bg-bg/95 px-4 py-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto flex max-w-5xl items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "size-4" })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] uppercase tracking-[0.2em] text-subtle",
						children: "Configurator"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-lg font-medium",
						children: draft.room.name
					})] })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex gap-2",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "secondary",
						onClick: persist,
						children: "Save"
					})
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				className: "mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto",
				children: [
					"room",
					"devices",
					"pages",
					"macros",
					"drivers"
				].map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setTab(id),
					className: cn("h-10 rounded-md px-3 text-sm capitalize", tab === id ? "bg-accent text-accent-fg" : "text-muted"),
					children: id
				}, id))
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-5xl px-4 py-6",
			children: [
				tab === "room" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "grid gap-4 sm:grid-cols-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Room name", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: fieldClass(),
								value: draft.room.name,
								onChange: (e) => update((c) => {
									c.room.name = e.target.value;
								})
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Room id", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: fieldClass(),
								value: draft.room.id,
								onChange: (e) => update((c) => {
									c.room.id = e.target.value;
								})
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Config PIN", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: fieldClass(),
								value: draft.room.configPin,
								onChange: (e) => update((c) => {
									c.room.configPin = e.target.value;
								})
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Panel access", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								className: fieldClass(),
								value: draft.room.panelAccess,
								onChange: (e) => update((c) => {
									c.room.panelAccess = e.target.value;
								}),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "open",
									children: "Open on LAN"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "pin",
									children: "Panel PIN"
								})]
							})]
						}),
						draft.room.panelAccess === "pin" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Panel PIN", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								className: fieldClass(),
								value: draft.room.panelPin ?? "",
								onChange: (e) => update((c) => {
									c.room.panelPin = e.target.value;
								})
							})]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1 text-sm text-muted",
							children: ["Idle dim (seconds)", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								className: fieldClass(),
								value: draft.room.idleDimSeconds,
								onChange: (e) => update((c) => {
									c.room.idleDimSeconds = Number(e.target.value);
								})
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "sm:col-span-2 flex flex-wrap gap-2 pt-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									variant: "secondary",
									onClick: async () => {
										const bundle = await exportBundle();
										const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = `${draft.room.id}-relay.json`;
										a.click();
										URL.revokeObjectURL(url);
									},
									children: "Export"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "inline-flex h-11 items-center rounded-md border border-border bg-surface px-4 text-sm",
									children: ["Import", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "file",
										accept: "application/json",
										className: "hidden",
										onChange: async (e) => {
											const file = e.target.files?.[0];
											if (!file) return;
											const parsed = JSON.parse(await file.text());
											if (parsed.config) setDraft(parsed.config);
											if (parsed.drivers && token) for (const [name, spec] of Object.entries(parsed.drivers)) await saveDriver({ data: {
												token,
												filename: name,
												spec
											} });
											setNote("Imported — press Save");
										}
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									variant: "secondary",
									onClick: async () => {
										const res = await resetDemo({ data: { token } });
										setNote(res.message);
										const next = await refresh();
										setDraft(structuredClone(next.config));
									},
									children: "Restore demo"
								})
							]
						})
					]
				}) : null,
				tab === "devices" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "grid gap-4",
					children: [draft.devices.map((device, index) => {
						const driver = snap.drivers[device.driver];
						const features = [...driver?.commands.map((c) => c.id) ?? [], ...driver?.feedback.map((f) => f.id) ?? []];
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
							className: "rounded-xl border border-border bg-surface p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "grid gap-3 sm:grid-cols-2",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "grid gap-1 text-sm text-muted",
											children: ["Name", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												className: fieldClass(),
												value: device.name,
												onChange: (e) => update((c) => {
													c.devices[index].name = e.target.value;
												})
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "grid gap-1 text-sm text-muted",
											children: ["Host", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												className: fieldClass(),
												value: device.host,
												onChange: (e) => update((c) => {
													c.devices[index].host = e.target.value;
												})
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "grid gap-1 text-sm text-muted",
											children: ["Driver", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
												className: fieldClass(),
												value: device.driver,
												onChange: (e) => update((c) => {
													c.devices[index].driver = e.target.value;
												}),
												children: Object.keys(snap.drivers).map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: name }, name))
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "flex items-center gap-2 text-sm text-muted pt-6",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: device.simulate,
												onChange: (e) => update((c) => {
													c.devices[index].simulate = e.target.checked;
												})
											}), "Simulate (demo / no hardware)"]
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mt-3 flex flex-wrap gap-2",
									children: features.map((id) => {
										const on = device.enabledFeatures.includes(id);
										return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => update((c) => {
												const d = c.devices[index];
												d.enabledFeatures = on ? d.enabledFeatures.filter((x) => x !== id) : [...d.enabledFeatures, id];
											}),
											className: cn("rounded-full border px-3 py-1 text-xs", on ? "border-accent bg-raised text-fg" : "border-border text-subtle"),
											children: id
										}, id);
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "mt-3",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										size: "sm",
										variant: "secondary",
										onClick: async () => {
											const res = await testDevice({ data: {
												token,
												deviceId: device.id
											} });
											setNote(`${device.name}: ${res.message}`);
										},
										children: "Probe"
									})
								})
							]
						}, device.id);
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "secondary",
						onClick: () => update((c) => {
							const first = Object.keys(snap.drivers)[0] ?? "lg-oled55c3.json";
							c.devices.push({
								id: `dev-${Date.now().toString(36)}`,
								name: "New device",
								driver: first,
								transport: "lan",
								host: "10.0.10.50",
								auth: {},
								enabledFeatures: [],
								simulate: true
							});
						}),
						children: "Add device"
					})]
				}) : null,
				tab === "pages" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PagesEditor, {
					draft,
					page,
					selected,
					selectedId,
					setSelectedId,
					setPageId,
					update,
					colors: COLORS
				}) : null,
				tab === "macros" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
					className: "grid gap-4",
					children: draft.macros.map((macro, mi) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "rounded-xl border border-border bg-surface p-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "grid gap-3 sm:grid-cols-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "grid gap-1 text-sm text-muted",
										children: ["Label", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											className: fieldClass(),
											value: macro.label,
											onChange: (e) => update((c) => {
												c.macros[mi].label = e.target.value;
											})
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "grid gap-1 text-sm text-muted",
										children: ["Retries", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "number",
											className: fieldClass(),
											value: macro.retries,
											onChange: (e) => update((c) => {
												c.macros[mi].retries = Number(e.target.value);
											})
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "grid gap-1 text-sm text-muted",
										children: ["On fail", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
											className: fieldClass(),
											value: macro.onFail.kind,
											onChange: (e) => update((c) => {
												c.macros[mi].onFail.kind = e.target.value;
											}),
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
													value: "none",
													children: "none"
												}),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
													value: "gotoPage",
													children: "goto page"
												}),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
													value: "macro",
													children: "other macro"
												})
											]
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
								className: "mt-3 space-y-2 text-sm",
								children: macro.steps.map((step, si) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									className: "grid gap-2 rounded-md bg-bg p-2 sm:grid-cols-4",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
											className: fieldClass(),
											value: step.device,
											onChange: (e) => update((c) => {
												c.macros[mi].steps[si].device = e.target.value;
											}),
											children: draft.devices.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
												value: d.id,
												children: d.name
											}, d.id))
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											className: fieldClass(),
											value: step.command,
											onChange: (e) => update((c) => {
												c.macros[mi].steps[si].command = e.target.value;
											})
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											className: fieldClass(),
											placeholder: "value",
											value: step.value ?? "",
											onChange: (e) => update((c) => {
												c.macros[mi].steps[si].value = e.target.value;
											})
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											className: fieldClass(),
											type: "number",
											placeholder: "delay ms",
											value: step.delayMsAfter ?? 0,
											onChange: (e) => update((c) => {
												c.macros[mi].steps[si].delayMsAfter = Number(e.target.value);
											})
										})
									]
								}, `${macro.id}-${si}`))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "ghost",
								className: "mt-2",
								onClick: () => update((c) => {
									c.macros[mi].steps.push({
										device: draft.devices[0]?.id ?? "tv",
										command: "power.on",
										delayMsAfter: 0
									});
								}),
								children: "Add step"
							})
						]
					}, macro.id))
				}) : null,
				tab === "drivers" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "grid gap-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							className: fieldClass(),
							value: driverName,
							onChange: (e) => {
								setDriverName(e.target.value);
								setDriverText(JSON.stringify(snap.drivers[e.target.value], null, 2));
							},
							children: Object.keys(snap.drivers).map((name) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: name }, name))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							value: driverText,
							onChange: (e) => setDriverText(e.target.value),
							className: "min-h-80 rounded-lg border border-border bg-surface p-3 font-mono text-xs"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							onClick: async () => {
								try {
									const spec = JSON.parse(driverText);
									const res = await saveDriver({ data: {
										token,
										filename: driverName || "custom.json",
										spec
									} });
									setNote(res.message);
									await refresh();
								} catch {
									setNote("Invalid JSON");
								}
							},
							children: "Save driver"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted",
							children: "Hand a driver spec plus a manufacturer manual to an AI to fill commands and feedback. Drop the JSON here."
						})
					]
				}) : null,
				note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-6 text-sm text-muted",
					children: note
				}) : null
			]
		})]
	});
}
function PagesEditor({ draft, page, selected, selectedId, setSelectedId, setPageId, update, colors }) {
	const cells = (0, import_react.useMemo)(() => Array.from({ length: page.grid.cols * page.grid.rows }, (_, i) => i), [page.grid]);
	function patchWidget(mut) {
		update((c) => {
			const w = c.pages.find((x) => x.id === page.id)?.widgets.find((x) => x.id === selectedId);
			if (w) mut(w);
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "grid gap-4 lg:grid-cols-[1fr_18rem]",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mb-3 flex flex-wrap gap-2",
			children: [draft.pages.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => setPageId(p.id),
				className: cn("h-10 rounded-md px-3 text-sm", p.id === page.id ? "bg-accent text-accent-fg" : "border border-border text-muted"),
				children: p.label
			}, p.id)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				size: "sm",
				variant: "secondary",
				onClick: () => update((c) => {
					const id = `page-${Date.now().toString(36)}`;
					c.pages.push({
						id,
						label: "New page",
						grid: {
							cols: 6,
							rows: 8
						},
						widgets: []
					});
					setPageId(id);
				}),
				children: "Add page"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-1 rounded-xl border border-border bg-surface p-2",
			style: { gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))` },
			children: cells.map((i) => {
				const x = i % page.grid.cols;
				const y = Math.floor(i / page.grid.cols);
				const owner = page.widgets.find((w) => x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h);
				const origin = owner && owner.x === x && owner.y === y;
				if (owner && !origin) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {}, i);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => {
						if (owner) setSelectedId(owner.id);
						else {
							const id = `w-${Date.now().toString(36)}`;
							update((c) => {
								c.pages.find((p) => p.id === page.id)?.widgets.push({
									id,
									type: "button",
									x,
									y,
									w: 2,
									h: 2,
									label: "Button",
									color: "steel",
									confirm: false,
									bind: {
										kind: "command",
										device: draft.devices[0]?.id,
										command: draft.devices[0]?.enabledFeatures[0]
									}
								});
							});
							setSelectedId(id);
						}
					},
					className: cn("min-h-12 rounded-md border text-left text-[11px] px-2 py-1", owner ? "border-border bg-raised text-fg" : "border-dashed border-border/70 text-subtle", owner && selectedId === owner.id && "ring-2 ring-accent"),
					style: owner ? {
						gridColumn: `span ${owner.w}`,
						gridRow: `span ${owner.h}`
					} : void 0,
					children: owner ? owner.label : "+"
				}, i);
			})
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
			className: "rounded-xl border border-border bg-surface p-4",
			children: !selected ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Tap a cell to add or edit a control."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "grid gap-1 text-sm text-muted",
						children: ["Label", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: fieldClass(),
							value: selected.label,
							onChange: (e) => patchWidget((w) => {
								w.label = e.target.value;
							})
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "grid gap-1 text-sm text-muted",
						children: ["Type", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							className: fieldClass(),
							value: selected.type,
							onChange: (e) => patchWidget((w) => {
								w.type = e.target.value;
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "button",
									children: "button"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "slider",
									children: "slider"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "status",
									children: "status"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "label",
									children: "label"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "grid gap-1 text-sm text-muted",
						children: ["Bind", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							className: fieldClass(),
							value: selected.bind.kind,
							onChange: (e) => patchWidget((w) => {
								w.bind.kind = e.target.value;
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "command",
									children: "command"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "range",
									children: "range"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "macro",
									children: "macro"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "gotoPage",
									children: "page"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "feedback",
									children: "feedback"
								})
							]
						})]
					}),
					selected.bind.kind === "macro" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						className: fieldClass(),
						value: selected.bind.id ?? "",
						onChange: (e) => patchWidget((w) => {
							w.bind.id = e.target.value;
						}),
						children: draft.macros.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: m.id,
							children: m.label
						}, m.id))
					}) : null,
					selected.bind.kind === "gotoPage" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						className: fieldClass(),
						value: selected.bind.id ?? "",
						onChange: (e) => patchWidget((w) => {
							w.bind.id = e.target.value;
						}),
						children: draft.pages.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: p.id,
							children: p.label
						}, p.id))
					}) : null,
					selected.bind.kind === "command" || selected.bind.kind === "range" || selected.bind.kind === "feedback" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						className: fieldClass(),
						value: selected.bind.device ?? "",
						onChange: (e) => patchWidget((w) => {
							w.bind.device = e.target.value;
						}),
						children: draft.devices.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: d.id,
							children: d.name
						}, d.id))
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						className: fieldClass(),
						placeholder: "command or feedback id",
						value: selected.bind.command ?? selected.bind.feedback ?? "",
						onChange: (e) => patchWidget((w) => {
							if (w.bind.kind === "feedback") w.bind.feedback = e.target.value;
							else {
								w.bind.command = e.target.value;
								if (w.bind.kind === "range") w.bind.feedback = e.target.value.replace(".set", ".level");
							}
						})
					})] }) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex flex-wrap gap-1",
						children: colors.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => patchWidget((w) => {
								w.color = c;
							}),
							className: cn("h-8 rounded-md px-2 text-xs capitalize border", selected.color === c ? "border-accent" : "border-border"),
							children: c
						}, c))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-4 gap-2 text-xs text-muted",
						children: [
							"x",
							"y",
							"w",
							"h"
						].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "grid gap-1",
							children: [key, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								className: fieldClass(),
								value: selected[key],
								onChange: (e) => patchWidget((w) => {
									w[key] = Number(e.target.value);
								})
							})]
						}, key))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex items-center gap-2 text-sm text-muted",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: !!selected.confirm,
							onChange: (e) => patchWidget((w) => {
								w.confirm = e.target.checked;
							})
						}), "Confirm press"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "danger",
						size: "sm",
						onClick: () => update((c) => {
							const p = c.pages.find((x) => x.id === page.id);
							if (p) p.widgets = p.widgets.filter((w) => w.id !== selected.id);
							setSelectedId(null);
						}),
						children: "Remove"
					})
				]
			})
		})]
	});
}
var SplitComponent = ConfigApp;
//#endregion
export { SplitComponent as component };
