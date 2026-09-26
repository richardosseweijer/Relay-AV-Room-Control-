import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
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
  const face = useRef<HTMLDivElement>(null);
  const [autoVert, setAutoVert] = useState(widget.h > widget.w);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const faceEl = face.current;
    const railEl = rail.current;
    const read = () => {
      if (widget.sliderDir === "vertical") setAutoVert(true);
      else if (widget.sliderDir === "horizontal") setAutoVert(false);
      else if (faceEl) setAutoVert(faceEl.clientHeight > faceEl.clientWidth);
      if (railEl) {
        const box = railEl.getBoundingClientRect();
        setDim((prev) => (prev.w === box.width && prev.h === box.height ? prev : { w: box.width, h: box.height }));
      }
    };
    read();
    const ro = new ResizeObserver(read);
    if (faceEl) ro.observe(faceEl);
    if (railEl) ro.observe(railEl);
    return () => ro.disconnect();
  }, [widget.sliderDir, widget.h, widget.w]);
  const vertical = widget.sliderDir === "vertical" || (widget.sliderDir !== "horizontal" && autoVert);
  const span = max - min;
  const pct = span <= 0 ? 0 : ((value - min) / span) * 100;
  const thick = vertical ? dim.w : dim.h;
  const travel = Math.max(0, (vertical ? dim.h : dim.w) - thick);
  const offset = (pct / 100) * travel;
  const fill = offset + thick / 2;

  function fromPoint(clientX: number, clientY: number) {
    const box = rail.current?.getBoundingClientRect();
    if (!box || span <= 0) return value;
    const inset = (vertical ? box.width : box.height) / 2;
    const start = (vertical ? box.top : box.left) + inset;
    const size = Math.max(1, (vertical ? box.height : box.width) - inset * 2);
    const t = vertical ? 1 - (clientY - start) / size : (clientX - start) / size;
    return snap(min, max, min + Math.min(1, Math.max(0, t)) * span);
  }

  function pointer(e: PointerEvent<HTMLDivElement>, flush: boolean) {
    if (disabled) return;
    e.preventDefault();
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

  return (
    <div
      ref={face}
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
        "flex min-h-0 min-w-0 h-full touch-none select-none rounded-2xl border px-4 py-3",
        vertical ? "cursor-ns-resize flex-col items-center gap-2" : "cursor-ew-resize flex-col justify-between gap-3",
        TONE[widget.color],
        disabled && "opacity-45",
      )}
    >
      {vertical ? (
        <span className="pointer-events-none text-xl font-medium tabular-nums tracking-tight">{value}</span>
      ) : (
        <div className="pointer-events-none flex items-baseline justify-between gap-2">
          <span className="whitespace-pre-line text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span>
          <span className="text-xl font-medium tabular-nums tracking-tight">{value}</span>
        </div>
      )}
      <div
        ref={rail}
        className={cn("pointer-events-none relative min-h-0", vertical ? "w-11 flex-1" : "h-11 w-full")}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full border-2 border-fg/75 bg-[#2a2a32]">
          <div
            className={cn("absolute", FILL[widget.color])}
            style={vertical
              ? { left: 0, right: 0, bottom: 0, height: fill }
              : { top: 0, bottom: 0, left: 0, width: fill }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: "linear-gradient(to bottom, rgb(255 255 255 / 0.22), transparent 42%, rgb(0 0 0 / 0.14))" }}
          />
        </div>
        <div
          className="absolute rounded-full bg-fg shadow-[0_1px_5px_rgb(0_0_0_/_0.45)]"
          style={vertical
            ? { left: 0, width: thick, height: thick, top: Math.max(0, dim.h - thick - offset) }
            : { top: 0, width: thick, height: thick, left: offset }}
        />
      </div>
      {vertical ? <span className="pointer-events-none whitespace-pre-line text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{widget.label}</span> : null}
    </div>
  );
}
