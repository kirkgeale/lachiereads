import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getParentSettings, setDyslexiaFont } from "@/lib/parent.functions";
import { listLearners } from "@/lib/learners.functions";
import { ChevronLeft, Users, Map, AlertTriangle, LineChart, Award, Type, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";



export const Route = createFileRoute("/parent")({
  ssr: false,
  component: ParentLayout,
});

function ParentLayout() {
  const navigate = useNavigate();
  const getSettings = useServerFn(getParentSettings);
  const setFont = useServerFn(setDyslexiaFont);
  const listLearnersFn = useServerFn(listLearners);

  const settingsQ = useQuery({ queryKey: ["parent-settings"], queryFn: () => getSettings() });
  const learnersQ = useQuery({ queryKey: ["learners"], queryFn: () => listLearnersFn() });

  const settings = settingsQ.data;

  const toggleFont = async () => {
    await setFont({ data: { enabled: !settings?.dyslexia_font } });
    settingsQ.refetch();
  };

  const learners = learnersQ.data ?? [];

  if (settingsQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">…</div>;
  }


  const currentPath = window.location.pathname;
  const activeLearner = settings?.active_learner_id ?? learners[0]?.id;

  const navItem = (to: string, label: string, Icon: any) => {
    const isActive = currentPath === to || currentPath.startsWith(to + "/");
    return (
      <Link
        to={to as any}
        className={cn(
          "flex items-center gap-3 rounded-full px-4 py-2 text-sm",
          isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
        )}
      >
        <Icon className="w-4 h-4" />
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur">
        <div className="max-w-6xl mx-auto p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate({ to: "/" })}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4" /> Garden
            </button>
            <div className="text-lg font-display text-primary">Parent dashboard</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleFont}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs border",
                settings?.dyslexia_font ? "bg-primary text-primary-foreground border-primary" : "border-input text-muted-foreground",
              )}
              title="Toggle dyslexia-friendly font"
            >
              <Type className="w-3.5 h-3.5 inline mr-1" /> Dyslexia font
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 md:p-6 grid md:grid-cols-[220px_1fr] gap-6">
        <nav className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible">
          {navItem("/parent", "Progress", LineChart)}
          {navItem("/parent/learners", "Learners", Users)}
          {activeLearner && (
            <>
              {navItem(`/parent/phonics/${activeLearner}`, "Phonics map", Map)}
              {navItem(`/parent/interference/${activeLearner}`, "Interference", AlertTriangle)}
              {navItem(`/parent/sessions/${activeLearner}`, "Sessions", LineChart)}
              {navItem(`/parent/benchmark/${activeLearner}`, "Benchmark", Award)}
              {navItem(`/parent/assessment/${activeLearner}`, "Assessment", ClipboardCheck)}
            </>
          )}
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
