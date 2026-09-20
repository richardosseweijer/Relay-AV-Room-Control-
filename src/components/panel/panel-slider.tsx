import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Widget, WidgetColor } from "@/lib/control/types";
import { cn } from "@/lib/utils";

const TONE: Record<WidgetColor, string> = {
  steel: "border-steel/40 bg-steel/12",
  sage: "border-sage/40 bg-sage/12",
  clay: "border-clay/40 bg-clay/12",
  fog: "border-fog/35 bg-fog/10",
  ink: "border-border bg-raised/80",
  ocean: "border-ocean/40 bg-ocean/12",
  pine: "border-pine/40 bg-pine/12",
  rust: "border-rust/40 bg-rust/12",
  sand: "border-sand/40 bg-sand/12",
  slate: "border-slate/40 bg-slate/12",
  rose: "border-rose/40 bg-rose/12",
};

const FILL: Record<WidgetColor, string> = {
  steel: "bg-steel",
  sage: "bg-sage",
  clay: "bg-clay",
  fog: "bg-fog",
  ink: "bg-fg/80",
  ocean: "bg-ocean",
  pine: "bg-pine",
  rust: "bg-rust",
  sand: "bg-sand",
  slate: "bg-slate",
  rose: "bg-rose",
};

const KNOB = 28;

function snap(min: number, max: number, value: number) {
  const n = Math.min(max, Math.max(min, value));
  if (Number.isInteger(min) && Number.isInteger(max)) return Math.round(n);
  return Math.round(n * 10) / 10;
}

export function PanelSlider({
  widget,
  min,
  max,
  value,
  disabled,
  onSlide,
}: {
  widget: Widget;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  onSlide: (value: number, flush?: boolean) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const vertical = widget.sliderDir === "vertical";
  const span = max - min;
  const pct = span <= 0 ? 0 : ((value - min) / span) * 100;

  function fromPoint(clientX: number, clientY: number) {
    const box = rail.current?.getBoundingClientRect();
    if (!box || span <= 0) return value;
    const inset = KNOB / 2;
    const start = vertical ? box.top + inset : box.left + inset;
    const size = Math.max(1, (vertical ? box.height : box.width) - KNOB);
    const t = vertical ? 1 - (clientY - start) / size : (clientX - start) / size;
    return snap(min, max, min + Math.min(1, Math.max(0, t)) * span);
  }

  function pointer(e: PointerEvent<HTMLDivElement>, flush: boolean) {
    if (disabled) return;
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    onSlide(fromPoint(e.clientX, e.clientY), flush);
  }

  function key(e: KeyboardEvent) {
    if (disabled) return;
    const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : span / 100;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onSlide(snap(min, max, value + step), true); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onSlide(snap(min, max, value - step), true); }
    if (e.key === "Home") { e.preventDefault(); onSlide(min, true); }
    if (e.key === "End") { e.preventDefault(); onSlide(max, true); }
  }

  const fill = `calc(${KNOB / 2}px + (100% - ${KNOB}px) * ${pct / 100})`;

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 h-full rounded-2xl border px-4 py-3",
        vertical ? "flex-col items-center gap-2" : "flex-col justify-between gap-3",
        TONE[widget.color],
        disabled && "opacity-45",
      )}
    >
      {vertical ? (
        <span className="text-xl font-medium tabular-nums tracking-tight">{value}</span>
      ) : (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span>
          <span className="text-xl font-medium tabular-nums tracking-tight">{value}</span>
        </div>
      )}
      <div
        ref={rail}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={widget.label}
        aria-disabled={disabled || undefined}
        onPointerDown={(e) => pointer(e, false)}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pointer(e, false); }}
        onPointerUp={(e) => pointer(e, true)}
        onPointerCancel={(e) => pointer(e, true)}
        onKeyDown={key}
        className={cn(
          "relative min-h-0 touch-none select-none overflow-hidden rounded-full border-2 border-fg/80 bg-[#2a2a32] shadow-[inset_0_1px_3px_rgb(0_0_0_/_0.45)]",
          vertical ? "w-9 flex-1 cursor-ns-resize" : "mx-1 h-9 w-[calc(100%-0.5rem)] cursor-ew-resize",
        )}
      >
        <div
          className={cn("absolute rounded-full", FILL[widget.color])}
          style={vertical
            ? { left: 0, right: 0, bottom: 0, height: fill }
            : { top: 0, bottom: 0, left: 0, width: fill }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ background: "linear-gradient(to bottom, rgb(255 255 255 / 0.22), transparent 42%, rgb(0 0 0 / 0.12))" }}
        />
        <div
          className="absolute rounded-full bg-fg shadow-[0_1px_4px_rgb(0_0_0_/_0.4)]"
          style={vertical
            ? { left: "50%", width: KNOB, height: KNOB, top: `calc(100% - ${fill})`, transform: "translate(-50%, -50%)" }
            : { top: "50%", width: KNOB, height: KNOB, left: fill, transform: "translate(-50%, -50%)" }}
        />
      </div>
      {vertical ? <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span> : null}
    </div>
  );
}
