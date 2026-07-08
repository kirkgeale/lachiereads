import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyOutcome } from "./srs";
import type { SessionCard, SessionPlan, QueuedEvent, Outcome, SessionStage, StageIntro } from "./types";
import { generateContentInternal } from "./content-helper";
import { selectNextTarget } from "./target-selection";

const today = () => new Date().toISOString().slice(0, 10);

// Outcomes accepted from the client. "hesitated" retained for backward-compat
// (older UI versions still emit it).
const OUTCOME_ENUM = z.enum(["got_it", "self_corrected", "prompted", "missed", "hesitated"]);
const CHALLENGE_OUTCOMES = new Set(["missed", "prompted", "self_corrected", "hesitated"]);

async function computeSessionSeq(supabase: any, learner_id: string): Promise<number> {
  // How many sessions has this learner started today? Adds +1 as the seq for the new one.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("learner_id", learner_id)
    .gte("created_at", startOfDay.toISOString());
  return (count ?? 0) + 1;
}

function stageIntro(stage: SessionStage, sound?: string | null): StageIntro | undefined {
  switch (stage) {
    case "intro":
      return { title: "Today's focus", guidance: "Read the intro to your child. Point to the examples together before starting." };
    case "warmup":
      return { title: "Warm-up", guidance: "Quick review of sounds they already know — build confidence." };
    case "target":
      return {
        title: "New sound",
        guidance: sound
          ? `Model the sound "${sound}" once, mouth clear. Then invite them to try.`
          : "Model the sound once, mouth clear. Then invite them to try.",
      };
    case "blend":
      return { title: "Blend ladder", guidance: "Sound out each letter, then blend. Slow → smooth." };
    case "practice":
      return { title: "Word reading", guidance: "Let them try first. Only prompt if truly stuck." };
    case "sentence":
      return { title: "Sentence", guidance: "Point under each word. Read together if needed, then them alone." };
    case "story":
      return { title: "Mini story", guidance: "Enjoy it together — accuracy over speed. Celebrate the read." };
    case "interference":
      return {
        title: "Sound check",
        guidance: "This letter says something different in Swedish. Contrast the two out loud.",
      };
    case "game":
      return { title: "Quick game", guidance: "Fast recall — no pressure, just play." };
    case "wrapup":
      return { title: "Wrap-up", guidance: "Celebrate one specific thing they did well today." };
  }
  return undefined;
}

