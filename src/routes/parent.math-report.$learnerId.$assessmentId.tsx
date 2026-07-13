import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMathAssessments } from "@/lib/math-assessment.functions";
import { requireParentAuth } from "@/lib/auth-guard";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/parent/math-report/$learnerId/$assessmentId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: MathReport,
});

function MathReport() {
  const { learnerId, assessmentId } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(listMathAssessments);
  const q = useQuery({
    queryKey: ["math-assessments", learnerId],
    queryFn: () => fn({ data: { learner_id: learnerId } }),
  });

  const list = (q.data ?? []) as any[];
  const row = list.find((r) => r.id === assessmentId) ?? list[0];
  const report = row?.report_json ?? null;

  if (q.isLoading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate({ to: "/parent" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ChevronLeft className="w-4 h-4" /> Parent
        </button>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Maths assessment report</div>
        <h1 className="text-2xl md:text-3xl font-display text-primary mb-1">{report?.estimated_level ?? "—"}</h1>
        {row?.created_at && <div className="text-xs text-muted-foreground mb-6">{new Date(row.created_at).toLocaleString()}</div>}

        {!report ? (
          <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground">
            No report yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Summary</div>
              <p className="text-base">{report.plain_summary}</p>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Stat n={report.counts?.got_it ?? 0} label="Got it" />
              <Stat n={report.counts?.self_corrected ?? 0} label="Self-corrected" />
              <Stat n={report.counts?.prompted ?? 0} label="Prompted" />
              <Stat n={report.counts?.missed ?? 0} label="Missed" />
            </div>

            {report.next_focus && (
              <div className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Next focus</div>
                <div className="font-display text-lg text-primary">{report.next_focus.name}</div>
                <div className="text-sm text-muted-foreground">{report.next_focus.description}</div>
              </div>
            )}

            <div className="flex gap-3">
              <Link to="/parent/math-progress/$learnerId" params={{ learnerId }}
                className="rounded-full bg-secondary text-secondary-foreground px-5 py-2.5 text-sm">
                View full progress
              </Link>
              <Link to="/session-math/$learnerId" params={{ learnerId }}
                className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm">
                Start next maths session
              </Link>
            </div>
          </div>
        )}

        {list.length > 1 && (
          <div className="mt-8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Previous assessments</div>
            <ul className="space-y-1">
              {list.filter((r) => r.id !== row?.id).map((r) => (
                <li key={r.id}>
                  <Link to="/parent/math-report/$learnerId/$assessmentId" params={{ learnerId, assessmentId: r.id }}
                    className="text-sm text-muted-foreground hover:text-foreground">
                    {new Date(r.created_at).toLocaleDateString()} — {r.estimated_level ?? "—"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 text-center">
      <div className="text-2xl font-display text-primary">{n}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
