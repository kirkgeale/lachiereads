import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  startMathAssessment,
  finalizeMathAssessment,
  type MathProbe,
  type MathProbeResult,
} from "@/lib/math-assessment.functions";
import { requireParentAuth } from "@/lib/auth-guard";
import { MathVisual } from "@/components/math/MathVisuals";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/parent/math-assessment/$learnerId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: MathAssessment,
});

const BAND_LABELS: Record<string, string> = {
  secure_check: "Confirming what they know",
  practising: "Practising",
  frontier: "Learning now",
  stretch: "New — a stretch",
};

type Outcome = MathProbeResult["outcome"];

function MathAssessment() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const start = useServerFn(startMathAssessment);
  const finalize = useServerFn(finalizeMathAssessment);

  const startQ = useQuery({
    queryKey: ["math-assessment", learnerId],
    queryFn: () => start({ data: { learner_id: learnerId } }),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const probes: MathProbe[] = startQ.data?.probes ?? [];
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<MathProbeResult[]>([]);
  const [notes, setNotes] = useState("");
  const [reveal, setReveal] = useState(false);

  const finishMut = useMutation({
    mutationFn: () => finalize({ data: {
      assessment_id: startQ.data!.assessment_id,
      learner_id: learnerId,
      results,
      notes: notes || null,
    } }),
    onSuccess: (r: any) => {
      toast.success("Maths assessment saved");
      qc.invalidateQueries();
      navigate({ to: "/parent/math-report/$learnerId/$assessmentId", params: { learnerId, assessmentId: startQ.data!.assessment_id } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const cur = probes[idx];
  const done = idx >= probes.length;
  const progress = probes.length ? Math.round((idx / probes.length) * 100) : 0;

  const record = (o: Outcome) => {
    if (!cur) return;
    setResults((prev) => [...prev, { id: cur.id, skill_id: cur.skill_id, outcome: o }]);
    setReveal(false);
    setIdx((i) => i + 1);
  };

  const bandBreak = useMemo(() => {
    if (!cur) return null;
    const prev = idx > 0 ? probes[idx - 1] : null;
    if (!prev) return cur.band;
    return prev.band !== cur.band ? cur.band : null;
  }, [idx, probes, cur]);

  if (startQ.isLoading) return <Center>Preparing probes…</Center>;
  if (startQ.isError) return <Center>Couldn't start assessment. <br />{String((startQ.error as any)?.message ?? "")}</Center>;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate({ to: "/parent" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> Parent
          </button>
          <div className="text-xs text-muted-foreground">{Math.min(idx + 1, probes.length)} / {probes.length}</div>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-6">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>

        {!done && bandBreak && (
          <div className="text-center text-xs uppercase tracking-widest text-muted-foreground mb-4">
            {BAND_LABELS[bandBreak]}
          </div>
        )}

        {done ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <h2 className="text-3xl font-display text-primary">All done</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Save this assessment? A quick note about how it went is optional.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="How did they seem — confident, tired, distracted?"
              className="w-full max-w-md rounded-2xl border border-input bg-background p-4"
            />
            <button onClick={() => finishMut.mutate()} disabled={finishMut.isPending}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90 disabled:opacity-50">
              {finishMut.isPending ? "Saving…" : "Save & see report"}
            </button>
          </div>
        ) : cur ? (
          <div className="flex flex-col items-center gap-6">
            <div className="text-xs uppercase tracking-widest text-accent">{cur.skill_name}</div>
            <div className="w-full rounded-[2rem] bg-card border border-border/60 shadow-sm px-6 py-10 text-center">
              <div className="font-display text-4xl md:text-5xl text-primary mb-3">{cur.prompt}</div>
              {cur.hint && <div className="text-sm text-muted-foreground">{cur.hint}</div>}
              {cur.strand === "counting" && <div className="mt-6 flex justify-center"><MathVisual kind="ten_frame" n={Math.min(10, Number(cur.prompt.match(/\d+/)?.[0] ?? 0))} /></div>}
            </div>

            {cur.answer != null && (
              <button onClick={() => setReveal((v) => !v)} className="text-xs text-muted-foreground underline">
                {reveal ? `Hide answer` : `Peek at answer`}
              </button>
            )}
            {reveal && cur.answer != null && (
              <div className="text-sm">Answer: <b className="text-primary">{cur.answer}</b></div>
            )}

            <div className="w-full">
              <div className="text-xs uppercase tracking-widest text-muted-foreground text-center mb-3">How did they do?</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <OutcomeBtn label="Got it" onClick={() => record("got_it")} tone="primary" />
                <OutcomeBtn label="Self-corrected" onClick={() => record("self_corrected")} tone="accent" />
                <OutcomeBtn label="Prompted" onClick={() => record("prompted")} tone="muted" />
                <OutcomeBtn label="Missed" onClick={() => record("missed")} tone="warn" />
                <OutcomeBtn label="Skip" onClick={() => record("skipped")} tone="ghost" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OutcomeBtn({ label, onClick, tone }: { label: string; onClick: () => void; tone: "primary" | "accent" | "muted" | "warn" | "ghost" }) {
  const cls =
    tone === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90" :
    tone === "accent" ? "bg-accent text-accent-foreground hover:bg-accent/90" :
    tone === "warn" ? "bg-[hsl(20_50%_78%)] text-[hsl(20_40%_28%)] hover:opacity-90" :
    tone === "ghost" ? "bg-transparent border border-border text-muted-foreground hover:bg-muted" :
    "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  return <button onClick={onClick} className={`rounded-full px-4 py-3 text-sm font-medium ${cls}`}>{label}</button>;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-center text-muted-foreground px-6">{children}</div>;
}
