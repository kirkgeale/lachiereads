import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPhonicsMap } from "@/lib/dashboard.functions";
import { overrideGpcStatus } from "@/lib/content.functions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/parent/phonics/$learnerId")({
  ssr: false,
  component: PhonicsMap,
});

const STATUS_STYLE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  learning: "bg-[hsl(40_60%_82%)] text-[hsl(30_50%_30%)]",
  practising: "bg-[hsl(20_40%_78%)] text-[hsl(20_40%_28%)]",
  secure: "bg-primary text-primary-foreground",
};

function PhonicsMap() {
  const { learnerId } = Route.useParams();
  const qc = useQueryClient();
  const mapFn = useServerFn(getPhonicsMap);
  const overrideFn = useServerFn(overrideGpcStatus);

  const mapQ = useQuery({
    queryKey: ["phonics-map", learnerId],
    queryFn: () => mapFn({ data: { learner_id: learnerId } }),
  });

  const cycle = useMutation({
    mutationFn: ({ gpc_id, status }: { gpc_id: string; status: any }) =>
      overrideFn({ data: { learner_id: learnerId, gpc_id, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phonics-map", learnerId] });
      toast.success("Updated");
    },
  });

  const next = (s: string) => {
    const order = ["not_started", "learning", "practising", "secure"];
    return order[(order.indexOf(s) + 1) % order.length];
  };

  const rows = mapQ.data ?? [];
  const byPhase: Record<number, any[]> = {};
  for (const r of rows) {
    const phase = (r as any).gpcs?.phase ?? 1;
    (byPhase[phase] ??= []).push(r);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Tap a cell to cycle its status. Colours show mastery.
      </p>
      {Object.keys(byPhase)
        .map(Number)
        .sort((a, b) => a - b)
        .map((phase) => (
          <div key={phase} className="bg-card rounded-3xl border border-border/60 p-5">
            <h3 className="text-sm font-display uppercase tracking-wider text-muted-foreground mb-3">
              Phase {phase}
            </h3>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {byPhase[phase].map((r: any) => (
                <button
                  key={r.gpc_id}
                  onClick={() => cycle.mutate({ gpc_id: r.gpc_id, status: next(r.status) })}
                  className={cn(
                    "rounded-2xl py-4 flex flex-col items-center justify-center transition-all active:scale-95",
                    STATUS_STYLE[r.status],
                  )}
                  title={r.gpcs?.sound_label}
                >
                  <span className="text-2xl font-display">{r.gpcs?.grapheme}</span>
                  <span className="text-[10px] opacity-70 mt-1">{r.status.replace("_", " ")}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      <div className="text-xs text-muted-foreground flex gap-4 flex-wrap">
        <span><span className="inline-block w-3 h-3 rounded bg-muted mr-1 align-middle" /> not started</span>
        <span><span className="inline-block w-3 h-3 rounded bg-[hsl(40_60%_82%)] mr-1 align-middle" /> learning</span>
        <span><span className="inline-block w-3 h-3 rounded bg-[hsl(20_40%_78%)] mr-1 align-middle" /> practising</span>
        <span><span className="inline-block w-3 h-3 rounded bg-primary mr-1 align-middle" /> secure</span>
      </div>
    </div>
  );
}
