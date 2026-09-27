import { useEffect, useId, useRef, useState } from "react";
import type { RoomVariable } from "@/lib/control/types";
import { suggestMatches, type SuggestOption } from "@/lib/control/suggest";
import { applyVarToken, openVarToken, varTokenChoices } from "@/lib/control/var-token";
import { SuggestMenu, useSuggestBox } from "./suggest-field";

/** Text field that lists room variables after `{`. Optional whole-value hints when not inside `{`. */
export function VarTokenField(props: {
  value: string;
  onChange: (value: string) => void;
  variables: RoomVariable[];
  suggestions?: SuggestOption[];
  numericOnly?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, variables, suggestions = [], numericOnly = false, className, placeholder, disabled } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const token = open && !disabled ? openVarToken(value, caret) : null;
  const tokenRows: SuggestOption[] = token
    ? varTokenChoices(variables, token.query, numericOnly).map((variable) => ({ id: variable.id, label: variable.label, hint: `{${variable.id}}` }))
    : [];
  const hintRows = !token && suggestions.length ? suggestMatches(suggestions, value) : [];
  const menu = token ? tokenRows : hintRows;
  const box = useSuggestBox(open && menu.length > 0, menu.length, inputRef);
  const show = Boolean(open && !disabled && menu.length > 0 && box);

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
  }, [token?.query, value, numericOnly]);

  function rememberCaret(el: HTMLInputElement) {
    setCaret(el.selectionStart ?? el.value.length);
    setOpen(true);
  }

  function pick(id: string) {
    if (token) {
      const next = applyVarToken(value, token.start, caret, id);
      pendingCaret.current = next.caret;
      setCaret(next.caret);
      setOpen(false);
      onChange(next.value);
      return;
    }
    pendingCaret.current = id.length;
    setCaret(id.length);
    setOpen(false);
    onChange(id);
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
            setActive((index) => (index + 1) % menu.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((index) => (index - 1 + menu.length) % menu.length);
          } else if (e.key === "Enter" && menu[active]) {
            e.preventDefault();
            pick(menu[active]!.id);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {show && box ? (
        <SuggestMenu listId={listId} box={box} options={menu} active={active} onActive={setActive} onPick={pick} />
      ) : null}
    </span>
  );
}
