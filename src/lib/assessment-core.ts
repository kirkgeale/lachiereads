export interface AssessmentProbe {
  id: string;
  kind: string;
  prompt: string;
  target_grapheme?: string;
  target_heart_word?: string;
  difficulty: number;
  notes?: string;
}

export type AssessmentOutcome = "correct" | "self_corrected" | "prompted" | "missed" | "skipped" | "hesitated";

export interface AssessmentProbeResult extends AssessmentProbe {
  outcome: AssessmentOutcome;
}

export interface AssessmentLearnerContext {
  name: string;
  age_years: number | null;
  garden_theme?: string;
  known_graphemes: string[];
  secure_graphemes: string[];
  known_heart_words: string[];
  interference_pairs: { grapheme: string; swedish_value: string; english_value: string }[];
  all_graphemes: { grapheme: string; sound_label: string; phase: number; example_word: string; order_index?: number }[];
  all_heart_words: string[];
}

export interface AssessmentReportJson {
  estimated_level: string;
  plain_summary: string;
  what_they_can_do: string[];
  working_on: string[];
  not_yet: string[];
  parent_actions_this_week: string[];
  next_focus: string;
  gpc_updates: { grapheme: string; status: string }[];
  heart_word_updates: { word: string; status: string }[];
  actual_next_target?: { grapheme: string; sound_label: string; example_word: string };
}

export interface PreviousAssessmentContext {
  estimated_level: string | null;
  summary: string | null;
  previously_working_on: string[];
  previously_not_yet: string[];
  days_since: number;
}

export function ageYears(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  return Math.floor((Date.now() - b.getTime()) / (365.25 * 86400000));
}

export async function loadAssessmentContext(supabase: any, learner_id: string) {
  const [learnerRes, gpcsRes, gpcStatusRes, heartWordsRes, hwStatusRes, interferenceRes] = await Promise.all([
    supabase.from("learners").select("name, birthdate, garden_theme").eq("id", learner_id).single(),
    supabase.from("gpcs").select("id, grapheme, sound_label, phase, example_word, order_index").order("order_index"),
    supabase.from("learner_gpc_status").select("gpc_id, status").eq("learner_id", learner_id),
    supabase.from("heart_words").select("id, word, order_index").order("order_index"),
    supabase.from("learner_heart_word_status").select("heart_word_id, status").eq("learner_id", learner_id),
    supabase.from("interference_items").select("grapheme, swedish_value, english_value"),
  ]);

  if (learnerRes.error || !learnerRes.data) throw new Error(learnerRes.error?.message ?? "Learner not found.");
  if (gpcsRes.error) throw new Error(gpcsRes.error.message);
  if (gpcStatusRes.error) throw new Error(gpcStatusRes.error.message);
  if (heartWordsRes.error) throw new Error(heartWordsRes.error.message);
  if (hwStatusRes.error) throw new Error(hwStatusRes.error.message);
  if (interferenceRes.error) throw new Error(interferenceRes.error.message);

  const gpcs = gpcsRes.data ?? [];
  const heartWords = heartWordsRes.data ?? [];
  const statusById = new Map<string, string>((gpcStatusRes.data ?? []).map((r: any) => [r.gpc_id, r.status]));
  const hwStatusById = new Map<string, string>((hwStatusRes.data ?? []).map((r: any) => [r.heart_word_id, r.status]));
  const known_graphemes = gpcs.filter((g: any) => (statusById.get(g.id) ?? "not_started") !== "not_started").map((g: any) => g.grapheme);
  const secure_graphemes = gpcs.filter((g: any) => statusById.get(g.id) === "secure").map((g: any) => g.grapheme);
  const known_heart_words = heartWords
    .filter((h: any) => (hwStatusById.get(h.id) ?? "not_started") !== "not_started")
    .map((h: any) => h.word);

  return {
    learner_ctx: {
      name: learnerRes.data.name ?? "Learner",
      age_years: ageYears(learnerRes.data.birthdate ?? null),
      garden_theme: learnerRes.data.garden_theme,
      known_graphemes,
      secure_graphemes,
      known_heart_words,
      interference_pairs: interferenceRes.data ?? [],
      all_graphemes: gpcs.map((g: any) => ({
        grapheme: g.grapheme,
        sound_label: g.sound_label,
        phase: g.phase,
        example_word: g.example_word,
        order_index: g.order_index,
      })),
      all_heart_words: heartWords.map((h: any) => h.word),
    } satisfies AssessmentLearnerContext,
    gpcs,
    heartWords,
  };
}

