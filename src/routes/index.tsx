import { createFileRoute, Link } from "@tanstack/react-router";
import { Sprout, Settings } from "lucide-react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Reading Garden
        </div>
        <h1 className="text-4xl font-display text-primary mb-8">Who's here?</h1>
        <div className="grid gap-4">
          <Link
            to="/learner"
            className="rounded-3xl bg-primary text-primary-foreground p-8 flex items-center justify-between hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            <div className="text-left">
              <div className="text-2xl font-display">Learner</div>
              <div className="text-sm opacity-80">Read and play</div>
            </div>
            <Sprout className="w-8 h-8" />
          </Link>
          <Link
            to="/parent"
            className="rounded-3xl bg-secondary text-secondary-foreground p-8 flex items-center justify-between hover:bg-secondary/80 active:scale-[0.98] transition-all"
          >
            <div className="text-left">
              <div className="text-2xl font-display">Parent</div>
              <div className="text-sm opacity-80">Dashboard and settings</div>
            </div>
            <Settings className="w-8 h-8" />
          </Link>
        </div>
      </div>
    </div>
  );
}
