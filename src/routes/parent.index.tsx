import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listLearners } from "@/lib/learners.functions";
import { getParentSettings } from "@/lib/parent.functions";
import { getProgressTimeline } from "@/lib/dashboard.functions";
import { LineChart as LC, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from "recharts";
import { ClipboardCheck } from "lucide-react";


export const Route = createFileRoute("/parent/")({
  ssr: false,
  component: ParentHome,
});

function ParentHome() {
  const listLearnersFn = useServerFn(listLearners);
  const getSettingsFn = useServerFn(getParentSettings);
  const getTimelineFn = useServerFn(getProgressTimeline);

  const learnersQ = useQuery({ queryKey: ["learners"], queryFn: () => listLearnersFn() });
  const settingsQ = useQuery({ queryKey: ["parent-settings"], queryFn: () => getSettingsFn() });
  const activeId = settingsQ.data?.active_learner_id ?? learnersQ.data?.[0]?.id;
  const timelineQ = useQuery({
    queryKey: ["timeline", activeId],
    queryFn: () => getTimelineFn({ data: { learner_id: activeId! } }),
    enabled: !!activeId,
  });

  if (!activeId) {
    return (
      <div className="bg-card rounded-3xl border border-border/60 p-8 text-center">
        <p className="text-muted-foreground mb-4">No learners yet.</p>
        <Link to="/parent/learners" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 inline-block">
          Add a learner
        </Link>
      </div>
    );
  }

  const sessions = timelineQ.data?.sessions ?? [];
  const chartData = sessions.map((s) => ({
    date: new Date(s.date).toLocaleDateString(),
    events: s.total_events,
    got_it: s.got_it,
    self_corrected: (s as any).self_corrected ?? 0,
    prompted: (s as any).prompted ?? 0,
    missed: s.missed,
  }));

  const secure = timelineQ.data?.secure_count ?? 0;
  const practising = timelineQ.data?.practising_count ?? 0;
  const learning = timelineQ.data?.learning_count ?? 0;

  return (
    <div className="space-y-6">
      <Link
        to="/parent/assessment/$learnerId"
        params={{ learnerId: activeId }}
        className="flex items-center gap-4 rounded-3xl bg-primary text-primary-foreground p-5 shadow-sm hover:opacity-95 transition"
      >
        <ClipboardCheck className="w-8 h-8 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-display text-lg">Run reading assessment</div>
          <div className="text-sm opacity-90">AI-guided probes to pinpoint level and update practice plan.</div>
        </div>
        <span className="text-2xl">→</span>
      </Link>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Secure sounds" value={secure} tone="primary" />
        <StatCard label="Practising" value={practising} tone="accent" />
        <StatCard label="Learning" value={learning} tone="muted" />
      </div>


      <Card title="Session outcomes over time">
        {chartData.length === 0 ? (
          <EmptyState text="No sessions yet — start one from the garden." />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="got_it" stackId="a" fill="hsl(var(--chart-1))" name="Got it" />
                <Bar dataKey="self_corrected" stackId="a" fill="hsl(var(--chart-3))" name="Self-corrected" />
                <Bar dataKey="prompted" stackId="a" fill="hsl(var(--chart-4))" name="Prompted" />
                <Bar dataKey="missed" stackId="a" fill="hsl(var(--chart-2))" name="Missed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Session length">
        {chartData.length === 0 ? (
          <EmptyState text="No sessions yet." />
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LC data={sessions.map((s) => ({ date: new Date(s.date).toLocaleDateString(), minutes: Math.round(s.duration_seconds / 60) }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="minutes" stroke="hsl(var(--chart-3))" strokeWidth={2} />
              </LC>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "primary" | "accent" | "muted" }) {
  const cls = tone === "primary" ? "bg-primary/10 text-primary" : tone === "accent" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground";
  return (
    <div className={`rounded-2xl p-4 ${cls}`}>
      <div className="text-3xl font-display">{value}</div>
      <div className="text-xs opacity-80 mt-1">{label}</div>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-3xl border border-border/60 p-6 shadow-sm">
      <h2 className="text-lg font-display text-primary mb-3">{title}</h2>
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-6">{text}</p>;
}