// Build a lesson plan: warmup → target → blend → practice words → sentence → story → interference → game → wrapup
export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SessionPlan> => {
    const { supabase } = context;
    const t = today();
    const sessionSeq = await computeSessionSeq(supabase, data.learner_id);
    const freshnessSalt = `${t}#${sessionSeq}`;

    // --- Warm-up: 3-5 due items (mix gpc + heart word) ---
    const { data: dueGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, leitner_box, status, gpcs(grapheme, sound_label, example_word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(4);

    const { data: dueHw } = await supabase
      .from("learner_heart_word_status")
      .select("heart_word_id, leitner_box, status, heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(3);

    const warmup: SessionCard[] = [];
    for (const g of dueGpcs ?? []) {
      warmup.push({
        key: `w-g-${g.gpc_id}`,
        item_type: "gpc",
        item_ref: g.gpc_id,
        display: (g as any).gpcs?.grapheme ?? "",
        sound_label: (g as any).gpcs?.sound_label,
        example_word: (g as any).gpcs?.example_word,
        stage: "warmup",
      });
    }
    for (const h of dueHw ?? []) {
      warmup.push({
        key: `w-h-${h.heart_word_id}`,
        item_type: "heart_word",
        item_ref: h.heart_word_id,
        display: (h as any).heart_words?.word ?? "",
        stage: "warmup",
      });
    }
    warmup.splice(5);

    // --- Target: pick a "learning" GPC, else promote next "not_started" ---
    // Shared with finalizeAssessment via selectNextTarget so the report's
    // "next_focus" grapheme cannot drift from what a real session actually picks.
    const targetGpc = await selectNextTarget(supabase, data.learner_id);

    // Interference lookup for target
    const { data: targetInterference } = targetGpc
      ? await supabase
          .from("interference_items")
          .select("*")
          .eq("grapheme", targetGpc.grapheme)
          .maybeSingle()
      : { data: null };

    const targetCards: SessionCard[] = [];
    // Target card is populated AFTER the AI bundle is generated so we can
    // attach lesson-specific teaching content (examples, parent script).


    // --- Learner phase & context for AI generation ---
    const { data: reachedGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, leitner_box, correct_streak, status, gpcs(id, grapheme, sound_label, phase)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");

    const allowedGraphemes = (reachedGpcs ?? []).map((r: any) => r.gpcs.grapheme as string);
    const allowedGpcIds = (reachedGpcs ?? []).map((r: any) => r.gpc_id as string);

    // effectivePhase = highest phase P where every earlier phase has >=60%
    // coverage (any status != not_started) and phase P has > 0. Prevents a
    // single advanced sound unlocking sentence/story stages prematurely.
    const { data: allGpcRows } = await supabase
      .from("gpcs")
      .select("id, phase");
    const reachedIds = new Set(allowedGpcIds);
    const phaseTotals = new Map<number, number>();
    const phaseReached = new Map<number, number>();
    for (const g of (allGpcRows ?? []) as any[]) {
      phaseTotals.set(g.phase, (phaseTotals.get(g.phase) ?? 0) + 1);
      if (reachedIds.has(g.id)) phaseReached.set(g.phase, (phaseReached.get(g.phase) ?? 0) + 1);
    }
    let effectivePhase = 1;
    const phaseNums = [...phaseTotals.keys()].sort((a, b) => a - b);
    for (const p of phaseNums) {
      const reached = phaseReached.get(p) ?? 0;
      const total = phaseTotals.get(p) ?? 0;
      const cov = total ? reached / total : 0;
      if (reached === 0) break;
      const priorOk = phaseNums.filter((q) => q < p).every((q) => {
        const t = phaseTotals.get(q) ?? 0; const r = phaseReached.get(q) ?? 0;
        return t === 0 || r / t >= 0.6;
      });
      if (!priorOk) break;
      effectivePhase = p;
      if (cov < 0.6) break;
    }
    const currentPhase = effectivePhase;

    const { data: knownHwRows } = await supabase
      .from("learner_heart_word_status")
      .select("leitner_box, correct_streak, status, heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const knownHeartWords = (knownHwRows ?? []).map((r: any) => r.heart_words.word as string);

    const { data: learnerRow } = await supabase
      .from("learners")
      .select("birthdate, interests")
      .eq("id", data.learner_id)
      .maybeSingle();
    const ageYears = (learnerRow as any)?.birthdate
      ? Math.floor((Date.now() - new Date((learnerRow as any).birthdate).getTime()) / (365.25 * 86400000))
      : null;
    const interests = ((learnerRow as any)?.interests as string | null) ?? null;

    // Filtered interference pairs: only non-secure AND (in allowed graphemes OR is the current target)
    const { data: interferenceStatusRows } = await supabase
      .from("learner_interference_status")
      .select("status, interference_items(id, grapheme, swedish_value, english_value)")
      .eq("learner_id", data.learner_id);
    const allowedSet = new Set(allowedGraphemes);
    const interferenceRows = ((interferenceStatusRows ?? []) as any[])
      .filter((r) => r.status !== "secure")
      .map((r) => r.interference_items)
      .filter((it: any) => it && (allowedSet.has(it.grapheme) || it.grapheme === targetGpc?.grapheme))
      .map((it: any) => ({ grapheme: it.grapheme, swedish_value: it.swedish_value, english_value: it.english_value }));

    // Recent parent observations from last 3 sessions
    const { data: recentSessions } = await supabase
      .from("sessions")
      .select("parent_notes")
      .eq("learner_id", data.learner_id)
      .not("parent_notes", "is", null)
      .order("created_at", { ascending: false })
      .limit(3);
    const parentObservations = ((recentSessions ?? []) as any[])
      .map((s) => (s.parent_notes ?? "").trim())
      .filter(Boolean);

    // Recent challenges (last ~40 events): anything that wasn't clean got_it
    const { data: recentEvents } = await supabase
      .from("session_events")
      .select("item_ref, outcome, sessions!inner(learner_id, created_at)")
      .eq("sessions.learner_id", data.learner_id)
      .in("outcome", ["missed", "prompted", "self_corrected", "hesitated"])
      .order("created_at", { ascending: false, referencedTable: "sessions" as any })
      .limit(40);
    const recentMisses = Array.from(
      new Set((recentEvents ?? []).map((r: any) => r.item_ref).filter(Boolean)),
    ).slice(0, 8);
    const missSet = new Set(recentMisses);

    // Strengths (clean & durable) vs challenges (shaky or recently non-clean)
    const strengthGraphemes: string[] = [];
    const challengeGraphemes: string[] = [];
    for (const r of (reachedGpcs ?? []) as any[]) {
      const g = r.gpcs.grapheme as string;
      const strong =
        (r.status === "secure" || (r.status === "practising" && (r.correct_streak ?? 0) >= 3)) &&
        !missSet.has(r.gpc_id) && !missSet.has(g);
      const shaky =
        r.status === "learning" || (r.correct_streak ?? 0) === 0 || missSet.has(r.gpc_id) || missSet.has(g);
      if (strong) strengthGraphemes.push(g);
      else if (shaky) challengeGraphemes.push(g);
    }
    const strengthHeartWords: string[] = [];
    const challengeHeartWords: string[] = [];
    for (const r of (knownHwRows ?? []) as any[]) {
      const w = r.heart_words.word as string;
      if (r.status === "secure" && !missSet.has(w)) strengthHeartWords.push(w);
      else if (r.status === "learning" || missSet.has(w)) challengeHeartWords.push(w);
    }

    const strengths = [...strengthGraphemes, ...strengthHeartWords];
    const challenges = [...challengeGraphemes, ...challengeHeartWords];

    const genBase = {
      supabase,
      learner_id: data.learner_id,
      allowedGraphemes,
      allowedGpcIds,
      knownHeartWords,
      ageYears,
      currentPhase,
      targetGrapheme: targetGpc?.grapheme ?? null,
      targetSoundLabel: targetGpc?.sound_label ?? null,
      recentMisses,
      interferencePairs: interferenceRows ?? [],
      strengths,
      challenges,
      freshnessSalt,
      interests,
      parentObservations,
    };

    // --- ONE Claude call for the whole lesson bundle ---
    let bundle: any = null;
    if (allowedGraphemes.length > 0) {
      try {
        bundle = await generateContentInternal({ ...genBase, type: "lesson_bundle", variant: "lesson_bundle" });
      } catch (err) {
        console.error("[startSession] lesson bundle failed", err);
      }
    }

    // Intro card — parent-facing lesson concept + examples
    const introCards: SessionCard[] = [];
    if (bundle?.focus) {
      const f = bundle.focus;
      const exampleLine = Array.isArray(f.examples) && f.examples.length
        ? ` Examples: ${f.examples.slice(0, 4).join(", ")}.`
        : "";
      introCards.push({
        key: "intro",
        item_type: "decodable_word",
        item_ref: "intro",
        display: f.title ?? "Today's focus",
        stage: "intro",
        meta: {
          kind: "intro",
          concept: f.concept ?? "",
          parent_intro: (f.parent_intro ?? "") + exampleLine,
        },
      });
    }

    // Build the target/lesson card now the bundle (with focus + examples) is available.
    if (targetGpc) {
      const focusExamples = Array.isArray(bundle?.focus?.examples)
        ? (bundle.focus.examples as unknown[]).map(String).filter(Boolean).slice(0, 4)
        : [];
      const lessonExamples = focusExamples.length
        ? focusExamples
        : ([targetGpc.example_word].filter(Boolean) as string[]);
      targetCards.push({
        key: `t-${targetGpc.id}`,
        item_type: "gpc",
        item_ref: targetGpc.id,
        display: targetGpc.grapheme,
        sound_label: targetGpc.sound_label,
        example_word: targetGpc.example_word,
        interference: targetInterference ?? null,
        stage: "target",
        meta: {
          kind: "lesson",
          concept: bundle?.focus?.concept ?? `The letter '${targetGpc.grapheme}' says ${targetGpc.sound_label}.`,
          parent_intro: bundle?.focus?.parent_intro ?? "",
          examples: lessonExamples,
        },
      });
    }

    const blendCards: SessionCard[] = [];
    if (currentPhase >= 2 && Array.isArray(bundle?.blend_words)) {
      for (const w of bundle.blend_words.slice(0, 5)) {
        blendCards.push({ key: `b-${w}`, item_type: "decodable_word", item_ref: w, display: w, stage: "blend" });
      }
    }

    // --- Word practice ---
    const practiceCards: SessionCard[] = [];
    if (Array.isArray(bundle?.practice_words)) {
      for (const w of bundle.practice_words.slice(0, 8)) {
        practiceCards.push({ key: `p-w-${w}`, item_type: "decodable_word", item_ref: w, display: w, stage: "practice" });
      }
    }

    // --- Sentence (phase >= 3) ---
    const sentenceCards: SessionCard[] = [];
    if (currentPhase >= 3 && typeof bundle?.sentence === "string" && bundle.sentence.trim()) {
      sentenceCards.push({
        key: `s-sent`,
        item_type: "decodable_word",
        item_ref: bundle.sentence,
        display: bundle.sentence,
        stage: "sentence",
        meta: { kind: "sentence" },
      });
    }

    // --- Mini story (phase >= 5) ---
    const storyCards: SessionCard[] = [];
    if (currentPhase >= 5 && typeof bundle?.story === "string" && bundle.story.trim()) {
      storyCards.push({
        key: `s-story`,
        item_type: "decodable_word",
        item_ref: bundle.story,
        display: bundle.story,
        stage: "story",
        meta: { kind: "sentence" },
      });
    }

    // --- Interference stage: only if the target has a Swedish confusable ---
    const interferenceCards: SessionCard[] = [];
    if (targetInterference && targetGpc) {
      interferenceCards.push({
        key: `i-${targetGpc.id}`,
        item_type: "gpc",
        item_ref: targetGpc.id,
        display: (targetInterference as any).example_word ?? targetGpc.grapheme,
        interference: targetInterference as any,
        stage: "interference",
        meta: { kind: "interference", interference_id: (targetInterference as any).id },
      });
    }

    // --- Game ---
    const gameSourcePool = (reachedGpcs ?? []).slice(0, 12);
    const shuffled = [...gameSourcePool].sort(() => Math.random() - 0.5);
    const gameCards: SessionCard[] = shuffled.slice(0, 3).map((r: any) => ({
      key: `g-${r.gpc_id}`,
      item_type: "gpc",
      item_ref: r.gpc_id,
      display: r.gpcs.grapheme,
      stage: "game",
      meta: { kind: "quick_game" },
    }));

    // --- Wrap-up ---
    const wrapup: SessionCard[] = [
      { key: "wrap", item_type: "gpc", item_ref: "", display: "", stage: "wrapup" },
    ];

    // Assemble in order, attach stage_intro to the first card of each stage
    const ordered: SessionCard[] = [
      ...introCards,
      ...warmup,
      ...targetCards,
      ...blendCards,
      ...practiceCards,
      ...sentenceCards,
      ...storyCards,
      ...interferenceCards,
      ...gameCards,
      ...wrapup,
    ];
    let prevStage: SessionStage | null = null;
    for (const c of ordered) {
      if (c.stage !== prevStage) {
        c.stage_intro = stageIntro(c.stage, c.sound_label ?? targetGpc?.sound_label ?? null);
        prevStage = c.stage;
      }
    }

    const { data: session, error: se } = await supabase
      .from("sessions")
      .insert({ learner_id: data.learner_id, plan_json: { cards: ordered } as any })
      .select("id")
      .single();
    if (se) throw new Error(se.message);

    return {
      session_id: session.id,
      learner_id: data.learner_id,
      cards: ordered,
      target_gpc_id: targetGpc?.id,
    };
  });

// -------- Save session --------
export const saveSessionEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { session_id: string; learner_id: string; events: QueuedEvent[]; duration_seconds: number; parent_notes?: string | null }) =>
    z
      .object({
        session_id: z.string().uuid(),
        learner_id: z.string().uuid(),
        events: z.array(
          z.object({
            card_key: z.string(),
            item_type: z.enum(["gpc", "heart_word", "decodable_word"]),
            item_ref: z.string(),
            outcome: OUTCOME_ENUM,
          }),
        ),
        duration_seconds: z.number().int().nonnegative(),
        parent_notes: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (data.events.length) {
      const rows = data.events.map((e) => ({
        session_id: data.session_id,
        item_type: e.item_type,
        item_ref: e.item_ref,
        outcome: e.outcome,
      }));
      const { error } = await supabase.from("session_events").insert(rows);
      if (error) throw new Error(error.message);
    }

    await supabase
      .from("sessions")
      .update({ duration_seconds: data.duration_seconds, parent_notes: data.parent_notes ?? null })
      .eq("id", data.session_id);

    const newlySecureGpcIds: string[] = [];

    const gpcEvents = data.events.filter((e) => e.item_type === "gpc" && e.item_ref);
    const hwEvents = data.events.filter((e) => e.item_type === "heart_word" && e.item_ref);

    for (const ev of gpcEvents) {
      const { data: row } = await supabase
        .from("learner_gpc_status")
        .select("leitner_box, correct_streak, status")
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", ev.item_ref)
        .maybeSingle();
      if (!row) continue;
      const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
      await supabase
        .from("learner_gpc_status")
        .update({
          leitner_box: res.box,
          correct_streak: res.streak,
          status: res.status,
          next_due_date: res.next_due_date,
          last_seen: res.last_seen,
        })
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", ev.item_ref);
      if (res.status === "secure" && row.status !== "secure") newlySecureGpcIds.push(ev.item_ref);
    }
    for (const ev of hwEvents) {
      const { data: row } = await supabase
        .from("learner_heart_word_status")
        .select("leitner_box, correct_streak")
        .eq("learner_id", data.learner_id)
        .eq("heart_word_id", ev.item_ref)
        .maybeSingle();
      if (!row) continue;
      const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
      await supabase
        .from("learner_heart_word_status")
        .update({
          leitner_box: res.box,
          correct_streak: res.streak,
          status: res.status,
          next_due_date: res.next_due_date,
          last_seen: res.last_seen,
        })
      .eq("learner_id", data.learner_id)
      .eq("heart_word_id", ev.item_ref);
    }

    // Interference progression: any event whose card_key starts with "i-" is the interference card.
    // Advance still_confuses -> resolving -> secure on got_it; hold at resolving on
    // self_corrected / prompted; reset to still_confuses on missed.
    const interferenceEvents = data.events.filter((e) => e.card_key.startsWith("i-") && e.item_type === "gpc" && e.item_ref);
    for (const ev of interferenceEvents) {
      // gpc_id -> grapheme
      const { data: gpcRow } = await supabase
        .from("gpcs")
        .select("grapheme")
        .eq("id", ev.item_ref)
        .maybeSingle();
      const grapheme = (gpcRow as any)?.grapheme;
      if (!grapheme) continue;
      const { data: intRow } = await supabase
        .from("interference_items")
        .select("id")
        .eq("grapheme", grapheme)
        .maybeSingle();
      const interferenceId = (intRow as any)?.id;
      if (!interferenceId) continue;
      const { data: status } = await supabase
        .from("learner_interference_status")
        .select("status")
        .eq("learner_id", data.learner_id)
        .eq("interference_id", interferenceId)
        .maybeSingle();
      const current = ((status as any)?.status ?? "still_confuses") as "still_confuses" | "resolving" | "secure";
      let next = current;
      if (ev.outcome === "got_it") {
        next = current === "still_confuses" ? "resolving" : current === "resolving" ? "secure" : "secure";
      } else if (ev.outcome === "self_corrected" || ev.outcome === "prompted") {
        next = current === "secure" ? "resolving" : "resolving";
      } else if (ev.outcome === "missed") {
        next = "still_confuses";
      }
      if (next !== current) {
        await supabase
          .from("learner_interference_status")
          .update({ status: next })
          .eq("learner_id", data.learner_id)
          .eq("interference_id", interferenceId);
      }
    }



    // Stars: 1 per got_it, 0.5 (rounded) per self_corrected
    const stars =
      data.events.filter((e) => e.outcome === "got_it").length +
      Math.floor(data.events.filter((e) => e.outcome === "self_corrected").length / 2);
    const t = today();
    const { data: r } = await supabase
      .from("rewards")
      .select("stars, current_streak_days, longest_streak, last_session_date")
      .eq("learner_id", data.learner_id)
      .maybeSingle();
    let current = r?.current_streak_days ?? 0;
    const last = r?.last_session_date;
    if (last === t) {
      // same day
    } else if (last) {
      const lastDate = new Date(last);
      const todayDate = new Date(t);
      const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000);
      current = diffDays === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    const longest = Math.max(r?.longest_streak ?? 0, current);
    await supabase
      .from("rewards")
      .update({
        stars: (r?.stars ?? 0) + stars,
        current_streak_days: current,
        longest_streak: longest,
        last_session_date: t,
      })
      .eq("learner_id", data.learner_id);

    return { ok: true, newly_secure_gpc_ids: newlySecureGpcIds, stars_awarded: stars };
  });

// -------- FLASHCARDS: balanced 20-card mix (sounds + heart words + decodable words) --------
export const buildFlashcardDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; size?: number }) =>
    z.object({ learner_id: z.string().uuid(), size: z.number().int().min(3).max(30).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<SessionCard[]> => {
    const { supabase } = context;
    const size = data.size ?? 20;
    const t = today();
    const sessionSeq = await computeSessionSeq(supabase, data.learner_id);
    const freshnessSalt = `${t}#fc#${sessionSeq}`;

    // Target counts within the deck
    const targetGpcCount = Math.round(size * 0.4);   // ~8 of 20
    const targetHwCount = Math.round(size * 0.2);    // ~4 of 20
    const targetWordCount = size - targetGpcCount - targetHwCount; // ~8 of 20

    // --- GPCs: due first, top up with active-not-due ---
    const { data: dueGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, leitner_box, next_due_date, status, gpcs(grapheme, sound_label, example_word, order_index)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(targetGpcCount * 2);

    let gpcs: any[] = dueGpcs ?? [];
    if (gpcs.length < targetGpcCount) {
      const { data: activeGpcs } = await supabase
        .from("learner_gpc_status")
        .select("gpc_id, leitner_box, status, gpcs(grapheme, sound_label, example_word, order_index)")
        .eq("learner_id", data.learner_id)
        .neq("status", "not_started")
        .order("leitner_box", { ascending: true })
        .limit(targetGpcCount * 2);
      const seen = new Set(gpcs.map((g) => g.gpc_id));
      const extra = (activeGpcs ?? []).filter((g: any) => !seen.has(g.gpc_id));
      gpcs = [...gpcs, ...extra];
    }
    gpcs = gpcs.slice(0, targetGpcCount);

    // --- Heart words: due first, top up with active ---
    const { data: dueHws } = await supabase
      .from("learner_heart_word_status")
      .select("heart_word_id, leitner_box, next_due_date, status, heart_words(word, order_index)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(targetHwCount * 2);

    let hws: any[] = dueHws ?? [];
    if (hws.length < targetHwCount) {
      const { data: activeHws } = await supabase
        .from("learner_heart_word_status")
        .select("heart_word_id, leitner_box, status, heart_words(word, order_index)")
        .eq("learner_id", data.learner_id)
        .neq("status", "not_started")
        .order("leitner_box", { ascending: true })
        .limit(targetHwCount * 2);
      const seen = new Set(hws.map((h) => h.heart_word_id));
      const extra = (activeHws ?? []).filter((h: any) => !seen.has(h.heart_word_id));
      hws = [...hws, ...extra];
    }
    hws = hws.slice(0, targetHwCount);

    // --- Decodable words at level (via Claude generate-content) ---
    const { data: reachedGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, gpcs(grapheme)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const allowedGraphemes = (reachedGpcs ?? []).map((r: any) => r.gpcs.grapheme as string);
    const allowedGpcIds = (reachedGpcs ?? []).map((r: any) => r.gpc_id as string);
    const { data: knownHwRows } = await supabase
      .from("learner_heart_word_status")
      .select("heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const knownHeartWords = (knownHwRows ?? []).map((r: any) => r.heart_words.word as string);

    let wordCards: SessionCard[] = [];
    if (targetWordCount > 0 && allowedGraphemes.length > 0) {
      try {
        const res = await generateContentInternal({
          supabase,
          learner_id: data.learner_id,
          type: "game_words",
          allowedGraphemes,
          allowedGpcIds,
          knownHeartWords,
          freshnessSalt,
          variant: "flashcards",
        });
        const words: string[] = (res.words ?? []).slice(0, targetWordCount);
        wordCards = words.map((w) => ({
          key: `fc-w-${w}`,
          item_type: "decodable_word",
          item_ref: w,
          display: w,
          stage: "warmup",
        }));
      } catch (err) {
        console.error("[buildFlashcardDeck] word gen failed", err);
      }
    }

    const cards: SessionCard[] = [];
    for (const g of gpcs) {
      cards.push({
        key: `fc-g-${g.gpc_id}`,
        item_type: "gpc",
        item_ref: g.gpc_id,
        display: (g as any).gpcs?.grapheme ?? "",
        sound_label: (g as any).gpcs?.sound_label,
        example_word: (g as any).gpcs?.example_word,
        stage: "warmup",
      });
    }
    for (const h of hws) {
      cards.push({
        key: `fc-h-${h.heart_word_id}`,
        item_type: "heart_word",
        item_ref: h.heart_word_id,
        display: (h as any).heart_words?.word ?? "",
        stage: "warmup",
      });
    }
    cards.push(...wordCards);

    return cards.sort(() => Math.random() - 0.5).slice(0, size);
  });

export const saveFlashcardEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; events: QueuedEvent[] }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        events: z.array(
          z.object({
            card_key: z.string(),
            item_type: z.enum(["gpc", "heart_word", "decodable_word"]),
            item_ref: z.string(),
            outcome: OUTCOME_ENUM,
          }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: session } = await supabase
      .from("sessions")
      .insert({ learner_id: data.learner_id, plan_json: { kind: "flashcards" }, duration_seconds: 0 })
      .select("id")
      .single();
    if (!session) throw new Error("Failed to create flashcards session");

    if (data.events.length) {
      await supabase.from("session_events").insert(
        data.events.map((e) => ({
          session_id: session.id,
          item_type: e.item_type,
          item_ref: e.item_ref,
          outcome: e.outcome,
        })),
      );
    }

    const newlySecure: string[] = [];
    for (const ev of data.events) {
      if (ev.item_type === "gpc") {
        const { data: row } = await supabase
          .from("learner_gpc_status")
          .select("leitner_box, correct_streak, status")
          .eq("learner_id", data.learner_id)
          .eq("gpc_id", ev.item_ref)
          .maybeSingle();
        if (!row) continue;
        const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
        await supabase
          .from("learner_gpc_status")
          .update({
            leitner_box: res.box,
            correct_streak: res.streak,
            status: res.status,
            next_due_date: res.next_due_date,
            last_seen: res.last_seen,
          })
          .eq("learner_id", data.learner_id)
          .eq("gpc_id", ev.item_ref);
        if (res.status === "secure" && row.status !== "secure") newlySecure.push(ev.item_ref);
      } else if (ev.item_type === "heart_word") {
        const { data: row } = await supabase
          .from("learner_heart_word_status")
          .select("leitner_box, correct_streak")
          .eq("learner_id", data.learner_id)
          .eq("heart_word_id", ev.item_ref)
          .maybeSingle();
        if (!row) continue;
        const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
        await supabase
          .from("learner_heart_word_status")
          .update({
            leitner_box: res.box,
            correct_streak: res.streak,
            status: res.status,
            next_due_date: res.next_due_date,
            last_seen: res.last_seen,
          })
          .eq("learner_id", data.learner_id)
          .eq("heart_word_id", ev.item_ref);
      }
    }

    const stars =
      data.events.filter((e) => e.outcome === "got_it").length +
      Math.floor(data.events.filter((e) => e.outcome === "self_corrected").length / 2);
    const { data: r } = await supabase
      .from("rewards")
      .select("stars")
      .eq("learner_id", data.learner_id)
      .maybeSingle();
    await supabase
      .from("rewards")
      .update({ stars: (r?.stars ?? 0) + stars })
      .eq("learner_id", data.learner_id);

    return { ok: true, newly_secure_gpc_ids: newlySecure, stars_awarded: stars };
  });
