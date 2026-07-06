import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getProgressTimeline } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/parent/sessions/$learnerId")({
  ssr: false,
  component: SessionHistory,
});

function SessionHistory() {
  const { learnerId } = Route.useParams();
  const fn = useServerFn(getProgressTimeline);
  const q = useQuery({
    queryKey: ["timeline", learnerId],
    queryFn: () => fn({ data: { learner_id: learnerId } }),
  });

  const sessions = q.data?.sessions ?? [];

  return (
    <div className="bg-card rounded-3xl border border-border/60 p-6">
      <h2 className="text-lg font-display text-primary mb-4">Session history</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {sessions
            .slice()
            .reverse()
            .map((s) => (
              <li key={s.id} className="py-3 flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium">{new Date(s.date).toLocaleString()}</div>
                  {s.parent_notes && (
                    <div className="text-xs text-muted-foreground italic mt-0.5">"{s.parent_notes}"</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(s.duration_seconds / 60)} min
                </div>
                <div className="flex gap-1 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary">{s.got_it}</span>
                  <span className="px-2 py-0.5 rounded-full bg-[hsl(20_40%_78%)] text-[hsl(20_40%_28%)]">{s.missed}</span>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
