import { useRef } from "react";

export function CodeInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || "");

  const update = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
    return clean;
  };

  return (
    <div className="code-inputs" onPaste={(e) => {
      const text = e.clipboardData.getData("text");
      if (/\d/.test(text)) {
        e.preventDefault();
        const clean = update(text);
        refs.current[Math.min(clean.length, 5)]?.focus();
      }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          aria-label={`Dígito ${i + 1}`}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return;
            if (typed.length > 1) {
              const clean = update(typed);
              refs.current[Math.min(clean.length, 5)]?.focus();
              return;
            }
            const next = (value.slice(0, i) + typed + value.slice(i + 1)).slice(0, 6);
            update(next);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (value[i]) update(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) {
                update(value.slice(0, i - 1) + value.slice(i));
                refs.current[i - 1]?.focus();
              }
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
