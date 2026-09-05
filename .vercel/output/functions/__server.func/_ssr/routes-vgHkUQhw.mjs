import { o as __toESM } from "../_runtime.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { _ as Link, y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as fireMacro, f as verifyPanelPin, i as fireCommand, n as cn, o as getSnapshot, t as Button } from "./button-DFTBwGVP.mjs";
import { a as Tv, c as Settings2, d as Power, f as Monitor, i as User, l as Scan, n as Video, p as House, r as Users, s as Speaker, t as Waypoints, u as Presentation } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-vgHkUQhw.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var MAP = {
	house: House,
	monitor: Monitor,
	power: Power,
	presentation: Presentation,
	scan: Scan,
	speaker: Speaker,
	tv: Tv,
	user: User,
	users: Users,
	video: Video,
	waypoints: Waypoints,
	hdmi: Monitor
};
function NamedIcon({ name, className }) {
	if (!name) return null;
	const Icon = MAP[name] ?? Monitor;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
		className,
		strokeWidth: 1.75
	});
}
var colorClass = {
	steel: "bg-steel/25 border-steel/40 text-fg",
	sage: "bg-sage/25 border-sage/40 text-fg",
	clay: "bg-clay/25 border-clay/40 text-fg",
	fog: "bg-fog/20 border-border text-fg",
	ink: "bg-raised border-border text-fg"
};
function WidgetShell({ widget, active, disabled, children, onClick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		disabled,
		onClick,
		className: cn("flex h-full w-full flex-col items-stretch justify-between rounded-lg border p-3 text-left transition-colors duration-150", colorClass[widget.color], active && "ring-2 ring-accent", disabled && "opacity-40"),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-center justify-between gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-xs font-medium uppercase tracking-wide text-muted",
				children: widget.label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NamedIcon, {
				name: widget.icon,
				className: "size-4 text-muted"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-2 min-h-6 text-lg font-medium leading-tight",
			children
		})]
	});
}
function readFeedback(snap, device, feedback) {
	if (!device || !feedback) return "";
	return snap.state[device]?.[feedback] ?? "—";
}
function enabled(snap, widget) {
	const rule = widget.enableWhen;
	if (!rule) return true;
	return String(snap.state[rule.device]?.[rule.feedback] ?? "") === rule.equals;
}
function ControlPanel() {
	const [snap, setSnap] = (0, import_react.useState)(null);
	const [pageId, setPageId] = (0, import_react.useState)("home");
	const [pin, setPin] = (0, import_react.useState)("");
	const [locked, setLocked] = (0, import_react.useState)(false);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [confirm, setConfirm] = (0, import_react.useState)(null);
	const [dim, setDim] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)(null);
	async function refresh() {
		const next = await getSnapshot();
		setSnap(next);
		return next;
	}
	(0, import_react.useEffect)(() => {
		let cancel = false;
		(async () => {
			const next = await refresh();
			if (cancel) return;
			if (next.config.room.panelAccess === "pin") {
				const stored = sessionStorage.getItem("relay-panel-token");
				setLocked(!stored);
			}
		})();
		const t = setInterval(() => {
			refresh().catch(() => void 0);
		}, 1200);
		return () => {
			cancel = true;
			clearInterval(t);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		if (!snap) return;
		const ms = Math.max(20, snap.config.room.idleDimSeconds) * 1e3;
		let timer = window.setTimeout(() => setDim(true), ms);
		const bump = () => {
			setDim(false);
			window.clearTimeout(timer);
			timer = window.setTimeout(() => setDim(true), ms);
		};
		window.addEventListener("pointerdown", bump);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("pointerdown", bump);
		};
	}, [snap?.config.room.idleDimSeconds]);
	const page = (0, import_react.useMemo)(() => snap?.config.pages.find((p) => p.id === pageId) ?? snap?.config.pages[0], [snap, pageId]);
	async function run(widget) {
		if (!snap) return;
		if (!enabled(snap, widget)) return;
		if (widget.confirm && confirm?.id !== widget.id) {
			setConfirm(widget);
			return;
		}
		setConfirm(null);
		setBusy(true);
		setNote(null);
		try {
			if (widget.bind.kind === "gotoPage" && widget.bind.id) {
				setPageId(widget.bind.id);
				return;
			}
			if (widget.bind.kind === "macro" && widget.bind.id) {
				const res = await fireMacro({ data: { macroId: widget.bind.id } });
				if (!res.ok) setNote(res.message);
				if (snap.config.macros.find((m) => m.id === widget.bind.id)?.onFail.kind === "gotoPage") {
					const fail = snap.config.macros.find((m) => m.id === widget.bind.id)?.onFail.id;
					if (!res.ok && fail) setPageId(fail);
				}
			}
			if ((widget.bind.kind === "command" || widget.bind.kind === "range") && widget.bind.device && widget.bind.command) {
				const res = await fireCommand({ data: {
					deviceId: widget.bind.device,
					commandId: widget.bind.command,
					value: widget.bind.value
				} });
				if (!res.ok) setNote(res.message);
			}
			await refresh();
		} finally {
			setBusy(false);
		}
	}
	async function slide(widget, value) {
		if (!widget.bind.device || !widget.bind.command) return;
		setBusy(true);
		await fireCommand({ data: {
			deviceId: widget.bind.device,
			commandId: widget.bind.command,
			value
		} });
		await refresh();
		setBusy(false);
	}
	if (!snap || !page) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "flex min-h-dvh items-center justify-center bg-bg text-muted",
		children: "Loading room…"
	});
	if (locked) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 bg-bg px-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs uppercase tracking-[0.2em] text-subtle",
				children: "Relay"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-3xl font-medium tracking-tight",
				children: snap.config.room.name
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Enter the panel PIN to open this room."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				inputMode: "numeric",
				value: pin,
				onChange: (e) => setPin(e.target.value),
				className: "h-12 rounded-md border border-border bg-surface px-3 text-lg tracking-[0.4em]",
				placeholder: "••••"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: async () => {
					const res = await verifyPanelPin({ data: { pin } });
					if (res.ok && res.token) {
						sessionStorage.setItem("relay-panel-token", res.token);
						setLocked(false);
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: cn("min-h-dvh bg-bg px-3 py-4 sm:px-6", dim && "opacity-40"),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "mx-auto mb-4 flex max-w-3xl items-end justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-[11px] uppercase tracking-[0.22em] text-subtle",
					children: ["Relay · ", snap.config.room.id]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-medium tracking-tight",
					children: snap.config.room.name
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [snap.runningMacro ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs text-muted",
						children: "Running…"
					}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/config",
						className: "inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface text-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Settings2, { className: "size-4" })
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mx-auto mb-3 flex max-w-3xl gap-2 overflow-x-auto",
				children: snap.config.pages.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setPageId(p.id),
					className: cn("h-10 shrink-0 rounded-md px-3 text-sm", p.id === page.id ? "bg-accent text-accent-fg" : "bg-surface text-muted border border-border"),
					children: p.label
				}, p.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "mx-auto grid max-w-3xl gap-2",
				style: {
					gridTemplateColumns: `repeat(${page.grid.cols}, minmax(0, 1fr))`,
					gridAutoRows: "minmax(4.6rem, auto)"
				},
				children: page.widgets.map((widget) => {
					const on = enabled(snap, widget);
					const value = readFeedback(snap, widget.bind.device, widget.bind.feedback);
					if (widget.type === "slider") {
						const num = Number(value || 0);
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "rounded-lg border border-border bg-surface p-3",
							style: {
								gridColumn: `${widget.x + 1} / span ${widget.w}`,
								gridRow: `${widget.y + 1} / span ${widget.h}`
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: widget.label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono text-fg tabular-nums",
									children: Number.isFinite(num) ? num : "—"
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "range",
								disabled: !on || busy,
								min: 0,
								max: 100,
								value: Number.isFinite(num) ? num : 0,
								onChange: (e) => slide(widget, Number(e.target.value)),
								className: "w-full accent-accent"
							})]
						}, widget.id);
					}
					if (widget.type === "label") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex items-center rounded-lg px-3 text-sm text-muted",
						style: {
							gridColumn: `${widget.x + 1} / span ${widget.w}`,
							gridRow: `${widget.y + 1} / span ${widget.h}`
						},
						children: widget.label
					}, widget.id);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						style: {
							gridColumn: `${widget.x + 1} / span ${widget.w}`,
							gridRow: `${widget.y + 1} / span ${widget.h}`
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WidgetShell, {
							widget,
							disabled: !on || busy,
							active: confirm?.id === widget.id,
							onClick: () => run(widget),
							children: widget.type === "status" ? String(value) : confirm?.id === widget.id ? "Confirm?" : widget.bind.kind === "macro" ? "Scene" : ""
						})
					}, widget.id);
				})
			}),
			note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mx-auto mt-4 max-w-3xl text-sm text-clay",
				children: note
			}) : null,
			snap.lastError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mx-auto mt-2 max-w-3xl text-xs text-muted",
				children: snap.lastError
			}) : null
		]
	});
}
var SplitComponent = ControlPanel;
//#endregion
export { SplitComponent as component };
