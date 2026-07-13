import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { startMathSession, saveMathSession, getMathSummary, type MathCard, type MathPlan } from "@/lib/math.functions";
import { OutcomeButtons } from "@/components/OutcomeButtons";
import { NumberPad } from "@/components/math/NumberPad";
import { MathVisual } from "@/components/math/MathVisuals";
import { requireParentAuth } from "@/lib/auth-guard";
import type { Outcome } from "@/lib/types";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/session-math/$learnerId")({
  ssr: false,
  beforeLoad: async () => { await requireParentAuth(); },
  component: MathSessionScreen,
});

type QEvent = { card_key: string; item_type: "math_skill" | "math_fact"; item_ref: string; outcome: Outcome };

const STAGE_LABELS: Record<string, string> = {
  intro: "Today's focus",
  warmup: "Warm-up",
  target: "New skill",
  practice: "Practice",
  word_problem: "Story problem",
  game: "Quick game",
  wrapup: "Wrap-up",
};

function MathSessionScreen() {
  const { learnerId } = Route.useParams();
  const navigate = useNavigate();
  const start = useServerFn(startMathSession);
  const save = useServerFn(saveMathSession);
  const summaryFn = useServerFn(getMathSummary);

  const summaryQ = useQuery({
    queryKey: ["math-summary", learnerId],
    queryFn: () => summaryFn({ data: { learner_id: learnerId } }),
  });
  const calibrated = summaryQ.data?.calibrated ?? false;
  const ready = summaryQ.isSuccess;

  const planQ = useQuery({
    queryKey: ["math-plan", learnerId],
    queryFn: () => start({ data: { learner_id: learnerId } }),
    enabled: ready && calibrated,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [idx, setIdx] = useState(0);
  const [events, setEvents] = useState<QEvent[]>([]);
  const [notes, setNotes] = useState("");
  const startedAt = useRef(Date.now());

  const saveMut = useMutation({
    mutationFn: (p: { events: QEvent[]; notes: string; dur: number }) =>
      save({ data: {
        session_id: planQ.data!.session_id,
        learner_id: learnerId,
        events: p.events,
        duration_seconds: p.dur,
        parent_notes: p.notes || null,
      } }),
    onSuccess: (r: any) => {
      toast.success(`Session complete — ${r.stars_awarded} star${r.stars_awarded === 1 ? "" : "s"}!`);
      navigate({ to: "/" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const cards: MathCard[] = planQ.data?.cards ?? [];
  const current = cards[idx];

  const pushEvent = (o: Outcome) => {
    if (!current) return;
    // Determine skill_id for SRS collapse
    let skillId: string | null = null;
    let itemType: "math_skill" | "math_fact" = "math_skill";
    if (current.skill) { skillId = current.skill.id; itemType = "math_skill"; }
    if (current.fact) {
      // Use target/skill from most recent target card in the plan
      const targetCard = cards.find((c) => c.stage === "target" && c.skill);
      const attributedTo = targetCard?.skill?.id ?? cards.find((c) => c.stage === "warmup" && c.skill)?.skill?.id ?? null;
      if (attributedTo) { skillId = attributedTo; itemType = "math_fact"; }
    }
    if (!skillId) { setIdx((i) => Math.min(cards.length - 1, i + 1)); return; }
    setEvents((prev) => [...prev, { card_key: current.key, item_type: itemType, item_ref: skillId!, outcome: o }]);
    setIdx((i) => Math.min(cards.length - 1, i + 1));
  };

  const onFinish = () => {
    const dur = Math.round((Date.now() - startedAt.current) / 1000);
    saveMut.mutate({ events, notes, dur });
  };

  const stageBreak = useMemo(() => {
    if (!current) return null;
    const prev = idx > 0 ? cards[idx - 1] : null;
    if (!prev) return current.stage;
    return prev.stage !== current.stage ? current.stage : null;
  }, [idx, cards, current]);

  if (!ready) return <Center>Getting ready…</Center>;
  if (!calibrated) {
    const name = (summaryQ.data as any)?.name ?? "your child";
    return (
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-2xl mx-auto rounded-3xl bg-card border border-border/60 p-6 md:p-10 shadow-sm mt-8">
          <button onClick={() => navigate({ to: "/" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ChevronLeft className="w-4 h-4" /> Home
          </button>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">First things first</div>
          <h1 className="text-2xl md:text-3xl font-display text-primary mb-2">Let's find {name}'s maths starting point</h1>
          <p className="text-sm text-muted-foreground mb-6">Tell us what they already know so lessons pitch at the right level.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => navigate({ to: "/parent/math-assessment/$learnerId", params: { learnerId } })}
              className="rounded-2xl bg-primary text-primary-foreground p-5 text-left hover:bg-primary/90"
            >
              <div className="font-display text-lg">Full maths assessment</div>
              <div className="text-sm opacity-80">Parent-led adaptive probes — ~10 minutes.</div>
            </button>
            <button
              onClick={() => navigate({ to: "/parent/math-setup/$learnerId", params: { learnerId } })}
              className="rounded-2xl bg-accent text-accent-foreground p-5 text-left hover:bg-accent/90"
            >
              <div className="font-display text-lg">Quick maths set-up</div>
              <div className="text-sm opacity-80">Tick what they already know — 1 minute.</div>
            </button>
          </div>

        </div>
      </div>
    );
  }
  if (planQ.isLoading || !current) return <Center>Getting ready…</Center>;
  if (planQ.isError) return <Center>Couldn't start the session. <br />{String((planQ.error as any)?.message ?? "")}</Center>;

  const progress = cards.length ? Math.round(((idx + 1) / cards.length) * 100) : 0;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate({ to: "/" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> Home
          </button>
          <div className="text-xs text-muted-foreground">{idx + 1} / {cards.length}</div>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-8">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>

        {stageBreak && (
          <div className="text-center text-xs uppercase tracking-widest text-muted-foreground mb-4">
            {STAGE_LABELS[stageBreak]}
          </div>
        )}

        {current.stage === "wrapup" ? (
          <div className="flex flex-col items-center gap-6 py-8">
            <h2 className="text-3xl font-display text-primary">Beautiful work</h2>
            <p className="text-muted-foreground text-center max-w-md">Save this maths session? A quick note is optional.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What went well or what to try next time…"
              className="w-full max-w-md rounded-2xl border border-input bg-background p-4"
            />
            <button onClick={onFinish} disabled={saveMut.isPending}
              className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90 disabled:opacity-50">
              {saveMut.isPending ? "Saving…" : "Finish"}
            </button>
          </div>
        ) : current.stage === "intro" ? (
          <IntroCard card={current} onNext={() => setIdx((i) => Math.min(cards.length - 1, i + 1))} />
        ) : current.stage === "target" ? (
          <LessonCard card={current} onDone={pushEvent} />
        ) : current.fact ? (
          <FactCard card={current} onOutcome={pushEvent} />
        ) : current.skill ? (
          <SkillCard card={current} onOutcome={pushEvent} />
        ) : (
          <div className="text-center text-muted-foreground">…</div>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-center text-muted-foreground px-6">{children}</div>;
}

function IntroCard({ card, onNext }: { card: MathCard; onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Today's focus</div>
      <h2 className="text-3xl md:text-4xl font-display text-primary text-center">{card.meta?.title}</h2>
      {card.meta?.concept && <p className="text-lg text-center max-w-xl">{card.meta.concept}</p>}
      {card.meta?.parent_intro && (
        <div className="w-full max-w-xl rounded-2xl bg-accent/10 border border-accent/30 p-5">
          <div className="text-xs uppercase tracking-wider mb-2 text-accent">For the parent — read aloud</div>
          <p className="text-base">{card.meta.parent_intro}</p>
        </div>
      )}
      <button onClick={onNext} className="rounded-full bg-primary text-primary-foreground px-8 py-3.5 font-medium hover:bg-primary/90">
        Let's begin
      </button>
    </div>
  );
}

function LessonCard({ card, onDone }: { card: MathCard; onDone: (o: Outcome) => void }) {
  const visual = (card.meta?.visual ?? "none") as "ten_frame" | "number_line" | "dots" | "none";
  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6">
      <div className="text-xs uppercase tracking-widest text-accent">New skill · lesson</div>
      <div className="w-full rounded-[2rem] bg-card border border-border/60 shadow-sm px-6 py-8 text-center">
        <div className="font-display text-3xl text-primary mb-2">{card.skill?.name}</div>
        <div className="text-muted-foreground">{card.skill?.description}</div>
        {visual !== "none" && (
          <div className="mt-6 flex justify-center">
            <MathVisual kind={visual} n={card.skill?.max_value ?? 10} />
          </div>
        )}
      </div>
      {card.meta?.parent_intro && (
        <div className="w-full rounded-2xl bg-accent/10 border border-accent/30 p-5">
          <div className="text-xs uppercase tracking-widest text-accent mb-2">For the parent — read aloud</div>
          <p className="text-sm">{card.meta.parent_intro}</p>
          <ol className="mt-3 space-y-1 text-sm">
            <li><b>1. Show</b> — model the idea with the picture above.</li>
            <li><b>2. Together</b> — try one with your child, side by side.</li>
            <li><b>3. You try</b> — invite them to try one on their own.</li>
          </ol>
        </div>
      )}
      <div className="w-full">
        <div className="text-xs uppercase tracking-widest text-muted-foreground text-center mb-2">How did their try go?</div>
        <OutcomeButtons onOutcome={onDone} />
      </div>
    </div>
  );
}

// Fact card: self-graded (child types answer) OR parent-facilitated.
function FactCard({ card, onOutcome }: { card: MathCard; onOutcome: (o: Outcome) => void }) {
  const f = card.fact!;
  const [state, setState] = useState<"first" | "second" | "reveal" | "correct">("first");
  const [reveal, setReveal] = useState<string | null>(null);
  const opSym = f.op === "+" ? "+" : "−";

  if (!card.self_gradable) {
    // Parent-facilitated fact
    return (
      <div className="flex flex-col items-center gap-8">
        {card.word ? (
          <div className="max-w-lg text-center">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Story problem</div>
            <p className="text-2xl leading-snug">{card.word.text}</p>
          </div>
        ) : (
          <div className="font-display text-6xl md:text-7xl text-primary">
            {f.a} {opSym} {f.b} = <span className="text-muted-foreground">?</span>
          </div>
        )}
        <div className="text-xs uppercase tracking-widest text-muted-foreground">How did they do?</div>
        <OutcomeButtons onOutcome={onOutcome} />
      </div>
    );
  }

  const handle = (n: number) => {
    if (n === f.answer) {
      setState("correct");
      setTimeout(() => onOutcome(state === "first" ? "got_it" : "self_corrected"), 700);
    } else if (state === "first") {
      setState("second");
    } else {
      setReveal(String(f.answer));
      setState("reveal");
      setTimeout(() => onOutcome("missed"), 1600);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="font-display text-6xl md:text-7xl text-primary text-center">
        {f.a} {opSym} {f.b} = <span className={state === "correct" ? "text-accent" : "text-muted-foreground"}>{reveal ?? "?"}</span>
      </div>
      {state === "second" && (
        <div className="text-sm text-accent">Not quite — try once more.</div>
      )}
      {state === "reveal" && (
        <div className="text-base text-muted-foreground">The answer is <b className="text-primary">{f.answer}</b>. Great effort!</div>
      )}
      {state === "correct" && (
        <div className="text-base text-accent">Yes! Well done.</div>
      )}
      {(state === "first" || state === "second") && (
        <NumberPad onSubmit={handle} max={Math.max(20, f.answer + 5)} />
      )}
    </div>
  );
}

// Skill card (warm-up review of a non-fact skill, or a self-gradable review).
function SkillCard({ card, onOutcome }: { card: MathCard; onOutcome: (o: Outcome) => void }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Review</div>
      <div className="w-full max-w-lg rounded-[2rem] bg-card border border-border/60 shadow-sm px-6 py-10 text-center">
        <div className="font-display text-3xl text-primary mb-2">{card.skill?.name}</div>
        <div className="text-muted-foreground">{card.skill?.description}</div>
      </div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">How did they do?</div>
      <OutcomeButtons onOutcome={onOutcome} />
    </div>
  );
}
