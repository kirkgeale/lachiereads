export type AssessmentStrand =
  | "letter_sounds"
  | "simple_words"
  | "letter_team_words"
  | "heart_words"
  | "pseudowords"
  | "sentences";

export interface AssessmentProbe {
  id: string;
  kind: string;
  strand: AssessmentStrand;
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

export type MasteryStatus = "not_started" | "learning" | "practising" | "secure";

export interface AssessmentGraphemeEntry {
  grapheme: string;
  sound_label: string;
  phase: number;
  example_word: string;
  assessment_word?: string | null;
  assessment_word_pool?: string[];
  order_index?: number;
  status: MasteryStatus;
}

export interface AssessmentHeartWordEntry {
  word: string;
  status: MasteryStatus;
}

export interface AssessmentLearnerContext {
  name: string;
  age_years: number | null;
  garden_theme?: string;
  known_graphemes: string[];
  secure_graphemes: string[];
  known_heart_words: string[];
  interference_pairs: { grapheme: string; swedish_value: string; english_value: string }[];
  all_graphemes: AssessmentGraphemeEntry[];
  all_heart_words: string[];
  heart_word_entries: AssessmentHeartWordEntry[];
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
    supabase.from("gpcs").select("id, grapheme, sound_label, phase, example_word, assessment_word, order_index").order("order_index"),
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
        assessment_word: g.assessment_word ?? null,
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

// Curated pseudoword bank. Every entry: (a) is NOT a real English word,
// (b) is orthographically legal for its target grapheme (ck word-final,
// qu word-initial+vowel, ng/nk word-final), (c) is decodable from common
// phase 1-2 letters plus the target grapheme.
interface PseudoEntry { word: string; target_grapheme: string; difficulty: number; }
const PSEUDOWORD_BANK: PseudoEntry[] = [
  // short-vowel CVCs (diff 2-3)
  { word: "vop", target_grapheme: "o", difficulty: 2 },
  { word: "zin", target_grapheme: "i", difficulty: 2 },
  { word: "mab", target_grapheme: "a", difficulty: 2 },
  { word: "dut", target_grapheme: "u", difficulty: 3 },
  { word: "heb", target_grapheme: "e", difficulty: 3 },
  { word: "fep", target_grapheme: "e", difficulty: 2 },
  { word: "gop", target_grapheme: "o", difficulty: 2 },
  { word: "nid", target_grapheme: "i", difficulty: 2 },
  { word: "tup", target_grapheme: "u", difficulty: 3 },
  { word: "pim", target_grapheme: "i", difficulty: 2 },
  // digraphs in legal positions (diff 3)
  { word: "shap", target_grapheme: "sh", difficulty: 3 },
  { word: "shen", target_grapheme: "sh", difficulty: 3 },
  { word: "thop", target_grapheme: "th", difficulty: 3 },
  { word: "thib", target_grapheme: "th", difficulty: 3 },
  { word: "chid", target_grapheme: "ch", difficulty: 3 },
  { word: "chab", target_grapheme: "ch", difficulty: 3 },
  // ck / ng / nk — word-final only
  { word: "dack", target_grapheme: "ck", difficulty: 3 },
  { word: "vock", target_grapheme: "ck", difficulty: 3 },
  { word: "zick", target_grapheme: "ck", difficulty: 3 },
  { word: "hing", target_grapheme: "ng", difficulty: 4 },
  { word: "vung", target_grapheme: "ng", difficulty: 4 },
  { word: "zonk", target_grapheme: "nk", difficulty: 4 },
  // digraph vowels (diff 4)
  { word: "fait", target_grapheme: "ai", difficulty: 4 },
  { word: "seep", target_grapheme: "ee", difficulty: 4 },
  { word: "voat", target_grapheme: "oa", difficulty: 4 },
  { word: "zoom-style-drop:", target_grapheme: "oo", difficulty: 4 },
  { word: "loot-drop:", target_grapheme: "oo", difficulty: 4 },
];
// Filter out any bank entries whose word is a real English word we happen
// to seed (defense-in-depth: keep the list clean).
const REAL_WORD_BLOCKLIST = new Set([
  "map","gap","ship","chip","chop","chin","shop","shed","chat","this","that",
  "sock","dock","pick","rick","tick","rock","dock","sing","song","ring","sung","sunk","zoom","loot","seat","boat","fair","fait",
]);

function pseudowordFor(target: string, difficulty: number): PseudoEntry | null {
  const candidates = PSEUDOWORD_BANK
    .filter((p) => p.target_grapheme === target)
    .filter((p) => !REAL_WORD_BLOCKLIST.has(p.word.toLowerCase()))
    .filter((p) => /^[a-z_]+$/.test(p.word));
  if (!candidates.length) return null;
  // prefer entry matching difficulty band
  const banded = candidates.find((p) => Math.abs(p.difficulty - difficulty) <= 1) ?? candidates[0];
  return banded;
}

export function buildAssessmentProbes(learner: AssessmentLearnerContext): AssessmentProbe[] {
  const catalog = uniqueGraphemes(learner.all_graphemes ?? []);
  const heartWordSet = new Set((learner.all_heart_words ?? []).map((w) => w.toLowerCase()));
  const exampleWordSet = new Set(catalog.map((g) => (g.example_word ?? "").toLowerCase()).filter(Boolean));

  let counter = 0;
  const make = (strand: AssessmentStrand, probe: Omit<AssessmentProbe, "id" | "strand">): AssessmentProbe => ({
    ...probe, strand, id: `p${++counter}`,
  });

  // Strand 1: letter-sounds — every single-letter grapheme in phases 1-2.
  const letterSounds: AssessmentProbe[] = [];
  const seenLetters = new Set<string>();
  for (const g of catalog) {
    if (g.phase > 2) continue;
    if (!/^[a-z]$/i.test(g.grapheme)) continue;
    if (seenLetters.has(g.grapheme)) continue;
    seenLetters.add(g.grapheme);
    letterSounds.push(make("letter_sounds", {
      kind: "grapheme_sound",
      prompt: g.grapheme,
      target_grapheme: g.grapheme,
      difficulty: 1,
      notes: `listen for ${g.sound_label}`,
    }));
  }

  // Strand 2: simple decodable words — phase 1-2 items, using assessment_word
  // (falls back to example_word only if we absolutely have to).
  const simpleWords: AssessmentProbe[] = [];
  const seenSimple = new Set<string>();
  for (const g of catalog) {
    if (g.phase > 2) continue;
    const word = (g.assessment_word || g.example_word || "").trim();
    if (!word || seenSimple.has(word.toLowerCase())) continue;
    seenSimple.add(word.toLowerCase());
    simpleWords.push(make("simple_words", {
      kind: "cvc_word",
      prompt: word,
      target_grapheme: g.grapheme,
      difficulty: 2,
      notes: `listen for ${g.sound_label} in '${word}'`,
    }));
  }

  // Strand 3: letter-team words — phase 3+. Spread across difficulty
  // bands (3, 4, 5) rather than sweeping every single grapheme.
  const laterCatalog = catalog.filter((g) => g.phase >= 3);
  const byBand: Record<number, typeof laterCatalog> = { 3: [], 4: [], 5: [] };
  for (const g of laterCatalog) {
    const band = Math.min(5, Math.max(3, g.phase >= 7 ? 4 : g.phase >= 5 ? 4 : 3));
    (byBand[band] ??= []).push(g);
  }
  // add tricky high-phase items to band 5
  for (const g of laterCatalog) {
    if (g.phase >= 8) byBand[5].push(g);
  }
  const letterTeamWords: AssessmentProbe[] = [];
  const seenTeam = new Set<string>();
  const takeFromBand = (band: number, n: number) => {
    for (const g of (byBand[band] ?? [])) {
      if (letterTeamWords.length >= 10) break;
      if (seenTeam.has(g.grapheme)) continue;
      const word = (g.assessment_word || g.example_word || "").trim();
      if (!word) continue;
      seenTeam.add(g.grapheme);
      const kind = g.grapheme.includes("_") ? "vcv_word" : g.grapheme.length > 1 ? "digraph_word" : "grapheme_sound";
      letterTeamWords.push(make("letter_team_words", {
        kind,
        prompt: word,
        target_grapheme: g.grapheme,
        difficulty: band,
        notes: `listen for ${g.sound_label} in '${word}'`,
      }));
      if (--n <= 0) return;
    }
  };
  takeFromBand(3, 4);
  takeFromBand(4, 4);
  takeFromBand(5, 3);

  // Strand 4: heart words (sight-word recognition sample).
  const heartWords: AssessmentProbe[] = [];
  for (const word of (learner.all_heart_words ?? []).slice(0, 5)) {
    heartWords.push(make("heart_words", {
      kind: "heart_word",
      prompt: word,
      target_heart_word: word,
      difficulty: 2,
      notes: "word recognition",
    }));
  }

  // Strand 5: pseudowords — curated bank only, filtered by learner catalog.
  const pseudowords: AssessmentProbe[] = [];
  const catalogGraphemes = new Set(catalog.map((g) => g.grapheme));
  const wantedTargets = ["a", "i", "o", "u", "e", "sh", "th", "ch", "ck", "ng"];
  const seenPseudo = new Set<string>();
  for (const target of wantedTargets) {
    if (pseudowords.length >= 5) break;
    if (!catalogGraphemes.has(target)) continue;
    const gRow = catalog.find((g) => g.grapheme === target);
    const pw = pseudowordFor(target, 3);
    if (!pw) continue;
    if (heartWordSet.has(pw.word.toLowerCase())) continue;
    if (exampleWordSet.has(pw.word.toLowerCase())) continue;
    if (seenPseudo.has(pw.word.toLowerCase())) continue;
    seenPseudo.add(pw.word.toLowerCase());
    pseudowords.push(make("pseudowords", {
      kind: "pseudoword",
      prompt: pw.word,
      target_grapheme: target,
      difficulty: pw.difficulty,
      notes: `made-up word; listen for ${gRow?.sound_label ?? target}`,
    }));
  }

  // Strand 6: two decodable sentences from a template pool. Every fixed
  // word is either a heart word from the seed list ("I", "the", "a", "on",
  // "is") or decodable from phase 1-2 letters. Slot in short taught words.
  const phaseOneTwoWords = catalog
    .filter((g) => g.phase <= 2)
    .map((g) => (g.assessment_word || g.example_word || "").trim())
    .filter(Boolean);
  const pickShort = (used: Set<string>): string => {
    for (const w of phaseOneTwoWords) {
      if (w.length <= 3 && !used.has(w.toLowerCase())) { used.add(w.toLowerCase()); return w; }
    }
    for (const w of phaseOneTwoWords) {
      if (!used.has(w.toLowerCase())) { used.add(w.toLowerCase()); return w; }
    }
    return "cat";
  };
  const used = new Set<string>();
  const w1 = pickShort(used);
  const w2 = pickShort(used);
  const sentences: AssessmentProbe[] = [
    make("sentences", { kind: "sentence", prompt: `I sat on a ${w1}.`, difficulty: 3, notes: "listen for smooth word-by-word reading" }),
    make("sentences", { kind: "sentence", prompt: `The ${w2} is on a mat.`, difficulty: 4, notes: "listen for independence and fluency" }),
  ];

  // Assemble easiest -> hardest and hard-cap at 40 by trimming letter-team
  // words if needed (letter-sound coverage stays intact).
  const HARD_CAP = 40;
  const fixedCount = letterSounds.length + simpleWords.length + heartWords.length + pseudowords.length + sentences.length;
  const teamBudget = Math.max(0, HARD_CAP - fixedCount);
  const trimmedTeam = letterTeamWords.slice(0, teamBudget);
  return [
    ...letterSounds,
    ...simpleWords,
    ...trimmedTeam,
    ...heartWords,
    ...pseudowords,
    ...sentences,
  ].slice(0, HARD_CAP);
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