import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { suggestMatches, type SuggestOption } from "@/lib/control/suggest";
import { cn } from "@/lib/utils";

export function useSuggestBox(active: boolean, count: number, ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!active || count === 0) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menu = Math.min(224, Math.max(count, 1) * 36);
      const below = rect.bottom + 4;
      const top = below + menu > window.innerHeight && rect.top > menu ? rect.top - menu - 4 : below;
      setBox({ top, left: rect.left, width: rect.width });
    };
    place();
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [active, count, ref]);
  return box;
}

export function SuggestMenu(props: {
  listId: string;
  box: { top: number; left: number; width: number };
  options: SuggestOption[];
  active: number;
  onActive: (index: number) => void;
  onPick: (id: string) => void;
}) {
  const { listId, box, options, active, onActive, onPick } = props;
  return (
    <ul
      id={listId}
      role="listbox"
      className="fixed z-50 max-h-56 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
      style={{ top: box.top, left: box.left, width: Math.max(box.width, 220) }}
    >
      {options.map((option, index) => (
        <li key={`${option.id}:${index}`} role="option" aria-selected={index === active}>
          <button
            type="button"
            className={cn("flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm", index === active ? "bg-raised text-fg" : "text-fg")}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(option.id);
            }}
            onMouseEnter={() => onActive(index)}
          >
            <span className="truncate">{option.label || option.id || "None"}</span>
            {option.hint ? <span className="shrink-0 font-mono text-xs text-muted">{option.hint}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whole-field picker.
 * `pick` commits only a list row (device, command, macro, variable).
 * `type` keeps free text and offers rows as hints (enum value, latch group).
 */
export function SuggestField(props: {
  value: string;
  onChange: (value: string) => void;
  options: SuggestOption[];
  mode?: "pick" | "type";
  className?: string;
  rootClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, options, mode = "pick", className, rootClassName, placeholder, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const filter = mode === "pick" ? query : value;
  const matches = open ? suggestMatches(options, filter) : [];
  const box = useSuggestBox(open && options.length > 0, matches.length, inputRef);
  const show = open && !disabled && options.length > 0 && matches.length > 0 && box;
  const closedLabel = options.find((option) => option.id === value)?.label ?? value;

  useEffect(() => {
    setActive(0);
  }, [filter]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <span className={cn("relative block min-w-0", rootClassName)}>
      <input
        ref={inputRef}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        role="combobox"
        aria-expanded={Boolean(show)}
        aria-controls={show ? listId : undefined}
        aria-autocomplete="list"
        value={mode === "pick" && open ? query : mode === "pick" ? closedLabel : value}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          if (mode === "pick") setQuery("");
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          if (mode === "pick") setQuery(e.target.value);
          else onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!show) {
            if (e.key === "ArrowDown") setOpen(true);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((index) => (index + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index) => (index - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            pick(matches[active]!.id);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {show && box ? (
        <SuggestMenu listId={listId} box={box} options={matches} active={active} onActive={setActive} onPick={pick} />
      ) : null}
    </span>
  );
}
