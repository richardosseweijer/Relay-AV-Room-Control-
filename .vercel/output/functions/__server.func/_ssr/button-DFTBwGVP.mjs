import { y as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { t as Slot } from "../_libs/radix-ui__react-slot.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/button-DFTBwGVP.js
var import_jsx_runtime = require_jsx_runtime();
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var getSnapshot = createServerFn({ method: "GET" }).handler(createSsrRpc("5eb4dd2f12a08e122bef1c7d0f6e276978f5036e500ae860095d9f0cb44361d8"));
var verifyConfigPin = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("0fcb393be24441a22e8e3ff943b5c031394d8f730cf7f9265d626eec168a5793"));
var verifyPanelPin = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("2052872efe9347be94b6cb3e01a7d46d16181a4fbf3a55dbfeaefa002b1fa43c"));
var saveConfig = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("5dcf73da037da68afaa0ecf9c3803c1982e75a4a083c4ad3926ab93c3e873279"));
var saveDriver = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("a03ca2b8b56854c5a87f4c44cb275f070b93d1a51963f7fef862bf985ab6c06e"));
var resetDemo = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("47b9583c64bbcbc1f56b89153a003467d07c6ef08dda0a6f034c61a3221210c6"));
var fireCommand = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("685f2ae9e64e9c91c88c9cc1ab446b9338022a743718c7491713f9537440b898"));
var fireMacro = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("097e2ad42941a0773840676316dd7f12f02db6490cfddb8997c0a10ed6c0b03e"));
var testDevice = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("00668a5b80b7eefdc30b3c8630fe550b71ad73a3101f8c158bcb17853aa9e876"));
var exportBundle = createServerFn({ method: "GET" }).handler(createSsrRpc("a0b25662c22253b1cdd97b3cad88f6e0d2e8ef98fbee04ac51a56ba94bcb7562"));
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", {
	variants: {
		variant: {
			default: "bg-accent text-accent-fg hover:bg-accent/90",
			secondary: "bg-raised text-fg border border-border hover:bg-surface",
			ghost: "text-muted hover:text-fg hover:bg-raised",
			danger: "bg-clay text-fg hover:bg-clay/90"
		},
		size: {
			default: "h-11 px-4",
			sm: "h-9 px-3 text-xs",
			lg: "h-12 px-5",
			icon: "size-11"
		}
	},
	defaultVariants: {
		variant: "default",
		size: "default"
	}
});
function Button({ className, variant, size, asChild, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(asChild ? Slot : "button", {
		className: cn(buttonVariants({
			variant,
			size
		}), className),
		...props
	});
}
//#endregion
export { fireMacro as a, saveConfig as c, verifyConfigPin as d, verifyPanelPin as f, fireCommand as i, saveDriver as l, cn as n, getSnapshot as o, exportBundle as r, resetDemo as s, Button as t, testDevice as u };
