import type { RoomSnapshot, Widget } from "@/lib/control/types";
import { cn } from "@/lib/utils";
import { gridStyle } from "@/lib/control/page-layout";
import { resolveBoundNumber } from "@/lib/control/vars";
import { nextScheduled } from "@/lib/control/schedule";
import { resolveStatusAppearance } from "@/lib/control/status-widget";
import {
  readFeedback,
  enabled,
  sliderVariable,
  widgetActive,
} from "@/lib/control/panel-widget";
import { WidgetShell } from "./widget-face";
import { PreviewTile } from "./preview-tile";
import { ImageTile } from "./image-tile";
import { PanelSlider } from "./panel-slider";
import {
  widgetBodyTextClass,
  widgetLabelTileTextClass,
  widgetSecondaryTextClass,
} from "@/lib/control/text-size-widget";

/** One grid cell: slider / label / schedule / preview / image / status / button branches. */
export function PanelTile({
  widget,
  snap,
  gridCols,
  dragValue,
  confirming,
  waiting,
  session,
  onSlide,
  onRun,
}: {
  widget: Widget;
  snap: RoomSnapshot;
  gridCols: number;
  dragValue?: number;
  confirming: boolean;
  waiting: boolean;
  session: string;
  onSlide: (value: number, flush?: boolean) => void;
  onRun: () => void;
}) {
  const on = enabled(snap, widget);
  const varId = sliderVariable(snap, widget);
  const value = varId
    ? String(snap.vars[varId] ?? widget.bind.value ?? "")
    : widget.bind.variable
    ? String(snap.vars[widget.bind.variable] ?? widget.bind.value ?? "")
    : widget.bind.kind === "variable"
      ? String(snap.vars[widget.bind.variable ?? ""] ?? "—")
    : readFeedback(snap, widget.bind.device, widget.bind.feedback);
  const lit = widgetActive(snap, widget, confirming);
  const wide = (widget.type === "slider" && widget.sliderDir === "vertical")
    ? widget.w >= gridCols
    : widget.type === "slider" || widget.type === "schedule" || widget.type === "label" || widget.type === "preview" || widget.type === "image" || widget.w >= gridCols;

  if (widget.type === "slider") {
    const num = Number(value || 0);
    const min = resolveBoundNumber(widget.min, snap.vars ?? {}, 0, snap.config.variables);
    const max = resolveBoundNumber(widget.max, snap.vars ?? {}, 100, snap.config.variables);
    const shown = dragValue ?? (Number.isFinite(num) ? num : min);
    const clamped = Math.min(max, Math.max(min, shown));
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className="min-h-0 min-w-0 h-full"
        style={gridStyle(widget)}
      >
        <PanelSlider
          widget={widget}
          min={min}
          max={max}
          value={clamped}
          disabled={!on}
          onSlide={onSlide}
        />
      </div>
    );
  }
  if (widget.type === "label") {
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className={cn("flex min-w-0 items-center [overflow-wrap:anywhere] rounded-lg px-3 text-muted", widgetLabelTileTextClass(widget.textSize))}
        style={gridStyle(widget)}
      >
        {widget.label}
      </div>
    );
  }
  if (widget.type === "schedule") {
    const upcoming = nextScheduled(snap.config.schedules, snap.config.room.network?.timezone);
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className="grid min-h-0 min-w-0 h-full"
        style={gridStyle(widget)}
      >
        <WidgetShell widget={{ ...widget, label: widget.label === "Next" || widget.label === "Button" || !widget.label ? "Next scheduled task:" : widget.label }}>
          {upcoming ? (
            <span className="flex flex-col gap-1">
              <span className={cn(widgetBodyTextClass(widget.textSize), "font-medium leading-tight")}>{upcoming.label}</span>
              <span className={cn(widgetSecondaryTextClass(widget.textSize), "text-muted")}>{upcoming.when}</span>
            </span>
          ) : (
            <span className={cn(widgetBodyTextClass(widget.textSize), "font-medium")}>Nothing scheduled</span>
          )}
        </WidgetShell>
      </div>
    );
  }
  if (widget.type === "preview") {
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className="grid min-h-0 min-w-0 h-full"
        style={gridStyle(widget)}
      >
        <PreviewTile widget={widget} token={session} disabled={!on} onClick={onRun} />
      </div>
    );
  }
  if (widget.type === "image") {
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className="grid min-h-0 min-w-0 h-full"
        style={gridStyle(widget)}
      >
        <ImageTile widget={widget} token={session} disabled={!on} onClick={onRun} />
      </div>
    );
  }
  if (widget.type === "status") {
    const appearance = resolveStatusAppearance(
      widget,
      String(snap.vars[widget.bind.variable ?? ""] ?? widget.bind.value ?? ""),
    );
    const traffic = Boolean(widget.colorWhen?.length || widget.statusDefault?.color);
    return (
      <div
        data-wide={wide}
        data-type={widget.type}
        className="grid min-h-0 min-w-0 h-full"
        style={gridStyle(widget)}
      >
        <WidgetShell
          widget={{ ...widget, color: appearance.color }}
          disabled={!on}
          active={traffic || lit || waiting}
          onClick={onRun}
        >
          {appearance.text}
        </WidgetShell>
      </div>
    );
  }
  return (
    <div
      data-wide={wide}
      data-type={widget.type}
      className="grid min-h-0 min-w-0 h-full"
      style={gridStyle(widget)}
    >
      <WidgetShell
        widget={widget}
        disabled={!on}
        active={lit || waiting}
        onClick={onRun}
      >
        {confirming
          ? "Confirm?"
          : waiting
            ? "…"
            : ""}
      </WidgetShell>
    </div>
  );
}
