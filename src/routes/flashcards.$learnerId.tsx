import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { buildFlashcardDeck, saveFlashcardEvents } from "@/lib/session.functions";
import { OutcomeButtons } from "@/components/OutcomeButtons";
import { ItemCard } from "@/components/ItemCard";
import { requireParentAuth } from "@/lib/auth-guard";
import type { Outcome, QueuedEvent } from "@/lib/types";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/flashcards/$learnerId")({
  ssr: false,
  beforeLoad: async () => {
    await requireParentAuth();
  },
  component: FlashcardsScreen,
});

function FlashcardsScreen() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const build = useServerFn(buildFlashcardDeck);
  const save = useServerFn(saveFlashcardEvents);

  const deckQ = useQuery({
    queryKey: ["flashcards", learnerId],
    queryFn: () => build({ data: { learner_id: learnerId } }),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [idx, setIdx] = useState(0);
  const [events, setEvents] = useState<QueuedEvent[]>([]);
  const cards = deckQ.data ?? [];
  const current = cards[idx];
  const done = deckQ.isSuccess && idx >= cards.length;

  const saveMut = useMutation({
    mutationFn: (evts: QueuedEvent[]) => save({ data: { learner_id: learnerId, events: evts } }),
    onSuccess: (r) => {
      toast.success(`Nice — ${r.stars_awarded} star${r.stars_awarded === 1 ? "" : "s"}!`);
      navigate({ to: "/" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const onOutcome = (o: Outcome) => {
    if (!current) return;
    setEvents((prev) => [
      ...prev,
      { card_key: current.key, item_type: current.item_type, item_ref: current.item_ref, outcome: o },
    ]);
    setIdx((i) => i + 1);
  };

  if (deckQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Getting your cards…
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-2xl font-display text-primary">All caught up</h2>
          <p className="mt-2 text-muted-foreground">Nothing due right now.</p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-6 rounded-full bg-primary text-primary-foreground px-6 py-3"
          >
            Home
          </button>
        </div>
      </div>
    );
  }

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
          <div className="text-xs text-muted-foreground">{Math.min(idx + 1, cards.length)} / {cards.length}</div>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-8">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(Math.min(idx, cards.length) / cards.length) * 100}%` }}
          />
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-6 py-10">
            <h2 className="text-3xl font-display text-primary">Deck complete</h2>
            <button
              onClick={() => saveMut.mutate(events)}
              disabled={saveMut.isPending}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium disabled:opacity-50"
            >
              {saveMut.isPending ? "Saving…" : "Save results"}
            </button>
          </div>
        ) : (
          <>
            <ItemCard card={current!} />
            <div className="mt-10">
              <OutcomeButtons onOutcome={onOutcome} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
