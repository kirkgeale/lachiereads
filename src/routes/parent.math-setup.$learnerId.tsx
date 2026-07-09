import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listMathSkills, applyMathQuickSetup, getMathSummary } from "@/lib/math.functions";
import { requireParentAuth } from "@/lib/auth-guard";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/parent/math-setup/$learnerId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: MathQuickSetup,
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

type Level = "not_yet" | "getting_there" | "knows_well";

function MathQuickSetup() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useServerFn(listMathSkills);
  const apply = useServerFn(applyMathQuickSetup);
  const summary = useServerFn(getMathSummary);

  const skillsQ = useQuery({ queryKey: ["math-skills"], queryFn: () => list() });
  const summaryQ = useQuery({
    queryKey: ["math-summary", learnerId],
    queryFn: () => summary({ data: { learner_id: learnerId } }),
  });

  const [levels, setLevels] = useState<Record<string, Level>>({});

  const currentLevel = (id: string): Level => {
    if (levels[id]) return levels[id];
    const row = (summaryQ.data?.statuses ?? []).find((r: any) => r.skill_id === id);
    if (row?.status === "secure") return "knows_well";
    if (row?.status === "practising" || row?.status === "learning") return "getting_there";
    return "not_yet";
  };

  const applyMut = useMutation({
    mutationFn: () => apply({ data: {
      learner_id: learnerId,
      skills: (skillsQ.data ?? []).map((s: any) => ({ skill_id: s.id, level: currentLevel(s.id) })),
    } }),
    onSuccess: () => {
      toast.success("Maths set-up saved");
      qc.invalidateQueries();
      navigate({ to: "/session-math/$learnerId", params: { learnerId } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const skills = skillsQ.data ?? [];
  const byPhase = new Map<number, any[]>();
  for (const s of skills) {
    const arr = byPhase.get(s.phase) ?? byPhase.set(s.phase, []).get(s.phase)!;
    arr.push(s);
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate({ to: "/" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" /> Home
        </button>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Maths quick set-up</div>
        <h1 className="text-2xl md:text-3xl font-display text-primary mb-2">Tell us what they already know</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Tap once per skill. Anything you leave alone stays "not yet". You can change these later.
        </p>

        <div className="space-y-6">
          {[...byPhase.entries()].sort(([a], [b]) => a - b).map(([phase, list]) => (
            <div key={phase} className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
                Phase {phase} · {PHASES[phase] ?? ""}
              </div>
              <div className="space-y-2">
                {list.map((s: any) => {
                  const cur = currentLevel(s.id);
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{s.description}</div>
                      </div>
                      <div className="flex gap-1">
                        {(["not_yet","getting_there","knows_well"] as Level[]).map((lvl) => (
                          <button key={lvl}
                            onClick={() => setLevels((p) => ({ ...p, [s.id]: lvl }))}
                            className={`text-xs px-3 py-1.5 rounded-full border ${cur === lvl
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-transparent border-border text-muted-foreground hover:bg-muted"}`}>
                            {lvl === "not_yet" ? "Not yet" : lvl === "getting_there" ? "Getting there" : "Knows well"}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="sticky bottom-4 mt-6 flex justify-end">
          <button
            onClick={() => applyMut.mutate()}
            disabled={applyMut.isPending || skills.length === 0}
            className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90 disabled:opacity-50 shadow-lg">
            {applyMut.isPending ? "Saving…" : "Save & start maths"}
          </button>
        </div>
      </div>
    </div>
  );
}
