import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { fieldClass } from "./config-ui";

export function InputNum({
  value,
  onNumber,
  className,
  ...rest
}: {
  value: number | undefined | null;
  onNumber: (n: number | undefined) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const focused = useRef(false);
  const [text, setText] = useState(() => (value == null || Number.isNaN(Number(value)) ? "" : String(value)));
  useEffect(() => {
    if (focused.current) return;
    setText(value == null || Number.isNaN(Number(value)) ? "" : String(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className ?? fieldClass()}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        setText(value == null || Number.isNaN(Number(value)) ? "" : String(value));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === "") onNumber(undefined);
        else {
          const n = Number(raw);
          if (Number.isFinite(n)) onNumber(n);
        }
      }}
      {...rest}
    />
  );
}
