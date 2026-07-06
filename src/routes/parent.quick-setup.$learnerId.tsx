import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getPhonicsMap, getHeartWordsMap } from "@/lib/dashboard.functions";
import { applyQuickCalibration } from "@/lib/learners.functions";
import { requireParentAuth } from "@/lib/auth-guard";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/parent/quick-setup/$learnerId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: QuickSetup,
});

type Level = "not_yet" | "getting_there" | "knows_well";
const LEVELS: { value: Level; label: string; tone: string }[] = [
  { value: "not_yet", label: "Not yet", tone: "bg-muted text-muted-foreground" },
  { value: "getting_there", label: "Getting there", tone: "bg-[hsl(40_60%_82%)] text-[hsl(30_50%_30%)]" },
  { value: "knows_well", label: "Knows it well", tone: "bg-primary text-primary-foreground" },
];

function QuickSetup() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gpcFn = useServerFn(getPhonicsMap);
  const hwFn = useServerFn(getHeartWordsMap);
  const applyFn = useServerFn(applyQuickCalibration);

  const gpcQ = useQuery({ queryKey: ["phonics", learnerId], queryFn: () => gpcFn({ data: { learner_id: learnerId } }) });
  const hwQ = useQuery({ queryKey: ["hearts", learnerId], queryFn: () => hwFn({ data: { learner_id: learnerId } }) });

  const [gpcLevels, setGpcLevels] = useState<Record<string, Level>>({});
  const [hwLevels, setHwLevels] = useState<Record<string, Level>>({});

  const groupedGpc = useMemo(() => {
    const byPhase: Record<number, any[]> = {};
    for (const row of (gpcQ.data ?? []) as any[]) {
      const phase = row.gpcs?.phase ?? 1;
      (byPhase[phase] ||= []).push(row);
    }
    return Object.entries(byPhase).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [gpcQ.data]);

  const setGpc = (id: string, level: Level) => setGpcLevels((p) => ({ ...p, [id]: level }));
  const setHw = (id: string, level: Level) => setHwLevels((p) => ({ ...p, [id]: level }));

  const saveMut = useMutation({
    mutationFn: () =>
      applyFn({
        data: {
          learner_id: learnerId,
          gpcs: Object.entries(gpcLevels).map(([gpc_id, level]) => ({ gpc_id, level })),
          heart_words: Object.entries(hwLevels).map(([heart_word_id, level]) => ({ heart_word_id, level })),
        },
      }),
    onSuccess: () => {
      toast.success("Starting point saved");
      qc.invalidateQueries();
      navigate({ to: "/learner" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const touched = Object.keys(gpcLevels).length + Object.keys(hwLevels).length;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => navigate({ to: "/learner" })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Quick set-up</div>
          <h1 className="text-2xl md:text-3xl font-display text-primary mt-1">Tick what they already know</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Skip anything you're unsure about. Anything left blank stays "not yet" and we'll introduce it gradually.
          </p>
        </div>

        {groupedGpc.map(([phase, rows]) => (
          <div key={phase} className="bg-card rounded-3xl border border-border/60 p-5">
            <h2 className="text-lg font-display text-primary mb-3">Phase {phase} — sounds</h2>
            <div className="space-y-2">
              {rows.map((r: any) => (
                <Row
                  key={r.gpc_id}
                  label={r.gpcs.grapheme}
                  sublabel={r.gpcs.sound_label ? `/${r.gpcs.sound_label}/` : ""}
                  value={gpcLevels[r.gpc_id] ?? null}
                  onChange={(v) => setGpc(r.gpc_id, v)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="bg-card rounded-3xl border border-border/60 p-5">
          <h2 className="text-lg font-display text-primary mb-3">Common words (by sight)</h2>
          <div className="space-y-2">
            {((hwQ.data ?? []) as any[]).map((r) => (
              <Row
                key={r.heart_word_id}
                label={r.heart_words.word}
                value={hwLevels[r.heart_word_id] ?? null}
                onChange={(v) => setHw(r.heart_word_id, v)}
              />
            ))}
          </div>
        </div>

        <div className="sticky bottom-4 flex items-center justify-between rounded-2xl bg-card border border-border/60 p-4 shadow">
          <div className="text-sm text-muted-foreground">{touched} item{touched === 1 ? "" : "s"} set</div>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || touched === 0}
            className="rounded-full bg-primary text-primary-foreground px-6 py-2.5 font-medium disabled:opacity-50"
          >
            {saveMut.isPending ? "Saving…" : "Save & start"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, sublabel, value, onChange,
}: { label: string; sublabel?: string; value: Level | null; onChange: (v: Level) => void }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 min-w-0">
        <span className="font-display text-primary text-lg">{label}</span>
        {sublabel && <span className="ml-2 text-xs text-muted-foreground">{sublabel}</span>}
      </div>
      <div className="flex gap-1 shrink-0">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => onChange(l.value)}
            className={
              "rounded-full px-3 py-1.5 text-xs whitespace-nowrap border " +
              (value === l.value
                ? l.tone + " border-transparent"
                : "border-input text-muted-foreground hover:bg-secondary")
            }
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
