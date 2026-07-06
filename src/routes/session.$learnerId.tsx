import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { startSession, saveSessionEvents } from "@/lib/session.functions";
import { OutcomeButtons } from "@/components/OutcomeButtons";
import { ItemCard } from "@/components/ItemCard";
import { requireParentAuth } from "@/lib/auth-guard";
import type { Outcome, QueuedEvent, SessionCard } from "@/lib/types";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/session/$learnerId")({
  ssr: false,
  beforeLoad: async () => {
    await requireParentAuth();
  },
  component: SessionScreen,
});

const STAGE_LABELS: Record<string, string> = {
  intro: "Today's focus",
  warmup: "Warm-up",
  target: "New sound",
  blend: "Blend ladder",
  practice: "Word reading",
  sentence: "Sentence",
  story: "Mini story",
  interference: "Sound check",
  game: "Quick game",
  wrapup: "Wrap-up",
};

function SessionScreen() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const start = useServerFn(startSession);
  const save = useServerFn(saveSessionEvents);

  const planQ = useQuery({
    queryKey: ["session-plan", learnerId],
    queryFn: () => start({ data: { learner_id: learnerId } }),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [idx, setIdx] = useState(0);
  const [events, setEvents] = useState<QueuedEvent[]>([]);
  const [notes, setNotes] = useState("");
  const startedAt = useRef(Date.now());

  const saveMut = useMutation({
    mutationFn: (payload: { events: QueuedEvent[]; notes: string; duration_seconds: number }) =>
      save({
        data: {
          session_id: planQ.data!.session_id,
          learner_id: learnerId,
          events: payload.events,
          duration_seconds: payload.duration_seconds,
          parent_notes: payload.notes || null,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Session complete — ${res.stars_awarded} star${res.stars_awarded === 1 ? "" : "s"}!`);
      navigate({ to: "/" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const cards: SessionCard[] = planQ.data?.cards ?? [];
  const current = cards[idx];

  const onOutcome = (o: Outcome) => {
    if (!current || current.stage === "wrapup") return;
    setEvents((prev) => [
      ...prev,
      { card_key: current.key, item_type: current.item_type, item_ref: current.item_ref, outcome: o },
    ]);
    setIdx((i) => Math.min(cards.length - 1, i + 1));
  };

  const onFinish = () => {
    const dur = Math.round((Date.now() - startedAt.current) / 1000);
    saveMut.mutate({ events, notes, duration_seconds: dur });
  };

  const stageBreak = useMemo(() => {
    if (!current) return null;
    const prev = idx > 0 ? cards[idx - 1] : null;
    if (!prev) return current.stage;
    return prev.stage !== current.stage ? current.stage : null;
  }, [idx, cards, current]);

  if (planQ.isLoading) {
    return <FullScreenLoader label="Getting ready…" />;
  }
  if (planQ.isError || !current) {
    return (
      <FullScreenMessage
        title="Couldn't start the session"
        detail={String((planQ.error as any)?.message ?? "")}
        onBack={() => navigate({ to: "/" })}
      />
    );
  }

  const progress = cards.length ? Math.round(((idx + 1) / cards.length) * 100) : 0;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" /> Home
          </button>
          <div className="text-xs text-muted-foreground">
            {idx + 1} / {cards.length}
          </div>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-8">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>

        {current.stage === "wrapup" ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <h2 className="text-3xl font-display text-primary">Beautiful work</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Save this session? A quick note is optional but useful later.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What went well or what to try next time…"
              className="w-full max-w-md rounded-2xl border border-input bg-background p-4"
            />
            <button
              onClick={onFinish}
              disabled={saveMut.isPending}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMut.isPending ? "Saving…" : "Finish"}
            </button>
          </div>
        ) : (
          <>
            <ItemCard card={current} stageLabel={stageBreak ? STAGE_LABELS[stageBreak] : undefined} />
            <div className="mt-10">
              <OutcomeButtons onOutcome={onOutcome} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function FullScreenMessage({ title, detail, onBack }: { title: string; detail?: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="text-2xl font-display text-primary">{title}</h2>
        {detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}
        <button
          onClick={onBack}
          className="mt-6 rounded-full bg-primary text-primary-foreground px-6 py-3"
        >
          Home
        </button>
      </div>
    </div>
  );
}
