import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMathProgress } from "@/lib/math-assessment.functions";
import { requireParentAuth } from "@/lib/auth-guard";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/parent/math-progress/$learnerId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: MathProgress,
});

const PHASES: Record<number, string> = {
  1: "Counting",
  2: "Seeing amounts",
  3: "Comparing",
  4: "Number bonds",
  5: "Adding to 10",
  6: "Subtracting to 10",
  7: "Within 20",
  8: "Place value",
  9: "Word problems",
};

const STATUS_TONE: Record<string, string> = {
  secure: "bg-primary/15 text-primary",
  practising: "bg-accent/20 text-accent-foreground",
  learning: "bg-[hsl(40_70%_85%)] text-[hsl(30_50%_28%)]",
  not_started: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  secure: "Secure",
  practising: "Practising",
  learning: "Learning",
  not_started: "Not yet",
};

function MathProgress() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(getMathProgress);
  const q = useQuery({
    queryKey: ["math-progress", learnerId],
    queryFn: () => fn({ data: { learner_id: learnerId } }),
  });

  const rows = (q.data ?? []) as any[];
  const byPhase = new Map<number, any[]>();
  for (const r of rows) {
    const p = r.math_skills?.phase ?? 0;
    (byPhase.get(p) ?? byPhase.set(p, []).get(p)!).push(r);
  }

  const counts = { secure: 0, practising: 0, learning: 0, not_started: 0 };
  for (const r of rows) counts[(r.status ?? "not_started") as keyof typeof counts]++;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate({ to: "/parent" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" /> Parent
        </button>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Maths progress</div>
        <h1 className="text-2xl md:text-3xl font-display text-primary mb-4">Where they are now</h1>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {(["secure","practising","learning","not_started"] as const).map((k) => (
            <div key={k} className="bg-card rounded-2xl border border-border/60 p-3 text-center">
              <div className="text-xl font-display text-primary">{counts[k]}</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{STATUS_LABEL[k]}</div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {[...byPhase.entries()].sort(([a],[b]) => a - b).map(([phase, list]) => (
            <div key={phase} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Phase {phase} · {PHASES[phase] ?? ""}
              </div>
              <div className="space-y-2">
                {list.map((r) => (
                  <div key={r.skill_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.math_skills?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.math_skills?.description}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-full ${STATUS_TONE[r.status] ?? STATUS_TONE.not_started}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
