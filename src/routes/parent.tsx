import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getParentSettings, setDyslexiaFont } from "@/lib/parent.functions";
import { listLearners } from "@/lib/learners.functions";
import { ChevronLeft, Users, Map, AlertTriangle, LineChart, Award, Type } from "lucide-react";
import { cn } from "@/lib/utils";

const UNLOCK_KEY = "rg-parent-unlocked";

export const Route = createFileRoute("/parent")({
  ssr: false,
  component: ParentLayout,
});

function ParentLayout() {
  const navigate = useNavigate();
  const getSettings = useServerFn(getParentSettings);
  const setPinCall = useServerFn(setPinFn);
  const verifyPinCall = useServerFn(verifyPin);
  const setFont = useServerFn(setDyslexiaFont);
  const listLearnersFn = useServerFn(listLearners);

  const settingsQ = useQuery({ queryKey: ["parent-settings"], queryFn: () => getSettings() });
  const learnersQ = useQuery({ queryKey: ["learners"], queryFn: () => listLearnersFn() });

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true);
  }, []);

  const settings = settingsQ.data;
  const hasPin = settings?.has_pin;

  const submitPin = async () => {
    if (!/^\d{4}$/.test(pin)) return;
    setBusy(true);
    try {
      if (!hasPin) {
        await setPinCall({ data: { pin } });
        toast.success("PIN set");
        sessionStorage.setItem(UNLOCK_KEY, "1");
        setUnlocked(true);
      } else {
        const r = await verifyPinCall({ data: { pin } });
        if (r.ok) {
          sessionStorage.setItem(UNLOCK_KEY, "1");
          setUnlocked(true);
        } else {
          toast.error("Incorrect PIN");
        }
      }
    } finally {
      setBusy(false);
      setPin("");
    }
  };

  const toggleFont = async () => {
    await setFont({ data: { enabled: !settings?.dyslexia_font } });
    settingsQ.refetch();
  };

  const learners = learnersQ.data ?? [];

  if (settingsQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">…</div>;
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-card rounded-3xl border border-border/60 p-8 text-center shadow-sm">
          <Lock className="w-8 h-8 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-display text-primary">Parent area</h1>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            {hasPin ? "Enter your 4-digit PIN" : "Choose a 4-digit PIN"}
          </p>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-full text-center text-3xl tracking-[0.6em] font-display bg-background border border-input rounded-xl py-4"
          />
          <button
            onClick={submitPin}
            disabled={busy || pin.length !== 4}
            className="mt-4 w-full rounded-full bg-primary text-primary-foreground py-3 font-medium disabled:opacity-50"
          >
            {hasPin ? "Unlock" : "Set PIN"}
          </button>
          <Link to="/" className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground">
            Back to garden
          </Link>
        </div>
      </div>
    );
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
            <button
              onClick={async () => {
                sessionStorage.removeItem(UNLOCK_KEY);
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
              className="rounded-full px-3 py-1.5 text-xs border border-input text-muted-foreground hover:bg-secondary"
            >
              <LogOut className="w-3.5 h-3.5 inline mr-1" /> Sign out
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
