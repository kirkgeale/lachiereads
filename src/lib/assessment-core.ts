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
    supabase.from("gpcs").select("id, grapheme, sound_label, phase, example_word, assessment_word, assessment_word_pool, order_index").order("order_index"),
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
  const statusById = new Map<string, MasteryStatus>(
    (gpcStatusRes.data ?? []).map((r: any) => [r.gpc_id, (r.status ?? "not_started") as MasteryStatus]),
  );
  const hwStatusById = new Map<string, MasteryStatus>(
    (hwStatusRes.data ?? []).map((r: any) => [r.heart_word_id, (r.status ?? "not_started") as MasteryStatus]),
  );
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
        assessment_word_pool: Array.isArray(g.assessment_word_pool) ? g.assessment_word_pool.filter((w: any) => typeof w === "string" && w.trim()) : [],
        order_index: g.order_index,
        status: (statusById.get(g.id) ?? "not_started") as MasteryStatus,
      })),
      all_heart_words: heartWords.map((h: any) => h.word),
      heart_word_entries: heartWords.map((h: any) => ({
        word: h.word,
        status: (hwStatusById.get(h.id) ?? "not_started") as MasteryStatus,
      })),
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

// mulberry32 seeded PRNG — deterministic given the same seed.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function pickFromPool(g: AssessmentGraphemeEntry, rand: () => number): string {
  const pool = (g.assessment_word_pool ?? []).filter(Boolean);
  const fallback = [g.assessment_word, g.example_word].filter(Boolean) as string[];
  const merged = Array.from(new Set([...pool, ...fallback].map((w) => w.trim()).filter(Boolean)));
  if (!merged.length) return "";
  return merged[Math.floor(rand() * merged.length)]!;
}

