import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { startSession, saveSessionEvents } from "@/lib/session.functions";
import { getLearnerSummary } from "@/lib/learners.functions";
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
  guided: "Try it together",
  write: "Now write it",
  blend: "Blend ladder",
  practice: "Word reading",
  challenge: "Your turn",
  sentence: "Sentence",
  story: "Mini story",
  interference: "Sound check",
  game: "Quick game",
  recap: "One more time",
  wrapup: "Wrap-up",
};

function SessionScreen() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const start = useServerFn(startSession);
  const save = useServerFn(saveSessionEvents);
  const getSummary = useServerFn(getLearnerSummary);

  const summaryQ = useQuery({
    queryKey: ["learner-summary", learnerId],
    queryFn: () => getSummary({ data: { learner_id: learnerId } }),
    staleTime: 30_000,
  });
  const calibrated = (summaryQ.data as any)?.calibrated ?? false;
  const summaryReady = summaryQ.isSuccess;

  const planQ = useQuery({
    queryKey: ["session-plan", learnerId],
    queryFn: () => start({ data: { learner_id: learnerId } }),
    enabled: summaryReady && calibrated,
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

  if (summaryQ.isLoading) {
    return <FullScreenLoader label="Getting ready…" />;
  }
  if (summaryReady && !calibrated) {
    const name = (summaryQ.data as any)?.learner?.name ?? "your child";
    return (
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-2xl mx-auto rounded-3xl bg-card border border-border/60 p-6 md:p-10 shadow-sm mt-8">
          <button
            onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ChevronLeft className="w-4 h-4" /> Home
          </button>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">First things first</div>
          <h1 className="text-2xl md:text-3xl font-display text-primary mb-2">
            Let's find {name}'s starting point
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Before the first real session, tell us what {name} already knows so lessons pitch at the right level.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => navigate({ to: "/parent/assessment/$learnerId", params: { learnerId } })}
              className="rounded-2xl bg-primary text-primary-foreground p-5 text-left hover:bg-primary/90"
            >
              <div className="font-display text-lg">Run the full reading assessment</div>
              <div className="text-sm opacity-80">AI-guided probes, ~10 minutes.</div>
            </button>
            <button
              onClick={() => navigate({ to: "/parent/quick-setup/$learnerId", params: { learnerId } })}
              className="rounded-2xl bg-accent text-accent-foreground p-5 text-left hover:bg-accent/90"
            >
              <div className="font-display text-lg">Quick set-up</div>
              <div className="text-sm opacity-80">Tick what they already know — 1 minute.</div>
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (planQ.isLoading || (!planQ.data && summaryReady && calibrated)) {
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
        ) : current.stage === "intro" ? (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Today's focus</div>
            <h2 className="text-3xl md:text-4xl font-display text-primary text-center">
              {current.display}
            </h2>
            {current.meta?.concept && (
              <p className="text-lg text-center max-w-xl">{String(current.meta.concept)}</p>
            )}
            {current.meta?.parent_intro && (
              <div className="w-full max-w-xl rounded-2xl bg-accent/10 border border-accent/30 p-5">
                <div className="text-xs uppercase tracking-wider mb-2 text-accent">For the parent — read aloud</div>
                <p className="text-base">{String(current.meta.parent_intro)}</p>
              </div>
            )}
            <button
              onClick={() => setIdx((i) => Math.min(cards.length - 1, i + 1))}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90"
            >
              Let's begin
            </button>
          </div>
        ) : current.stage === "target" ? (
          <LessonCard card={current} onOutcome={onOutcome} />
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

// A "lesson" — teaching a new sound. Different from a flashcard: it walks the
// parent through I-do / We-do / You-do with the target letter, shows multiple
// example words, and explicitly names the sound and mouth cue before asking
// for a recall attempt.
function LessonCard({ card, onOutcome }: { card: SessionCard; onOutcome: (o: Outcome) => void }) {
  const grapheme = card.display;
  const upper = grapheme.toUpperCase();
  const lower = grapheme.toLowerCase();
  const showPair = upper !== lower;
  const examples = Array.isArray(card.meta?.examples) ? (card.meta!.examples as string[]) : [];
  const concept = typeof card.meta?.concept === "string" ? card.meta!.concept : "";
  const parentIntro = typeof card.meta?.parent_intro === "string" ? card.meta!.parent_intro : "";
  const highlight = (word: string) => {
    const g = lower;
    const idx = word.toLowerCase().indexOf(g);
    if (idx < 0) return <>{word.toUpperCase()}</>;
    return (
      <>
        {word.slice(0, idx).toUpperCase()}
        <span className="text-primary underline decoration-primary/40 decoration-4 underline-offset-4">
          {word.slice(idx, idx + g.length).toUpperCase()}
        </span>
        {word.slice(idx + g.length).toUpperCase()}
      </>
    );
  };
  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6">
      <div className="w-full text-center">
        <div className="text-xs uppercase tracking-widest text-accent">New sound · lesson</div>
        <div className="mt-1 text-sm text-muted-foreground italic">
          Teach this together — model first, then read with them, then let them try.
        </div>
      </div>

      {/* The letter, big, with the sound named explicitly */}
      <div className="w-full flex flex-col items-center gap-2 rounded-[2rem] bg-card border border-border/60 shadow-sm px-6 py-10">
        <div className="font-display font-semibold text-primary leading-none text-8xl md:text-9xl">{upper}</div>
        {showPair && (
          <div className="text-3xl font-display text-muted-foreground/70 tracking-wide">{lower}</div>
        )}
        {card.sound_label && (
          <div className="mt-3 text-xl text-foreground/90">says <b className="text-primary">{card.sound_label}</b></div>
        )}
        {concept && <div className="mt-2 text-sm text-muted-foreground text-center max-w-md">{concept}</div>}
      </div>

      {/* I do → We do → You do teaching script */}
      <div className="w-full rounded-2xl bg-accent/10 border border-accent/30 px-5 py-4 space-y-3">
        <div className="text-xs uppercase tracking-widest text-accent font-medium">For the parent — read aloud</div>
        {parentIntro && <p className="text-sm text-foreground/90">{parentIntro}</p>}
        <ol className="space-y-2 text-sm">
          <li><b>1. I say.</b> Point to the letter. "This says <i>{card.sound_label}</i>." Model it clearly.</li>
          <li><b>2. We say.</b> "Let's say it together." Say the sound with them, twice.</li>
          <li><b>3. You say.</b> "Now your turn — what does this say?" Wait. Only prompt if truly stuck.</li>
        </ol>
      </div>

      {/* Example words with the target grapheme visibly highlighted */}
      {examples.length > 0 && (
        <div className="w-full rounded-2xl bg-card border border-border/60 px-5 py-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Read these together — the <b className="text-primary">{upper}</b> is the new bit
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {examples.map((w) => (
              <div key={w} className="font-display text-3xl md:text-4xl px-4 py-2 rounded-xl bg-muted/60">
                {highlight(w)}
              </div>
            ))}
          </div>
        </div>
      )}

      {card.interference && (
        <div className="w-full rounded-2xl bg-[hsl(200_40%_92%)] border border-[hsl(200_35%_78%)] px-5 py-4 text-[hsl(200_35%_25%)]">
          <div className="text-xs uppercase tracking-wider mb-1 opacity-70">Swedish heads-up</div>
          <div className="text-base">
            In Swedish this often says <b>{card.interference.swedish_value}</b> — in English it says{" "}
            <b>{card.interference.english_value}</b>.
          </div>
        </div>
      )}

      <div className="w-full">
        <div className="text-xs uppercase tracking-widest text-muted-foreground text-center mb-2">
          How did their try go?
        </div>
        <OutcomeButtons onOutcome={onOutcome} />
      </div>
    </div>
  );
}
