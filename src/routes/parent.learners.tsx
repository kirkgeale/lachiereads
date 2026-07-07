import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listLearners, createLearner, deleteLearner, updateLearner } from "@/lib/learners.functions";
import { setActiveLearner } from "@/lib/parent.functions";
import { toast } from "sonner";
import { Trash2, Check } from "lucide-react";

export const Route = createFileRoute("/parent/learners")({
  ssr: false,
  component: LearnersPage,
});

const THEMES = ["meadow", "forest", "coast"] as const;

function LearnersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLearners);
  const createFn = useServerFn(createLearner);
  const delFn = useServerFn(deleteLearner);
  const updateFn = useServerFn(updateLearner);
  const setActive = useServerFn(setActiveLearner);

  const listQ = useQuery({ queryKey: ["learners"], queryFn: () => listFn() });

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("meadow");
  const [interests, setInterests] = useState("");

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { name, birthdate: birthdate || null, garden_theme: theme, interests: interests || null } }),
    onSuccess: () => {
      setName("");
      setBirthdate("");
      setInterests("");
      toast.success("Learner added");
      qc.invalidateQueries({ queryKey: ["learners"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-3xl border border-border/60 p-6 shadow-sm">
        <h2 className="text-lg font-display text-primary mb-4">Add a learner</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-xl border border-input bg-background px-4 py-3"
          />
          <input
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            className="rounded-xl border border-input bg-background px-4 py-3"
          />
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Garden theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as any)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3"
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        <input
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="Interests (e.g. dinosaurs, football, space)"
          className="mt-3 w-full rounded-xl border border-input bg-background px-4 py-3"
        />
        <button
          onClick={() => name && createMut.mutate()}
          disabled={createMut.isPending || !name}
          className="mt-4 rounded-full bg-primary text-primary-foreground px-6 py-2.5 font-medium disabled:opacity-50"
        >
          {createMut.isPending ? "Adding…" : "Add learner"}
        </button>
      </div>

      <div className="space-y-3">
        {(listQ.data ?? []).map((l) => (
          <div key={l.id} className="bg-card rounded-2xl border border-border/60 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-lg font-display text-primary">{l.name}</div>
                <div className="text-xs text-muted-foreground">
                  {l.garden_theme} · {l.birthdate ?? "no birthdate"}
                </div>
              </div>
              <select
                value={l.garden_theme}
                onChange={async (e) => {
                  await updateFn({ data: { id: l.id, garden_theme: e.target.value } });
                  qc.invalidateQueries({ queryKey: ["learners"] });
                }}
                className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                {THEMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  await setActive({ data: { learner_id: l.id } });
                  toast.success(`${l.name} is active`);
                  qc.invalidateQueries({ queryKey: ["parent-settings"] });
                }}
                className="rounded-full bg-secondary text-secondary-foreground px-4 py-2 text-sm hover:bg-secondary/70"
              >
                <Check className="w-3.5 h-3.5 inline mr-1" /> Set active
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete ${l.name} and all their data?`)) return;
                  await delFn({ data: { id: l.id } });
                  qc.invalidateQueries({ queryKey: ["learners"] });
                }}
                className="rounded-full text-destructive hover:bg-destructive/10 p-2"
                aria-label="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <InterestsField
              learnerId={l.id}
              value={(l as any).interests ?? ""}
              onSave={async (v) => {
                await updateFn({ data: { id: l.id, interests: v || null } });
                qc.invalidateQueries({ queryKey: ["learners"] });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function InterestsField({ learnerId, value, onSave }: { learnerId: string; value: string; onSave: (v: string) => Promise<void> | void }) {
  const [v, setV] = useState(value);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        key={learnerId}
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Interests (e.g. dinosaurs, football, space)"
        className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        onClick={async () => { setSaving(true); await onSave(v); setSaving(false); toast.success("Saved"); }}
        disabled={saving || v === value}
        className="rounded-full bg-secondary text-secondary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
