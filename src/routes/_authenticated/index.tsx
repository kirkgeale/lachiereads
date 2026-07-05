import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listLearners, getLearnerSummary } from "@/lib/learners.functions";
import { getParentSettings, setActiveLearner as setActiveLearnerFn } from "@/lib/parent.functions";
import { Garden } from "@/components/Garden";
import { Settings, Sparkles, BookOpen, Zap, Flame } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  ssr: false,
  component: KidHome,
});

function KidHome() {
  const navigate = useNavigate();
  const listLearnersFn = useServerFn(listLearners);
  const getSummaryFn = useServerFn(getLearnerSummary);
  const getSettingsFn = useServerFn(getParentSettings);
  const setActiveFn = useServerFn(setActiveLearnerFn);

  const learnersQ = useQuery({ queryKey: ["learners"], queryFn: () => listLearnersFn() });
  const settingsQ = useQuery({ queryKey: ["parent-settings"], queryFn: () => getSettingsFn() });

  const learners = learnersQ.data ?? [];
  const activeId = settingsQ.data?.active_learner_id ?? learners[0]?.id ?? null;

  const summaryQ = useQuery({
    queryKey: ["learner-summary", activeId],
    queryFn: () => getSummaryFn({ data: { learner_id: activeId! } }),
    enabled: !!activeId,
  });

  const [dyslexicClass, setDyslexicClass] = useState("");
  useEffect(() => {
    setDyslexicClass(settingsQ.data?.dyslexia_font ? "font-dyslexic" : "");
  }, [settingsQ.data?.dyslexia_font]);

  // No learners yet — send to parent setup
  if (learnersQ.isSuccess && learners.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center bg-card rounded-3xl p-10 border border-border/60 shadow-sm">
          <Sparkles className="w-12 h-12 mx-auto text-primary mb-4" />
          <h1 className="text-3xl font-display text-primary">Welcome</h1>
          <p className="mt-3 text-muted-foreground">
            First, add a learner. You can add more than one child.
          </p>
          <Link
            to="/parent/learners"
            className="inline-block mt-6 rounded-full bg-primary text-primary-foreground px-6 py-3 font-medium"
          >
            Add a learner
          </Link>
          <button
            onClick={() => supabase.auth.signOut()}
            className="block mx-auto mt-4 text-sm text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const learner = summaryQ.data?.learner;
  const rewards = summaryQ.data?.rewards;
  const secure = summaryQ.data?.secureGpcs ?? [];
  const dueCount = summaryQ.data?.due_count ?? 0;

  return (
    <div className={`min-h-screen p-4 md:p-8 ${dyslexicClass}`}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Reading Garden</div>
            <h1 className="text-2xl md:text-3xl font-display text-primary">
              Hello{learner ? `, ${learner.name}` : ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {learners.length > 1 && (
              <select
                value={activeId ?? ""}
                onChange={async (e) => {
                  await setActiveFn({ data: { learner_id: e.target.value } });
                  settingsQ.refetch();
                }}
                className="rounded-full border border-input bg-card px-4 py-2 text-sm"
              >
                {learners.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => navigate({ to: "/parent" })}
              aria-label="Parent"
              className="rounded-full p-3 bg-secondary text-secondary-foreground hover:bg-secondary/70"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card rounded-2xl border border-border/60 p-4 flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-accent" />
            <div>
              <div className="text-2xl font-display text-primary">{rewards?.stars ?? 0}</div>
              <div className="text-xs text-muted-foreground">stars</div>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border/60 p-4 flex items-center gap-3">
            <Flame className="w-5 h-5 text-accent" />
            <div>
              <div className="text-2xl font-display text-primary">{rewards?.current_streak_days ?? 0}</div>
              <div className="text-xs text-muted-foreground">day streak</div>
            </div>
          </div>
          <div className="bg-card rounded-2xl border border-border/60 p-4 flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-accent" />
            <div>
              <div className="text-2xl font-display text-primary">{secure.length}</div>
              <div className="text-xs text-muted-foreground">sounds grown</div>
            </div>
          </div>
        </div>

        {/* Garden */}
        {learner && <Garden secure={secure} theme={learner.garden_theme} />}

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <button
            onClick={() => activeId && navigate({ to: "/session/$learnerId", params: { learnerId: activeId } })}
            disabled={!activeId}
            className="rounded-3xl bg-primary text-primary-foreground p-8 flex items-center justify-between hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <div className="text-left">
              <div className="text-xl font-display">Start reading</div>
              <div className="text-sm opacity-80">A guided session</div>
            </div>
            <BookOpen className="w-8 h-8" />
          </button>
          <button
            onClick={() => activeId && navigate({ to: "/flashcards/$learnerId", params: { learnerId: activeId } })}
            disabled={!activeId || dueCount === 0}
            className="rounded-3xl bg-accent text-accent-foreground p-8 flex items-center justify-between hover:bg-accent/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <div className="text-left">
              <div className="text-xl font-display">Flashcards</div>
              <div className="text-sm opacity-80">
                {dueCount > 0 ? `${dueCount} due today` : "Nothing due — well done"}
              </div>
            </div>
            <Zap className="w-8 h-8" />
          </button>
        </div>
      </div>
    </div>
  );
}