// Adaptive + seeded assessment builder. Emphasises the learner's current
// frontier (learning/practising) while sampling a few secure items for
// retention and a few not_started items just past the frontier to find the
// ceiling. Same seed -> same probes; different seed -> different probes.
export function buildAssessmentProbes(
  learner: AssessmentLearnerContext,
  opts: { seed?: number } = {},
): AssessmentProbe[] {
  const seed = opts.seed ?? Date.now();
  const rand = mulberry32(seed);

  const catalog = uniqueGraphemes(learner.all_graphemes ?? []) as AssessmentGraphemeEntry[];
  const heartWordSet = new Set((learner.all_heart_words ?? []).map((w) => w.toLowerCase()));
  const exampleWordSet = new Set(catalog.map((g) => (g.example_word ?? "").toLowerCase()).filter(Boolean));

  // Frontier detection: highest phase where the learner has any non-secure
  // active status is the working phase; adjacent phases are the ceiling.
  const activePhases = catalog.filter((g) => g.status === "learning" || g.status === "practising").map((g) => g.phase);
  const frontierPhase = activePhases.length
    ? Math.max(...activePhases)
    : Math.min(...(catalog.filter((g) => g.status === "not_started").map((g) => g.phase).length
        ? catalog.filter((g) => g.status === "not_started").map((g) => g.phase)
        : [1]));

  const banded = {
    secure_below: catalog.filter((g) => g.status === "secure" && g.phase <= frontierPhase),
    frontier: catalog.filter((g) => (g.status === "learning" || g.status === "practising") && Math.abs(g.phase - frontierPhase) <= 1),
    just_beyond: catalog.filter((g) => g.status === "not_started" && g.phase <= frontierPhase + 1),
    far_beyond: catalog.filter((g) => g.status === "not_started" && g.phase > frontierPhase + 1),
    far_below_secure: catalog.filter((g) => g.status === "secure" && g.phase < frontierPhase - 1),
  };

  let counter = 0;
  const make = (strand: AssessmentStrand, probe: Omit<AssessmentProbe, "id" | "strand">): AssessmentProbe => ({
    ...probe, strand, id: `p${++counter}`,
  });

  const strandOf = (g: AssessmentGraphemeEntry): AssessmentStrand => {
    if (g.phase <= 2 && /^[a-z]$/i.test(g.grapheme)) return "letter_sounds";
    if (g.phase <= 2) return "simple_words";
    return "letter_team_words";
  };
  const kindOf = (g: AssessmentGraphemeEntry): string => {
    if (g.phase <= 2 && /^[a-z]$/i.test(g.grapheme)) return "grapheme_sound";
    if (g.grapheme.includes("_")) return "vcv_word";
    if (g.grapheme.length > 1) return "digraph_word";
    return "cvc_word";
  };
  const difficultyOf = (g: AssessmentGraphemeEntry): number =>
    Math.max(1, Math.min(5, g.phase >= 5 ? 5 : g.phase >= 3 ? 4 : g.phase === 2 ? 2 : 1));

  const usedGraphemes = new Set<string>();
  const probes: AssessmentProbe[] = [];
  // Returns the number of probes actually placed.
  const takeFrom = (band: AssessmentGraphemeEntry[], n: number): number => {
    if (n <= 0) return 0;
    let placed = 0;
    for (const g of seededShuffle(band, rand)) {
      if (placed >= n) break;
      if (usedGraphemes.has(g.grapheme)) continue;
      const strand = strandOf(g);
      if (strand === "letter_sounds") {
        usedGraphemes.add(g.grapheme);
        probes.push(make("letter_sounds", {
          kind: "grapheme_sound",
          prompt: g.grapheme,
          target_grapheme: g.grapheme,
          difficulty: 1,
          notes: `listen for ${g.sound_label}`,
        }));
        placed++;
      } else {
        const word = pickFromPool(g, rand);
        if (!word) continue;
        usedGraphemes.add(g.grapheme);
        probes.push(make(strand, {
          kind: kindOf(g),
          prompt: word,
          target_grapheme: g.grapheme,
          difficulty: difficultyOf(g),
          notes: `listen for ${g.sound_label} in '${word}'`,
        }));
        placed++;
      }
    }
    return placed;
  };

  // Target-total + weighted reallocation. Ensures a consistently comprehensive
  // assessment regardless of how narrow the current frontier happens to be.
  const TARGET_GRAPHEME_PROBES = 30;
  const bandOrder: (keyof typeof banded)[] = [
    "frontier", "just_beyond", "secure_below", "far_beyond", "far_below_secure",
  ];
  const bandWeights: Record<string, number> = {
    frontier: 0.40, just_beyond: 0.25, secure_below: 0.20, far_beyond: 0.10, far_below_secure: 0.05,
  };
  let shortfall = 0;
  for (const key of bandOrder) {
    const want = Math.max(1, Math.round(TARGET_GRAPHEME_PROBES * (bandWeights[key] ?? 0)));
    const got = takeFrom(banded[key], want);
    shortfall += Math.max(0, want - got);
  }
  // Second pass: redistribute total shortfall in priority order across bands
  // that still have unused items.
  for (const key of bandOrder) {
    if (shortfall <= 0) break;
    const got = takeFrom(banded[key], shortfall);
    shortfall -= got;
  }
  // Last resort: sweep any remaining catalog item.
  if (shortfall > 0) {
    takeFrom(catalog, shortfall);
  }

  // Bootstrap safety: if learner is brand-new (nothing active/secure), sweep
  // phases 1-2 so the first-ever assessment still has substance.
  if (probes.length < 16) {
    const bootstrapNeeded = 16 - probes.length;
    const bootstrapPool = catalog.filter((g) => g.phase <= 2);
    // Only apply if the frontier is empty (brand-new learner); otherwise the
    // shortfall reallocation above has already done everything possible.
    if (!banded.frontier.length && !banded.secure_below.length) {
      takeFrom(bootstrapPool, bootstrapNeeded);
    }
  }

  // --- Heart words: target + reallocation, same shape as graphemes ---
  const hwEntries = learner.heart_word_entries ?? (learner.all_heart_words ?? []).map((w) => ({ word: w, status: "not_started" as MasteryStatus }));
  const hwFrontier = hwEntries.filter((h) => h.status === "learning" || h.status === "practising");
  const hwSecure = hwEntries.filter((h) => h.status === "secure");
  const hwNotStarted = hwEntries.filter((h) => h.status === "not_started");
  const heartWordProbes: AssessmentProbe[] = [];
  const pickHw = (pool: AssessmentHeartWordEntry[], n: number): number => {
    if (n <= 0) return 0;
    let placed = 0;
    for (const h of seededShuffle(pool, rand)) {
      if (placed >= n) break;
      if (heartWordProbes.find((p) => p.target_heart_word === h.word)) continue;
      heartWordProbes.push(make("heart_words", {
        kind: "heart_word",
        prompt: h.word,
        target_heart_word: h.word,
        difficulty: 2,
        notes: "word recognition",
      }));
      placed++;
    }
    return placed;
  };
  const TARGET_HEART_WORDS = 8;
  const hwBands: [AssessmentHeartWordEntry[], number][] = [
    [hwFrontier, 0.50], [hwNotStarted, 0.30], [hwSecure, 0.20],
  ];
  let hwShort = 0;
  for (const [pool, weight] of hwBands) {
    const want = Math.max(1, Math.round(TARGET_HEART_WORDS * weight));
    const got = pickHw(pool, want);
    hwShort += Math.max(0, want - got);
  }
  for (const [pool] of hwBands) {
    if (hwShort <= 0) break;
    const got = pickHw(pool, hwShort);
    hwShort -= got;
  }


  // --- Pseudowords: rotate through bank via seed for targets the learner reached ---
  const pseudoProbes: AssessmentProbe[] = [];
  const catalogGraphemes = new Set(catalog.filter((g) => g.status !== "not_started").map((g) => g.grapheme));
  const pseudoTargets = seededShuffle(["a", "i", "o", "u", "e", "sh", "th", "ch", "ck", "ng"].filter((t) => catalogGraphemes.has(t)), rand);
  const seenPseudo = new Set<string>();
  for (const target of pseudoTargets) {
    if (pseudoProbes.length >= 5) break;
    const gRow = catalog.find((g) => g.grapheme === target);
    const candidates = PSEUDOWORD_BANK
      .filter((p) => p.target_grapheme === target && !REAL_WORD_BLOCKLIST.has(p.word.toLowerCase()) && /^[a-z_]+$/.test(p.word))
      .filter((p) => !heartWordSet.has(p.word.toLowerCase()) && !exampleWordSet.has(p.word.toLowerCase()) && !seenPseudo.has(p.word.toLowerCase()));
    if (!candidates.length) continue;
    const pw = seededShuffle(candidates, rand)[0]!;
    seenPseudo.add(pw.word.toLowerCase());
    pseudoProbes.push(make("pseudowords", {
      kind: "pseudoword",
      prompt: pw.word,
      target_grapheme: target,
      difficulty: pw.difficulty,
      notes: `made-up word; listen for ${gRow?.sound_label ?? target}`,
    }));
  }

  // --- Sentences: pull from active taught pool with variety ---
  const shortActiveWords = catalog
    .filter((g) => g.phase <= 2 && g.status !== "not_started")
    .map((g) => pickFromPool(g, rand))
    .filter((w) => w && w.length <= 4);
  const shuffledWords = seededShuffle(shortActiveWords.length ? shortActiveWords : ["cat", "mat", "pin"], rand);
  const w1 = shuffledWords[0] ?? "cat";
  const w2 = shuffledWords[1] ?? shuffledWords[0] ?? "mat";
  const sentenceTemplates = [
    `I sat on a ${w1}.`,
    `The ${w1} is on a mat.`,
    `A ${w1} and a ${w2}.`,
    `I can see the ${w1}.`,
    `The ${w2} is red.`,
  ];
  const chosenSentences = seededShuffle(sentenceTemplates, rand).slice(0, 2);
  const sentenceProbes: AssessmentProbe[] = chosenSentences.map((s, i) =>
    make("sentences", { kind: "sentence", prompt: s, difficulty: 3 + i, notes: i === 0 ? "listen for smooth word-by-word reading" : "listen for independence and fluency" }),
  );

  // Assemble, ordered easiest -> hardest, capped at 40.
  const HARD_CAP = 40;
  const graphemeProbes = probes.slice().sort((a, b) => a.difficulty - b.difficulty);
  const combined = [...graphemeProbes, ...heartWordProbes, ...pseudoProbes, ...sentenceProbes];
  return combined.slice(0, HARD_CAP);
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