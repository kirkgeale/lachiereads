import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { startAssessment, finalizeAssessment, listAssessments, getReportContext } from "@/lib/assessment.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ClipboardCheck, ChevronLeft, Check, RotateCcw, MessageCircle, X, SkipForward, Sparkles, Loader2 } from "lucide-react";
import { Card, EmptyState } from "./parent.index";

export const Route = createFileRoute("/parent/assessment/$learnerId")({
  ssr: false,
  component: AssessmentPage,
});

type Probe = {
  id: string;
  kind: string;
  prompt: string;
  target_grapheme?: string;
  target_heart_word?: string;
  difficulty: number;
  notes?: string;
};
type Outcome = "correct" | "self_corrected" | "prompted" | "missed" | "skipped";

function AssessmentPage() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const startFn = useServerFn(startAssessment);
  const finalizeFn = useServerFn(finalizeAssessment);
  const listFn = useServerFn(listAssessments);

  const historyQ = useQuery({
    queryKey: ["assessments", learnerId],
    queryFn: () => listFn({ data: { learner_id: learnerId } }),
  });

  const [session, setSession] = useState<{ assessment_id: string; probes: Probe[] } | null>(null);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<(Probe & { outcome: Outcome })[]>([]);
  const [report, setReport] = useState<any | null>(null);

  const startMut = useMutation({
    mutationFn: () => startFn({ data: { learner_id: learnerId } }),
    onSuccess: (r) => {
      setSession(r);
      setIdx(0);
      setResults([]);
      setReport(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to start"),
  });

  const finalMut = useMutation({
    mutationFn: (payload: (Probe & { outcome: Outcome })[]) =>
      finalizeFn({
        data: { assessment_id: session!.assessment_id, learner_id: learnerId, results: payload },
      }),
    onSuccess: (r) => {
      setReport(r.report);
      toast.success("Assessment saved — learner plan updated.");
      historyQ.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const record = (outcome: Outcome) => {
    if (!session) return;
    const probe = session.probes[idx];
    setResults((prev) => [...prev, { ...probe, outcome }]);
    setIdx((i) => i + 1);
  };

  const finish = () => finalMut.mutate(results);

  // Report view
  if (report) {
    const plainSummary = report.plain_summary ?? report.summary;
    const canDo = report.what_they_can_do ?? report.strengths ?? [];
    const workingOn = report.working_on ?? report.focus_areas ?? [];
    const notYet = report.not_yet ?? [];
    const actions = report.parent_actions_this_week ?? report.next_steps ?? [];
    return (
      <div className="space-y-4">
        <Header title="Assessment report" onBack={() => setReport(null)} backLabel="Assessment home" />
        {plainSummary && (
          <Card title="How the reading is going">
            <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{plainSummary}</p>
          </Card>
        )}
        {canDo.length > 0 && (
          <Card title="What they can do">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground/90">
              {canDo.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        )}
        {workingOn.length > 0 && (
          <Card title="What we're working on">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground/90">
              {workingOn.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        )}
        {notYet.length > 0 && (
          <Card title="Not looked at yet">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground/90">
              {notYet.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        )}
        {actions.length > 0 && (
          <Card title="What to do this week">
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground/90">
              {actions.map((s: string, i: number) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => setReport(null)}
            className="rounded-full bg-secondary text-secondary-foreground px-5 py-2.5"
          >
            Done
          </button>
          <button
            onClick={() => navigate({ to: "/parent" })}
            className="rounded-full bg-primary text-primary-foreground px-5 py-2.5"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  // In-progress view
  if (session) {
    const done = idx >= session.probes.length;
    const current = session.probes[idx];
    const progress = Math.round(((done ? session.probes.length : idx) / session.probes.length) * 100);
    return (
      <div className="space-y-4">
        <Header title="Reading assessment" onBack={() => setSession(null)} backLabel="Cancel" />
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">
          Probe {Math.min(idx + 1, session.probes.length)} of {session.probes.length}
        </div>

        {done ? (
          <Card title="All done">
            <p className="text-sm mb-4">
              Ready to generate the report and apply level updates to the app?
            </p>
            <div className="flex gap-2">
              <button
                onClick={finish}
                disabled={finalMut.isPending}
                className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 flex items-center gap-2 disabled:opacity-60"
              >
                {finalMut.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Generate report</>
                )}
              </button>
              <button
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                className="rounded-full border border-input px-5 py-2.5"
              >
                Re-do last
              </button>
            </div>
          </Card>
        ) : (
          <Card title={`Show this to ${current.kind === "sentence" ? "the child (sentence)" : "the child"}`}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              {current.kind.replace(/_/g, " ")} · difficulty {current.difficulty}
            </div>
            <div className="rounded-2xl bg-muted/60 p-8 text-center flex flex-col items-center gap-2">
              <div className="font-display text-5xl md:text-6xl text-primary">
                {current.kind === "sentence"
                  ? current.prompt.replace(/\b([a-z])/g, (m) => m.toUpperCase())
                  : current.prompt.toUpperCase()}
              </div>
              {current.kind !== "sentence" && current.prompt.toUpperCase() !== current.prompt.toLowerCase() && (
                <div className="text-2xl text-muted-foreground tracking-wide">{current.prompt.toLowerCase()}</div>
              )}
            </div>
            {current.notes && (
              <p className="text-xs text-muted-foreground mt-3">Listen for: {current.notes}</p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-6">
              <OutcomeBtn onClick={() => record("correct")} icon={<Check className="w-4 h-4" />} label="Correct" tone="primary" />
              <OutcomeBtn onClick={() => record("self_corrected")} icon={<RotateCcw className="w-4 h-4" />} label="Self-corrected" tone="accent" />
              <OutcomeBtn onClick={() => record("prompted")} icon={<MessageCircle className="w-4 h-4" />} label="Prompted" tone="accent" />
              <OutcomeBtn onClick={() => record("missed")} icon={<X className="w-4 h-4" />} label="Missed" tone="muted" />
              <OutcomeBtn onClick={() => record("skipped")} icon={<SkipForward className="w-4 h-4" />} label="Skip" tone="muted" />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
              <b>Correct</b>: read cleanly first try. <b>Self-corrected</b>: fixed it themselves. <b>Prompted</b>: needed a hint. <b>Missed</b>: couldn't read it.
            </p>
          </Card>
        )}
      </div>
    );
  }

  // Home view (no active session)
  return (
    <div className="space-y-4">
      <Header title="Reading assessment" />
      <Card title="How this works">
        <p className="text-sm text-muted-foreground">
          A parent-administered check-in. You'll be shown a short battery of probes
          (letters, words, a sentence) that get progressively harder. Tap what happened.
          When you're done, the app writes a concise report and updates the learner's
          internal level so practice targets the right things.
        </p>
        <div className="mt-4">
          <button
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
            className="rounded-full bg-primary text-primary-foreground px-6 py-3 flex items-center gap-2 disabled:opacity-60"
          >
            {startMut.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Preparing probes…</>
            ) : (
              <><ClipboardCheck className="w-4 h-4" /> Start assessment</>
            )}
          </button>
        </div>
      </Card>

      <Card title="Previous assessments">
        {historyQ.data && historyQ.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {historyQ.data.map((a: any) => (
              <li key={a.id} className="py-3">
                <div className="text-sm font-medium text-primary">{a.estimated_level || "Assessment"}</div>
                <div className="text-xs text-muted-foreground mb-1">
                  {new Date(a.created_at).toLocaleString()} {a.applied ? "· applied" : "· not applied"}
                </div>
                {a.summary && <p className="text-sm text-foreground/90">{a.summary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState text="No assessments yet." />
        )}
      </Card>
    </div>
  );
}

function Header({ title, onBack, backLabel }: { title: string; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-display text-primary">{title}</h1>
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> {backLabel ?? "Back"}
        </button>
      )}
    </div>
  );
}

function OutcomeBtn({
  onClick, icon, label, tone,
}: { onClick: () => void; icon: React.ReactNode; label: string; tone: "primary" | "accent" | "muted" }) {
  const cls =
    tone === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : tone === "accent"
      ? "bg-accent text-accent-foreground hover:bg-accent/90"
      : "bg-secondary text-secondary-foreground hover:bg-secondary/70";
  return (
    <button onClick={onClick} className={`rounded-full px-4 py-3 flex items-center justify-center gap-2 ${cls}`}>
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
