import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created — you're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err: any) {
      toast.error(err?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-display text-primary">Reading Garden</h1>
          <p className="mt-2 text-muted-foreground">Sign in as a parent to open the garden</p>
        </div>
        <form onSubmit={submit} className="bg-card rounded-3xl border border-border/60 p-8 shadow-sm space-y-4">
          <div className="flex gap-2 mb-2 p-1 bg-muted rounded-full">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-full text-sm font-medium ${mode === "signin" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-full text-sm font-medium ${mode === "signup" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            >
              Create account
            </button>
          </div>
          <label className="block">
            <span className="text-sm text-muted-foreground">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base"
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-sm text-muted-foreground">Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary py-3.5 text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          <p className="text-xs text-center text-muted-foreground">
            A private family app. Your data stays with you.
          </p>
          <Link to="/" className="block text-center text-sm text-muted-foreground hover:text-foreground">
            Back home
          </Link>
        </form>
      </div>
    </div>
  );
}