export async function loadPreviousAssessment(
  supabase: any,
  learner_id: string,
  exclude_id?: string,
): Promise<PreviousAssessmentContext | null> {
  let q = supabase
    .from("assessment_reports")
    .select("id, created_at, estimated_level, summary, report_json")
    .eq("learner_id", learner_id)
    .eq("applied", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (exclude_id) q = q.neq("id", exclude_id);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const rj = (data as any).report_json ?? {};
  return {
    estimated_level: (data as any).estimated_level ?? null,
    summary: (data as any).summary ?? null,
    previously_working_on: Array.isArray(rj.working_on) ? rj.working_on : Array.isArray(rj.focus_areas) ? rj.focus_areas : [],
    previously_not_yet: Array.isArray(rj.not_yet) ? rj.not_yet : [],
    days_since: Math.max(0, Math.floor((Date.now() - new Date((data as any).created_at).getTime()) / 86400000)),
  };
}

function uniqueGraphemes(items: AssessmentLearnerContext["all_graphemes"]) {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .filter((g) => {
      const key = g.grapheme.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildAssessmentProbes(learner: AssessmentLearnerContext): AssessmentProbe[] {
  const catalog = uniqueGraphemes(learner.all_graphemes ?? []);
  const usedTargets = new Set<string>();
  const probes: AssessmentProbe[] = [];
  const add = (probe: Omit<AssessmentProbe, "id">, targetKey?: string) => {
    const key = targetKey ?? probe.target_grapheme ?? probe.target_heart_word;
    if (key && usedTargets.has(key.toLowerCase())) return;
    if (key) usedTargets.add(key.toLowerCase());
    probes.push({ ...probe, id: `p${probes.length + 1}` });
  };
  const byPhase = (min: number, max: number) => catalog.filter((g) => g.phase >= min && g.phase <= max);
  const singleLetters = byPhase(1, 2).filter((g) => /^[a-z]$/i.test(g.grapheme));
  const early = byPhase(1, 2);
  const phaseThree = byPhase(3, 3);
  const later = byPhase(4, 9);

  for (const g of singleLetters.slice(0, 6)) {
    add({
      kind: "grapheme_sound",
      prompt: g.grapheme,
      target_grapheme: g.grapheme,
      difficulty: 1,
      notes: `listen for ${g.sound_label}`,
    });
  }

  for (const g of early) {
    if (probes.filter((p) => p.kind === "cvc_word").length >= 5) break;
    add({
      kind: "cvc_word",
      prompt: g.example_word,
      target_grapheme: g.grapheme,
      difficulty: 2,
      notes: `listen for ${g.sound_label} in '${g.example_word}'`,
    });
  }

  for (const g of phaseThree) {
    if (probes.filter((p) => p.difficulty === 3).length >= 7) break;
    add({
      kind: g.grapheme.length > 1 ? "digraph_word" : "grapheme_sound",
      prompt: g.example_word,
      target_grapheme: g.grapheme,
      difficulty: 3,
      notes: `listen for ${g.sound_label} in '${g.example_word}'`,
    });
  }

  for (const g of later) {
    if (probes.filter((p) => p.difficulty >= 4 && p.kind !== "heart_word").length >= 7) break;
    add({
      kind: g.grapheme.includes("_") ? "vcv_word" : "digraph_word",
      prompt: g.example_word,
      target_grapheme: g.grapheme,
      difficulty: g.phase >= 5 ? 5 : 4,
      notes: `listen for ${g.sound_label} in '${g.example_word}'`,
    });
  }

  for (const word of (learner.all_heart_words ?? []).slice(0, 4)) {
    add({ kind: "heart_word", prompt: word, target_heart_word: word, difficulty: 2, notes: "word recognition" }, `heart:${word}`);
  }

  const pseudoSeeds = catalog.filter((g) => !usedTargets.has(g.grapheme.toLowerCase())).slice(0, 3);
  for (const g of pseudoSeeds) {
    const prompt = g.grapheme.length === 1 ? `${g.grapheme}ap` : `${g.grapheme}ip`;
    add({
      kind: "pseudoword",
      prompt,
      target_grapheme: g.grapheme,
      difficulty: Math.min(5, Math.max(3, g.phase)),
      notes: `made-up word; listen for ${g.sound_label}`,
    });
  }

  const sentenceWord = early.find((g) => g.example_word)?.example_word ?? catalog[0]?.example_word ?? "it";
  const secondWord = phaseThree.find((g) => g.example_word)?.example_word ?? later.find((g) => g.example_word)?.example_word ?? sentenceWord;
  add({ kind: "sentence", prompt: `I can see ${sentenceWord}.`, difficulty: 3, notes: "listen for smooth word-by-word reading" });
  add({ kind: "sentence", prompt: `The ${secondWord} is here.`, difficulty: 4, notes: "listen for independence and fluency" });

  for (const g of catalog) {
    if (probes.length >= 24) break;
    add({
      kind: g.phase <= 2 ? "cvc_word" : "digraph_word",
      prompt: g.example_word || g.grapheme,
      target_grapheme: g.grapheme,
      difficulty: Math.min(5, Math.max(1, g.phase)),
      notes: `listen for ${g.sound_label}`,
    });
  }

  return probes.slice(0, 32);
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

function asStatus(value: unknown): "not_started" | "learning" | "practising" | "secure" {
  return value === "not_started" || value === "learning" || value === "practising" || value === "secure" ? value : "learning";
}

function uniqueExamples(items: AssessmentProbeResult[], limit = 4) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = cleanString(item.target_grapheme || item.target_heart_word || item.prompt);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatNextFocus(target: { grapheme: string; sound_label?: string | null; example_word?: string | null }) {
  const example = target.example_word ? ` as in '${target.example_word}'` : "";
  const sound = target.sound_label ? ` (${target.sound_label})` : "";
  return `Next time, the app will focus on '${target.grapheme}'${sound}${example}. Keep it short and calm: say the sound together, read two or three tiny words with it, then stop while it still feels easy.`;
}

export function buildFallbackReport(
  learner: Pick<AssessmentLearnerContext, "name"> | null | undefined,
  results: AssessmentProbeResult[],
  previous?: PreviousAssessmentContext | null,
): AssessmentReportJson {
  const name = learner?.name || "Your child";
  const correctish = new Set<AssessmentOutcome>(["correct", "self_corrected"]);
  const helped = new Set<AssessmentOutcome>(["prompted", "hesitated"]);
  const independent = results.filter((r) => correctish.has(r.outcome));
  const supported = results.filter((r) => helped.has(r.outcome));
  const missed = results.filter((r) => r.outcome === "missed" || r.outcome === "skipped");
  const strengths = uniqueExamples(independent, 6);
  const practice = uniqueExamples([...supported, ...missed], 6);
  const firstSentence = `${name} read ${independent.length} of ${results.length} items independently or with a self-correction in this check-in.`;
  const comparison = previous
    ? practice[0]
      ? `Since last time, the clearest specific change is that '${practice[0]}' is now the next practice point from today's check-in.`
      : strengths[0]
        ? `Since last time, '${strengths[0]}' looked more settled in today's check-in.`
        : "Since last time, there was no single clear change to claim from today's evidence."
    : "This is our first proper check-in, so there's nothing yet to compare it to.";

  return {
    estimated_level: "Assessment completed",
    plain_summary: `${firstSentence} This is what we saw today — a useful snapshot from one sitting, not a fixed verdict. ${comparison}`,
    what_they_can_do: strengths.length
      ? strengths.map((s) => `Read '${s}' independently or fixed it without help.`)
      : ["Stayed with the reading check-in and gave the items a try."],
    working_on: practice.length
      ? practice.slice(0, 5).map((s) => `Keep practising '${s}' so it becomes easier and more automatic.`)
      : ["Keep building smooth, confident reading with short daily practice."],
    not_yet: missed.length
      ? uniqueExamples(missed, 3).map((s) => `We have not made '${s}' easy yet; it can come later in practice.`)
      : ["Harder letter patterns can wait until the current reading feels smooth."],
    parent_actions_this_week: [
      "Read together for 5 minutes each day using very short words and sentences.",
      "Praise quick self-corrections and calm trying, not just first-time accuracy.",
      "Stop while it still feels easy so reading practice stays positive.",
    ],
    next_focus: "The next practice session will choose the exact next letter or letter-team to work on.",
    gpc_updates: results
      .filter((r) => r.target_grapheme)
      .map((r) => ({
        grapheme: r.target_grapheme!,
        status: correctish.has(r.outcome) ? "secure" : helped.has(r.outcome) ? "practising" : "learning",
      })),
    heart_word_updates: results
      .filter((r) => r.target_heart_word)
      .map((r) => ({
        word: r.target_heart_word!,
        status: correctish.has(r.outcome) ? "secure" : helped.has(r.outcome) ? "practising" : "learning",
      })),
  };
}

export function normalizeAssessmentReport(raw: any, fallback?: AssessmentReportJson): AssessmentReportJson {
  const base = fallback ?? buildFallbackReport(null, []);
  const whatTheyCanDo = cleanList(raw?.what_they_can_do ?? raw?.strengths);
  const workingOn = cleanList(raw?.working_on ?? raw?.focus_areas);
  const notYet = cleanList(raw?.not_yet);
  const actions = cleanList(raw?.parent_actions_this_week ?? raw?.next_steps);
  const gpcUpdates = Array.isArray(raw?.gpc_updates)
    ? raw.gpc_updates
        .map((u: any) => ({ grapheme: cleanString(u?.grapheme), status: asStatus(u?.status) }))
        .filter((u: any) => u.grapheme)
    : base.gpc_updates;
  const heartWordUpdates = Array.isArray(raw?.heart_word_updates)
    ? raw.heart_word_updates
        .map((u: any) => ({ word: cleanString(u?.word), status: asStatus(u?.status) }))
        .filter((u: any) => u.word)
    : base.heart_word_updates;

  return {
    ...base,
    ...raw,
    estimated_level: cleanString(raw?.estimated_level) || base.estimated_level,
    plain_summary: cleanString(raw?.plain_summary ?? raw?.summary) || base.plain_summary,
    what_they_can_do: whatTheyCanDo.length ? whatTheyCanDo : base.what_they_can_do,
    working_on: workingOn.length ? workingOn : base.working_on,
    not_yet: notYet.length ? notYet : base.not_yet,
    parent_actions_this_week: actions.length ? actions : base.parent_actions_this_week,
    next_focus: cleanString(raw?.next_focus) || base.next_focus,
    gpc_updates: gpcUpdates,
    heart_word_updates: heartWordUpdates,
  };
}