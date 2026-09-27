import { useEffect, useId, useRef, useState } from "react";
import type { RoomVariable } from "@/lib/control/types";
import { applyVarToken, openVarToken, varTokenChoices } from "@/lib/control/var-token";
import { cn } from "@/lib/utils";

/** Text field that lists room variables after `{`. Inserts `{id}` at the caret. */
export function VarTokenField(props: {
  value: string;
  onChange: (value: string) => void;
  variables: RoomVariable[];
  numericOnly?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, variables, numericOnly = false, className, placeholder, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const listId = useId();

  const token = open && !disabled ? openVarToken(value, caret) : null;
  const choices = token ? varTokenChoices(variables, token.query, numericOnly) : [];
  const show = Boolean(token && choices.length > 0 && box);

  useEffect(() => {
    const el = inputRef.current;
    const next = pendingCaret.current;
    if (!el || next == null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(next, next);
  }, [value]);

  useEffect(() => {
    setActive(0);
  }, [token?.query, numericOnly]);

  useEffect(() => {
    if (!token || choices.length === 0) return;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menu = Math.min(224, Math.max(choices.length, 1) * 36);
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
  }, [token?.start, token?.query, choices.length]);

  function rememberCaret(el: HTMLInputElement) {
    setCaret(el.selectionStart ?? el.value.length);
    setOpen(true);
  }

  function pick(id: string) {
    if (!token) return;
    const next = applyVarToken(value, token.start, caret, id);
    pendingCaret.current = next.caret;
    setCaret(next.caret);
    setOpen(false);
    onChange(next.value);
  }

  return (
    <span className="relative block min-w-0">
      <input
        ref={inputRef}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        spellCheck={false}
        role="combobox"
        aria-expanded={show}
        aria-controls={show ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          rememberCaret(e.target);
        }}
        onSelect={(e) => rememberCaret(e.currentTarget)}
        onFocus={(e) => rememberCaret(e.currentTarget)}
        onBlur={() => setOpen(false)}
        onKeyUp={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") return;
          rememberCaret(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((index) => (index + 1) % choices.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index) => (index - 1 + choices.length) % choices.length);
          } else if (e.key === "Enter" && choices[active]) {
            e.preventDefault();
            pick(choices[active]!.id);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {show ? (
        <ul
          id={listId}
          role="listbox"
          className="fixed z-50 max-h-56 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
          style={{ top: box!.top, left: box!.left, width: Math.max(box!.width, 220) }}
        >
          {choices.map((variable, index) => (
            <li key={variable.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={cn("flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm", index === active ? "bg-raised text-fg" : "text-fg")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(variable.id);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="truncate">{variable.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{`{${variable.id}}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
