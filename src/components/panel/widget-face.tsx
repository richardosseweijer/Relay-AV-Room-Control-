import { NamedIcon } from "@/components/icons";
import type { Widget, WidgetColor } from "@/lib/control/types";
import { cn } from "@/lib/utils";

const colorClass: Record<WidgetColor, string> = {
  steel: "bg-steel/25 border-steel/30 text-fg",
  sage: "bg-sage/25 border-sage/30 text-fg",
  clay: "bg-clay/25 border-clay/30 text-fg",
  fog: "bg-fog/20 border-fog/30 text-fg",
  ink: "bg-raised/80 border-border text-fg",
  ocean: "bg-ocean/25 border-ocean/30 text-fg",
  pine: "bg-pine/25 border-pine/30 text-fg",
  rust: "bg-rust/25 border-rust/30 text-fg",
  sand: "bg-sand/25 border-sand/30 text-fg",
  slate: "bg-slate/25 border-slate/30 text-fg",
  rose: "bg-rose/25 border-rose/30 text-fg",
};

const activeClass: Record<WidgetColor, string> = {
  steel: "bg-steel text-bg border-steel shadow-[0_0_24px_color-mix(in_oklab,var(--color-steel)_45%,transparent)]",
  sage: "bg-sage text-bg border-sage shadow-[0_0_24px_color-mix(in_oklab,var(--color-sage)_45%,transparent)]",
  clay: "bg-clay text-bg border-clay shadow-[0_0_24px_color-mix(in_oklab,var(--color-clay)_45%,transparent)]",
  fog: "bg-fog text-bg border-fog",
  ink: "bg-fg text-bg border-fg",
  ocean: "bg-ocean text-fg border-ocean shadow-[0_0_24px_color-mix(in_oklab,var(--color-ocean)_40%,transparent)]",
  pine: "bg-pine text-fg border-pine",
  rust: "bg-rust text-fg border-rust",
  sand: "bg-sand text-bg border-sand",
  slate: "bg-slate text-fg border-slate",
  rose: "bg-rose text-fg border-rose",
};

const disabledClass: Record<WidgetColor, string> = {
  steel: "bg-steel/10 border-steel/15 text-steel/40",
  sage: "bg-sage/10 border-sage/15 text-sage/40",
  clay: "bg-clay/10 border-clay/15 text-clay/40",
  fog: "bg-fog/10 border-fog/15 text-fog/40",
  ink: "bg-raised/30 border-border/30 text-subtle",
  ocean: "bg-ocean/10 border-ocean/15 text-ocean/40",
  pine: "bg-pine/10 border-pine/15 text-pine/40",
  rust: "bg-rust/10 border-rust/15 text-rust/40",
  sand: "bg-sand/10 border-sand/15 text-sand/40",
  slate: "bg-slate/10 border-slate/15 text-slate/40",
  rose: "bg-rose/10 border-rose/15 text-rose/40",
};

export function WidgetShell({
  widget,
  active,
  disabled,
  children,
  onClick,
}: {
  widget: Widget;
  active?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const status = widget.type === "status";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex h-full w-full flex-col items-stretch justify-between overflow-hidden rounded-2xl border px-4 py-3 text-left transition duration-200 ease-out",
        "active:scale-[0.98]",
        colorClass[widget.color],
        active && activeClass[widget.color],
        disabled && disabledClass[widget.color],
      )}
    >
      {widget.icon ? (
        <NamedIcon
          name={widget.icon}
          className={cn(
            "pointer-events-none absolute bottom-2 right-2 size-[68%] stroke-[1.25]",
            disabled ? "opacity-20" : active ? "opacity-[0.22]" : "opacity-[0.16]",
          )}
        />
      ) : null}
      <div className="relative z-[1] flex items-start justify-between gap-2">
        <span className={cn("text-[11px] font-medium tracking-[0.16em] uppercase", disabled ? "opacity-60" : active ? "text-bg/70" : "text-muted")}>
          {widget.label}
        </span>
      </div>
      <div className={cn("relative z-[1] min-h-6 font-medium leading-none tracking-tight", status ? "text-3xl" : "text-xl")}>
        {children}
      </div>
    </button>
  );
}
