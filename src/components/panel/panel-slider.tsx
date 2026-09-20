import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Widget, WidgetColor } from "@/lib/control/types";
import { cn } from "@/lib/utils";

const TONE: Record<WidgetColor, string> = {
  steel: "border-steel/40 bg-steel/15",
  sage: "border-sage/40 bg-sage/15",
  clay: "border-clay/40 bg-clay/15",
  fog: "border-fog/35 bg-fog/10",
  ink: "border-border bg-raised/80",
  ocean: "border-ocean/40 bg-ocean/15",
  pine: "border-pine/40 bg-pine/15",
  rust: "border-rust/40 bg-rust/15",
  sand: "border-sand/40 bg-sand/15",
  slate: "border-slate/40 bg-slate/15",
  rose: "border-rose/40 bg-rose/15",
};

const MARK: Record<WidgetColor, string> = {
  steel: "bg-steel",
  sage: "bg-sage",
  clay: "bg-clay",
  fog: "bg-fog",
  ink: "bg-fg",
  ocean: "bg-ocean",
  pine: "bg-pine",
  rust: "bg-rust",
  sand: "bg-sand",
  slate: "bg-slate",
  rose: "bg-rose",
};

/** Keep 0 / 100 off the tile edge. */
const PAD = 22;

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
    const start = vertical ? box.top + PAD : box.left + PAD;
    const size = Math.max(1, (vertical ? box.height : box.width) - PAD * 2);
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

  const travel = `calc(${PAD}px + (100% - ${PAD * 2}px) * ${pct / 100})`;
  const cross = vertical ? { top: `calc(100% - ${travel})` } : { left: travel };

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 h-full overflow-hidden rounded-2xl border",
        TONE[widget.color],
        disabled && "opacity-45",
      )}
    >
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
        className={cn("absolute inset-0 touch-none select-none", vertical ? "cursor-ns-resize" : "cursor-ew-resize")}
      >
        <div
          className="absolute rounded-full bg-fg/25"
          style={vertical
            ? { top: PAD, bottom: PAD, left: "50%", width: 2, transform: "translateX(-50%)" }
            : { left: PAD, right: PAD, top: "50%", height: 2, transform: "translateY(-50%)" }}
        />
        <div
          className={cn("absolute bg-fg/35", vertical ? "left-4 right-4 h-px" : "top-4 bottom-4 w-px")}
          style={cross}
        />
        <div
          className={cn("absolute size-2.5 rounded-full shadow-[0_0_0_3px_rgb(0_0_0_/_0.25)]", MARK[widget.color])}
          style={vertical
            ? { left: "50%", top: `calc(100% - ${travel})`, transform: "translate(-50%, -50%)" }
            : { top: "50%", left: travel, transform: "translate(-50%, -50%)" }}
        />
      </div>
      <div className="pointer-events-none relative z-[1] flex h-full w-full flex-col justify-between px-3 py-2.5">
        {vertical ? (
          <>
            <span className="self-center text-xl font-medium tabular-nums tracking-tight">{value}</span>
            <span className="self-center text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span>
          </>
        ) : (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span>
            <span className="text-xl font-medium tabular-nums tracking-tight">{value}</span>
          </div>
        )}
      </div>
    </div>
  );
}
