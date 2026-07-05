import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listBenchmarks, saveBenchmark, getPhonicsMap } from "@/lib/dashboard.functions";
import { regenerateContent } from "@/lib/content.functions";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/parent/benchmark/$learnerId")({
  ssr: false,
  component: BenchmarkPage,
});

const LETTER_SOUNDS = ["i", "j", "o", "e", "a", "u", "y", "g", "w", "z", "th"];

function BenchmarkPage() {
  const { learnerId } = Route.useParams();
  const qc = useQueryClient();
  const listFn = useServerFn(listBenchmarks);
  const saveFn = useServerFn(saveBenchmark);
  const mapFn = useServerFn(getPhonicsMap);
  const regenFn = useServerFn(regenerateContent);

  const listQ = useQuery({ queryKey: ["benchmarks", learnerId], queryFn: () => listFn({ data: { learner_id: learnerId } }) });
  const mapQ = useQuery({ queryKey: ["phonics-map", learnerId], queryFn: () => mapFn({ data: { learner_id: learnerId } }) });

  const [letterCorrect, setLetterCorrect] = useState<Record<string, boolean>>({});
  const [realWordsCorrect, setRealWordsCorrect] = useState(0);
  const [realWordsTotal, setRealWordsTotal] = useState(6);
  const [pseudoCorrect, setPseudoCorrect] = useState(0);
  const [pseudoTotal, setPseudoTotal] = useState(6);
  const [passageAcc, setPassageAcc] = useState(0);
  const [notes, setNotes] = useState("");

  const [pseudoWords, setPseudoWords] = useState<string[]>([]);
  const [realWords, setRealWords] = useState<string[]>([]);

  const regen = useMutation({
    mutationFn: (type: "pseudowords" | "word_list") => regenFn({ data: { learner_id: learnerId, type } }),
    onSuccess: (r, type) => {
      const words = (r as any)?.words ?? [];
      if (type === "pseudowords") setPseudoWords(words);
      else setRealWords(words);
      toast.success("Fresh words ready");
    },
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          learner_id: learnerId,
          scores: {
            letter_sounds: LETTER_SOUNDS.map((l) => ({ letter: l, correct: !!letterCorrect[l] })),
            letter_sounds_correct: LETTER_SOUNDS.filter((l) => letterCorrect[l]).length,
            letter_sounds_total: LETTER_SOUNDS.length,
            real_words: { correct: realWordsCorrect, total: realWordsTotal },
            pseudowords: { correct: pseudoCorrect, total: pseudoTotal },
            passage_accuracy_pct: passageAcc,
          },
          notes,
        },
      }),
    onSuccess: () => {
      toast.success("Benchmark saved");
      setLetterCorrect({});
      setRealWordsCorrect(0);
      setPseudoCorrect(0);
      setPassageAcc(0);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["benchmarks", learnerId] });
    },
  });

  const trend = useMemo(() => {
    return (listQ.data ?? [])
      .slice()
      .reverse()
      .map((b: any) => {
        const s = b.scores_json || {};
        const total = (s.letter_sounds_total ?? 0) + (s.real_words?.total ?? 0) + (s.pseudowords?.total ?? 0);
        const correct = (s.letter_sounds_correct ?? 0) + (s.real_words?.correct ?? 0) + (s.pseudowords?.correct ?? 0);
        return {
          date: new Date(b.date).toLocaleDateString(),
          accuracy: total ? Math.round((correct / total) * 100) : 0,
          passage: s.passage_accuracy_pct ?? 0,
        };
      });
  }, [listQ.data]);

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-3xl border border-border/60 p-6">
        <h2 className="text-lg font-display text-primary mb-2">Run a Word Challenge</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Ask the learner each item and tick what they read correctly. Interpret against their prior self.
        </p>

        <Section title="1 · Letter-sound check (Swedish trap letters included)">
          <div className="grid grid-cols-6 md:grid-cols-11 gap-2">
            {LETTER_SOUNDS.map((l) => (
              <button
                key={l}
                onClick={() => setLetterCorrect((s) => ({ ...s, [l]: !s[l] }))}
                className={`rounded-2xl py-3 font-display text-lg ${letterCorrect[l] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </Section>

        <Section title="2 · Real-word list">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => regen.mutate("word_list")}
              disabled={regen.isPending}
              className="rounded-full border border-input px-3 py-1.5 text-xs hover:bg-secondary"
            >
              Fresh words
            </button>
            <span className="text-xs text-muted-foreground">
              {realWords.length ? realWords.join(" · ") : "Use your own list, or click Fresh words."}
            </span>
          </div>
          <Counter label="Correct" value={realWordsCorrect} setValue={setRealWordsCorrect} max={realWordsTotal} />
          <Counter label="Total" value={realWordsTotal} setValue={setRealWordsTotal} max={20} />
        </Section>

        <Section title="3 · Pseudoword list (true decoding)">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => regen.mutate("pseudowords")}
              disabled={regen.isPending}
              className="rounded-full border border-input px-3 py-1.5 text-xs hover:bg-secondary"
            >
              Fresh pseudowords
            </button>
            <span className="text-xs text-muted-foreground">
              {pseudoWords.length ? pseudoWords.join(" · ") : "Click Fresh pseudowords."}
            </span>
          </div>
          <Counter label="Correct" value={pseudoCorrect} setValue={setPseudoCorrect} max={pseudoTotal} />
          <Counter label="Total" value={pseudoTotal} setValue={setPseudoTotal} max={20} />
        </Section>

        <Section title="4 · Short decodable passage (accuracy %)">
          <input
            type="range"
            min={0}
            max={100}
            value={passageAcc}
            onChange={(e) => setPassageAcc(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm text-muted-foreground mt-1">{passageAcc}%</div>
        </Section>

        <Section title="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-input bg-background p-3"
          />
        </Section>

        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="mt-4 rounded-full bg-primary text-primary-foreground px-6 py-3 font-medium disabled:opacity-50"
        >
          {saveMut.isPending ? "Saving…" : "Save benchmark"}
        </button>
      </div>

      <div className="bg-card rounded-3xl border border-border/60 p-6">
        <h2 className="text-lg font-display text-primary mb-3">Trend</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No benchmarks yet.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--chart-1))" strokeWidth={2} name="Overall %" />
                <Line type="monotone" dataKey="passage" stroke="hsl(var(--chart-3))" strokeWidth={2} name="Passage %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Progress is criterion-referenced — comparing this learner to their own prior self, not to any external norm.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Counter({ label, value, setValue, max }: { label: string; value: number; setValue: (n: number) => void; max: number }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-xs text-muted-foreground w-16">{label}</span>
      <button
        onClick={() => setValue(Math.max(0, value - 1))}
        className="w-8 h-8 rounded-full border border-input hover:bg-secondary"
      >
        −
      </button>
      <span className="w-8 text-center font-display">{value}</span>
      <button
        onClick={() => setValue(Math.min(max, value + 1))}
        className="w-8 h-8 rounded-full border border-input hover:bg-secondary"
      >
        +
      </button>
    </div>
  );
}
