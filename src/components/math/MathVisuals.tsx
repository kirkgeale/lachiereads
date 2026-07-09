// Small, calm CPA visuals. Kept dependency-free so they can be rendered
// server-side or client-side without knowing the surrounding session state.

export function TenFrame({ n, max = 10 }: { n: number; max?: number }) {
  const clamped = Math.max(0, Math.min(max, Math.round(n)));
  const cells = Array.from({ length: max }, (_, i) => i < clamped);
  return (
    <div className="inline-grid grid-cols-5 gap-1.5 p-2 rounded-2xl bg-muted/40 border border-border/60">
      {cells.map((filled, i) => (
        <div
          key={i}
          className={`w-8 h-8 rounded-full border-2 ${filled ? "bg-primary border-primary" : "bg-transparent border-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

export function NumberLine({ max = 10, marker }: { max?: number; marker?: number | null }) {
  const nums = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="w-full max-w-md">
      <div className="relative h-16">
        <div className="absolute inset-x-2 top-1/2 h-0.5 bg-muted-foreground/40" />
        <div className="relative flex justify-between px-2">
          {nums.map((n) => (
            <div key={n} className="flex flex-col items-center">
              <div className={`w-2 h-2 rounded-full ${marker === n ? "bg-primary" : "bg-muted-foreground/50"} mt-[calc(2rem-0.25rem)]`} />
              <div className={`text-xs mt-2 ${marker === n ? "text-primary font-bold" : "text-muted-foreground"}`}>{n}</div>
            </div>
          ))}
        </div>
        {marker != null && (
          <div
            className="absolute -top-1 text-primary text-xl"
            style={{ left: `calc(${(marker / max) * 100}% - 0.5rem)` }}
            aria-hidden
          >
            ▼
          </div>
        )}
      </div>
    </div>
  );
}

export function DotGroups({ n }: { n: number }) {
  const dots = Array.from({ length: Math.max(0, Math.min(20, Math.round(n))) });
  return (
    <div className="flex flex-wrap gap-2 justify-center p-3 rounded-2xl bg-muted/40 border border-border/60 max-w-xs">
      {dots.map((_, i) => (
        <div key={i} className="w-6 h-6 rounded-full bg-primary" />
      ))}
    </div>
  );
}

export function MathVisual({ kind, n }: { kind: "ten_frame" | "number_line" | "dots" | "none"; n?: number | null }) {
  if (kind === "ten_frame") return <TenFrame n={n ?? 0} max={10} />;
  if (kind === "number_line") return <NumberLine max={10} marker={n ?? null} />;
  if (kind === "dots") return <DotGroups n={n ?? 0} />;
  return null;
}
