import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getInterferenceMap } from "@/lib/dashboard.functions";
import { setInterferenceStatus } from "@/lib/content.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/parent/interference/$learnerId")({
  ssr: false,
  component: InterferencePage,
});

const OPTIONS = [
  { value: "still_confuses", label: "Still confuses", tone: "bg-[hsl(20_40%_78%)] text-[hsl(20_40%_28%)]" },
  { value: "resolving", label: "Resolving", tone: "bg-[hsl(40_60%_82%)] text-[hsl(30_50%_30%)]" },
  { value: "secure", label: "Secure", tone: "bg-primary text-primary-foreground" },
] as const;

function InterferencePage() {
  const { learnerId } = Route.useParams();
  const qc = useQueryClient();
  const mapFn = useServerFn(getInterferenceMap);
  const setStatus = useServerFn(setInterferenceStatus);

  const mapQ = useQuery({
    queryKey: ["interference", learnerId],
    queryFn: () => mapFn({ data: { learner_id: learnerId } }),
  });

  const mut = useMutation({
    mutationFn: ({ interference_id, status }: any) =>
      setStatus({ data: { learner_id: learnerId, interference_id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["interference", learnerId] }),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-2">
        Swedish→English confusions. Track how each is settling in.
      </p>
      {(mapQ.data ?? []).map((r: any) => (
        <div key={r.interference_id} className="bg-card rounded-2xl border border-border/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-display text-primary">
                <span className="mr-2">{r.interference_items.grapheme}</span>
                <span className="text-sm text-muted-foreground align-middle">e.g. {r.interference_items.example_word}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Swedish: <b>{r.interference_items.swedish_value}</b> · English: <b>{r.interference_items.english_value}</b>
              </div>
              {r.interference_items.note && (
                <p className="text-xs text-muted-foreground mt-1 italic">{r.interference_items.note}</p>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => mut.mutate({ interference_id: r.interference_id, status: o.value })}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs whitespace-nowrap",
                    r.status === o.value ? o.tone : "border border-input text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
