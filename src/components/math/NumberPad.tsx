import { useState } from "react";

// Big, calm number pad. Never shows a timer or negative sound; parent-facing
// text stays encouraging. Enter fires onSubmit(value).
export function NumberPad({ onSubmit, disabled, max = 100 }: { onSubmit: (n: number) => void; disabled?: boolean; max?: number }) {
  const [value, setValue] = useState("");
  const commit = () => {
    if (value === "" || disabled) return;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= max) {
      onSubmit(n);
      setValue("");
    }
  };
  const append = (d: string) => {
    if (disabled) return;
    const next = (value + d).slice(0, 3);
    if (Number(next) > max) return;
    setValue(next);
  };
  return (
    <div className="w-full max-w-xs mx-auto">
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-center text-4xl font-display min-h-[3.5rem]">
        {value || <span className="text-muted-foreground">?</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button key={d} onClick={() => append(d)} disabled={disabled}
            className="rounded-2xl bg-muted hover:bg-muted/80 py-4 text-2xl font-display disabled:opacity-40">
            {d}
          </button>
        ))}
        <button onClick={() => setValue((v) => v.slice(0, -1))} disabled={disabled || !value}
          className="rounded-2xl bg-secondary hover:bg-secondary/80 py-4 text-lg disabled:opacity-40">
          ←
        </button>
        <button onClick={() => append("0")} disabled={disabled}
          className="rounded-2xl bg-muted hover:bg-muted/80 py-4 text-2xl font-display disabled:opacity-40">
          0
        </button>
        <button onClick={commit} disabled={disabled || value === ""}
          className="rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 py-4 text-lg disabled:opacity-40">
          Enter
        </button>
      </div>
    </div>
  );
}
