// MATH session engine — parallels session.functions.ts for the reading side.
// Reuses the shared Leitner engine (srs.ts), the reward/streak update, and the
// same "collapse per (item_type,item_ref)" rule so an item can only move once
// per session by the worst outcome seen.
//
// Design tenets (mirrors reading):
//  - App owns the truth: Claude proposes operands + wording, the app computes
//    every answer and drops invalid items. See src/lib/computable.ts.
//  - No timers, no speed language anywhere in the UI or the model prompt.
//  - One shared garden + streak with reading (updateStreakAndStars from the
//    reading module is not imported here to avoid coupling; we inline the
//    same logic and both call the same underlying rewards row).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyOutcome } from "./srs";
import type { Outcome } from "./types";
import { selectNextMathTarget } from "./target-selection";
import {
  compute,
  deriveEnvelope,
  fallbackFacts,
  validateMathItems,
  type MathFactItem,
  type MathOp,
  type ReachedSkillLite,
} from "./computable";

const OUTCOME_ENUM = z.enum(["got_it", "self_corrected", "prompted", "missed", "hesitated"]);
const OUTCOME_SEVERITY: Record<string, number> = {
  missed: 4, prompted: 3, hesitated: 3, self_corrected: 2, got_it: 1,
};

function today() { return new Date().toISOString().slice(0, 10); }

function worstOutcome(events: { outcome: string }[]): Outcome {
  let best = "got_it"; let s = 0;
  for (const e of events) {
    const v = OUTCOME_SEVERITY[e.outcome] ?? 0;
    if (v > s) { s = v; best = e.outcome; }
  }
  if (best === "hesitated") best = "prompted";
  return best as Outcome;
}

async function updateStreakAndStars(supabase: any, learner_id: string, starsToAdd: number) {
  const t = today();
  const { data: r } = await supabase
    .from("rewards")
    .select("stars, current_streak_days, longest_streak, last_session_date")
    .eq("learner_id", learner_id)
    .maybeSingle();
  let current = r?.current_streak_days ?? 0;
  const last = r?.last_session_date;
  if (last === t) { /* already counted today */ }
  else if (last) {
    const diff = Math.round((new Date(t).getTime() - new Date(last).getTime()) / 86400000);
    current = diff === 1 ? current + 1 : 1;
  } else current = 1;
  const longest = Math.max(r?.longest_streak ?? 0, current);
  await supabase.from("rewards").update({
    stars: (r?.stars ?? 0) + starsToAdd,
    current_streak_days: current,
    longest_streak: longest,
    last_session_date: t,
  }).eq("learner_id", learner_id);
}

// ---- Math card shape (parallels SessionCard but math-specific) -------------
export type MathStage = "intro" | "warmup" | "target" | "practice" | "word_problem" | "game" | "wrapup";

export interface MathCard {
  key: string;
  stage: MathStage;
  // for fact cards
  fact?: MathFactItem & { answer: number };
  // for skill cards
  skill?: {
    id: string;
    code: string;
    name: string;
    description: string;
    self_gradable: boolean;
    max_value: number;
  };
  // for word problem
  word?: { text: string; answer: number };
  // for target / intro
  meta?: {
    kind?: "lesson" | "intro" | "quick_game";
    title?: string;
    concept?: string;
    parent_intro?: string;
    visual?: "ten_frame" | "number_line" | "dots" | "none";
    examples?: string[];
  };
  self_gradable: boolean;
}

export interface MathPlan {
  session_id: string;
  learner_id: string;
  cards: MathCard[];
  target_skill_id?: string;
  envelope: { maxNumber: number; allowedOps: MathOp[]; wordProblemsUnlocked: boolean };
}

async function fetchReachedSkills(supabase: any, learner_id: string): Promise<{ reached: ReachedSkillLite[]; rowsById: Map<string, any> }> {
  const { data: rows } = await supabase
    .from("learner_math_status")
    .select("skill_id, status, leitner_box, correct_streak, math_skills(id, code, name, description, strand, max_value, self_gradable, order_index)")
    .eq("learner_id", learner_id)
    .neq("status", "not_started");
  const reached: ReachedSkillLite[] = [];
  const rowsById = new Map<string, any>();
  for (const r of (rows ?? []) as any[]) {
    if (!r.math_skills) continue;
    reached.push({ code: r.math_skills.code, strand: r.math_skills.strand, max_value: r.math_skills.max_value });
    rowsById.set(r.skill_id, r);
  }
  return { reached, rowsById };
}

async function generateMathBundle(
  supabase: any,
  args: {
    learner_id: string;
    reached_codes: string[];
    max_number: number;
    allowed_ops: MathOp[];
    target: {
      code: string; name: string; description: string; self_gradable: boolean; max_value: number;
    };
    age_years: number | null;
    interests: string | null;
    recent_misses: string[];
    strengths: string[];
    challenges: string[];
    parent_observations: string[];
    word_problems_unlocked: boolean;
    freshness_salt: string;
  },
): Promise<any | null> {
  // Cache lookup
  const key = `L=${args.learner_id}::math_bundle::t=${args.target.code}::mx=${args.max_number}::op=${args.allowed_ops.join("")}` +
    `::r=${[...args.reached_codes].sort().join(",")}::rm=${args.recent_misses.slice(0,6).sort().join(",")}::f=${args.freshness_salt}` +
    `::i=${(args.interests ?? "").toLowerCase()}`;

  const { data: cached } = await supabase
    .from("generated_content")
    .select("content_json")
    .eq("cache_key", key)
    .maybeSingle();
  if (cached?.content_json) return cached.content_json;

  let out: any = null;
  try {
    const { data, error } = await supabase.functions.invoke("generate-math", {
      body: {
        taught_skill_codes: args.reached_codes,
        max_number: args.max_number,
        allowed_ops: args.allowed_ops,
        target_skill: {
          code: args.target.code,
          name: args.target.name,
          description: args.target.description,
        },
        age_years: args.age_years,
        interests: args.interests,
        recent_misses: args.recent_misses,
        strengths: args.strengths,
        challenges: args.challenges,
        parent_observations: args.parent_observations,
        word_problems_unlocked: args.word_problems_unlocked,
      },
    });
    if (error) throw error;
    out = data;
  } catch (e) {
    console.error("[math] generate-math failed", e);
  }

  // Validate + compute answers server-side. NEVER trust model arithmetic.
  const rawFacts: MathFactItem[] = Array.isArray(out?.fact_items)
    ? (out.fact_items as any[]).map((x) => ({ a: Number(x.a), op: (x.op === "-" ? "-" : "+") as MathOp, b: Number(x.b) }))
    : [];
  const v = validateMathItems(rawFacts, args.max_number, args.allowed_ops);
  let facts = rawFacts.filter((f, i) => !v.offenders.some((o) => o.startsWith(`${f.a}${f.op}${f.b}`)) || rawFacts.indexOf(f) !== i);
  // simpler: rerun validation individually
  facts = rawFacts.filter((f) => validateMathItems([f], args.max_number, args.allowed_ops).ok);

  if (facts.length < 3) {
    console.warn("[math] falling back — model returned too few valid facts");
    facts = fallbackFacts(args.max_number, args.allowed_ops, 6);
  }

  // Word problem: validate
  let word: { text: string; a: number; op: MathOp; b: number; answer: number } | null = null;
  if (args.word_problems_unlocked && out?.word_problem && typeof out.word_problem.text === "string") {
    const wp = out.word_problem;
    const cand: MathFactItem = { a: Number(wp.a), op: (wp.op === "-" ? "-" : "+") as MathOp, b: Number(wp.b) };
    if (validateMathItems([cand], args.max_number, args.allowed_ops).ok) {
      word = { text: String(wp.text).trim(), ...cand, answer: compute(cand.a, cand.op, cand.b) };
    }
  }

  const focus = out?.focus && typeof out.focus === "object" ? {
    title: String(out.focus.title ?? args.target.name),
    concept: String(out.focus.concept ?? args.target.description),
    parent_intro: String(out.focus.parent_intro ?? ""),
    visual: (["ten_frame","number_line","dots","none"].includes(out.focus.visual) ? out.focus.visual : "none") as "ten_frame" | "number_line" | "dots" | "none",
  } : {
    title: args.target.name,
    concept: args.target.description,
    parent_intro: "",
    visual: "none" as const,
  };

  const bundle = {
    focus,
    fact_items: facts.map((f) => ({ a: f.a, op: f.op, b: f.b, answer: compute(f.a, f.op, f.b) })),
    word_problem: word,
  };

  await supabase.from("generated_content").upsert({
    learner_id: args.learner_id,
    type: "word_list",
    cache_key: key,
    allowed_gpc_ids: [],
    content_json: bundle as any,
    subject: "math",
  } as any, { onConflict: "cache_key" });

  return bundle;
}

// ---- Server functions ------------------------------------------------------

export const listMathSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("math_skills")
      .select("id, code, name, description, strand, phase, order_index, self_gradable, max_value, example_problem")
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMathSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const t = today();
    const { data: status } = await context.supabase
      .from("learner_math_status")
      .select("skill_id, status, leitner_box, next_due_date, math_skills(code, name, strand, phase, order_index)")
      .eq("learner_id", data.learner_id);
    const rows = (status ?? []) as any[];
    const secure = rows.filter((r) => r.status === "secure");
    const calibrated = rows.some((r) => r.status !== "not_started");
    const dueCount = rows.filter((r) => r.status !== "not_started" && r.next_due_date <= t).length;
    return { calibrated, secure_count: secure.length, due_count: dueCount, statuses: rows };
  });

export const applyMathQuickSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; skills: { skill_id: string; level: "not_yet" | "getting_there" | "knows_well" }[] }) =>
    z.object({
      learner_id: z.string().uuid(),
      skills: z.array(z.object({
        skill_id: z.string().uuid(),
        level: z.enum(["not_yet", "getting_there", "knows_well"]),
      })),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const t = today();
    const patchFor = (level: string) => {
      if (level === "knows_well") return { status: "secure" as const, leitner_box: 5, correct_streak: 1, next_due_date: t };
      if (level === "getting_there") return { status: "practising" as const, leitner_box: 3, correct_streak: 0, next_due_date: t };
      return { status: "not_started" as const, leitner_box: 1, correct_streak: 0, next_due_date: t };
    };
    for (const s of data.skills) {
      await context.supabase
        .from("learner_math_status")
        .update(patchFor(s.level) as any)
        .eq("learner_id", data.learner_id)
        .eq("skill_id", s.skill_id);
    }
    return { ok: true };
  });

export const startMathSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<MathPlan> => {
    const { supabase } = context;
    const t = today();

    const { reached, rowsById } = await fetchReachedSkills(supabase, data.learner_id);
    const envelope = deriveEnvelope(reached);

    // Warm-up: due skills (self_gradable ones become fact rounds; non-self_gradable are parent-facilitated skill cards)
    const dueSkillRows = [...rowsById.values()]
      .filter((r) => r.next_due_date <= t)
      .sort((a, b) => (a.math_skills?.order_index ?? 0) - (b.math_skills?.order_index ?? 0))
      .slice(0, 4);

    const target = await selectNextMathTarget(supabase, data.learner_id);

    const { data: learnerRow } = await supabase
      .from("learners")
      .select("birthdate, interests")
      .eq("id", data.learner_id)
      .maybeSingle();
    const ageYears = (learnerRow as any)?.birthdate
      ? Math.floor((Date.now() - new Date((learnerRow as any).birthdate).getTime()) / (365.25 * 86400000))
      : null;
    const interests = ((learnerRow as any)?.interests as string | null) ?? null;

    // Recent challenges / observations
    const { data: recentEvents } = await supabase
      .from("session_events")
      .select("item_ref, outcome, sessions!inner(learner_id, subject, created_at)")
      .eq("sessions.learner_id", data.learner_id)
      .eq("sessions.subject", "math")
      .in("outcome", ["missed", "prompted", "self_corrected", "hesitated"])
      .order("created_at", { ascending: false, referencedTable: "sessions" as any })
      .limit(30);
    const recentMisses = Array.from(new Set((recentEvents ?? []).map((r: any) => r.item_ref).filter(Boolean))).slice(0, 8);

    const { data: recentNotes } = await supabase
      .from("sessions")
      .select("parent_notes")
      .eq("learner_id", data.learner_id)
      .eq("subject", "math")
      .not("parent_notes", "is", null)
      .order("created_at", { ascending: false })
      .limit(3);
    const parentObservations = ((recentNotes ?? []) as any[]).map((s) => (s.parent_notes ?? "").trim()).filter(Boolean);

    const strengths: string[] = [];
    const challenges: string[] = [];
    for (const r of rowsById.values()) {
      const code = r.math_skills?.code as string;
      if (!code) continue;
      if (r.status === "secure" || (r.status === "practising" && (r.correct_streak ?? 0) >= 3)) strengths.push(code);
      else if (r.status === "learning" || (r.correct_streak ?? 0) === 0) challenges.push(code);
    }

    // ONE bundle call
    let bundle: any = null;
    if (target && envelope.allowedOps.length > 0 && envelope.maxNumber > 0) {
      bundle = await generateMathBundle(supabase, {
        learner_id: data.learner_id,
        reached_codes: reached.map((r) => r.code),
        max_number: envelope.maxNumber,
        allowed_ops: envelope.allowedOps,
        target: {
          code: target.code, name: target.name, description: target.description,
          self_gradable: target.self_gradable, max_value: target.max_value,
        },
        age_years: ageYears,
        interests,
        recent_misses: recentMisses,
        strengths,
        challenges,
        parent_observations: parentObservations,
        word_problems_unlocked: envelope.wordProblemsUnlocked,
        freshness_salt: `${t}#${Date.now() % 1000}`,
      });
    }

    // Assemble cards
    const cards: MathCard[] = [];

    if (bundle?.focus) {
      cards.push({
        key: "intro",
        stage: "intro",
        self_gradable: false,
        meta: {
          kind: "intro",
          title: bundle.focus.title,
          concept: bundle.focus.concept,
          parent_intro: bundle.focus.parent_intro,
          visual: bundle.focus.visual,
        },
      });
    }

    for (const r of dueSkillRows) {
      const s = r.math_skills;
      if (!s) continue;
      cards.push({
        key: `w-s-${r.skill_id}`,
        stage: "warmup",
        self_gradable: !!s.self_gradable && envelope.allowedOps.length > 0,
        skill: {
          id: r.skill_id, code: s.code, name: s.name, description: s.description,
          self_gradable: !!s.self_gradable, max_value: s.max_value,
        },
      });
    }

    if (target) {
      cards.push({
        key: `t-${target.id}`,
        stage: "target",
        self_gradable: false, // target card = lesson intro; parent leads
        skill: {
          id: target.id, code: target.code, name: target.name, description: target.description,
          self_gradable: target.self_gradable, max_value: target.max_value,
        },
        meta: {
          kind: "lesson",
          title: bundle?.focus?.title ?? target.name,
          concept: bundle?.focus?.concept ?? target.description,
          parent_intro: bundle?.focus?.parent_intro ?? "",
          visual: bundle?.focus?.visual ?? "none",
        },
      });
    }

    // Practice facts (self-graded if target.self_gradable and we have op)
    const factsSelfGrade = target?.self_gradable ?? false;
    const facts = (bundle?.fact_items ?? []) as { a: number; op: MathOp; b: number; answer: number }[];
    for (const f of facts.slice(0, 8)) {
      cards.push({
        key: `p-${f.a}${f.op}${f.b}`,
        stage: "practice",
        self_gradable: factsSelfGrade,
        fact: f,
      });
    }

    // Word problem
    if (envelope.wordProblemsUnlocked && bundle?.word_problem) {
      const w = bundle.word_problem;
      cards.push({
        key: `wp-${w.a}${w.op}${w.b}`,
        stage: "word_problem",
        self_gradable: false, // parent reads/leads word problems
        fact: { a: w.a, op: w.op, b: w.b, answer: w.answer },
        word: { text: w.text, answer: w.answer },
      });
    }

    // Quick game: one more fact card, mixed
    if (facts.length > 0) {
      const g = facts[Math.floor(Math.random() * facts.length)];
      cards.push({
        key: `g-${g.a}${g.op}${g.b}`,
        stage: "game",
        self_gradable: factsSelfGrade,
        fact: g,
        meta: { kind: "quick_game" },
      });
    }

    cards.push({ key: "wrap", stage: "wrapup", self_gradable: false });

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ learner_id: data.learner_id, plan_json: { cards } as any, subject: "math" } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      session_id: session.id,
      learner_id: data.learner_id,
      cards,
      target_skill_id: target?.id,
      envelope,
    };
  });

export const saveMathSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    session_id: string;
    learner_id: string;
    events: { card_key: string; item_type: "math_skill" | "math_fact"; item_ref: string; outcome: string }[];
    duration_seconds: number;
    parent_notes?: string | null;
  }) => z.object({
    session_id: z.string().uuid(),
    learner_id: z.string().uuid(),
    events: z.array(z.object({
      card_key: z.string(),
      item_type: z.enum(["math_skill", "math_fact"]),
      item_ref: z.string(),
      outcome: OUTCOME_ENUM,
    })),
    duration_seconds: z.number().int().nonnegative(),
    parent_notes: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (data.events.length) {
      const rows = data.events.map((e) => ({
        session_id: data.session_id,
        item_type: e.item_type,
        item_ref: e.item_ref,
        outcome: e.outcome,
      }));
      const { error } = await supabase.from("session_events").insert(rows as any);
      if (error) throw new Error(error.message);
    }

    await supabase.from("sessions")
      .update({ duration_seconds: data.duration_seconds, parent_notes: data.parent_notes ?? null })
      .eq("id", data.session_id);

    // Collapse per skill_id (the item_ref for a math_skill card is the skill_id;
    // math_fact events also carry the parent skill_id so a target + practice on
    // the same skill collapse to one Leitner update per session).
    const groups = new Map<string, { outcome: string }[]>();
    for (const e of data.events) {
      if (!e.item_ref) continue;
      // For math_fact events, item_ref is `${skillId}` (we attach it that way).
      // For math_skill events it's the skill_id directly.
      const skillId = e.item_ref;
      (groups.get(skillId) ?? groups.set(skillId, []).get(skillId)!).push({ outcome: e.outcome });
    }

    const newlySecure: string[] = [];
    for (const [skillId, evs] of groups) {
      const outcome = worstOutcome(evs);
      const { data: row } = await supabase
        .from("learner_math_status")
        .select("leitner_box, correct_streak, status")
        .eq("learner_id", data.learner_id)
        .eq("skill_id", skillId)
        .maybeSingle();
      if (!row) continue;
      const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome });
      await supabase.from("learner_math_status").update({
        leitner_box: res.box,
        correct_streak: res.streak,
        status: res.status,
        next_due_date: res.next_due_date,
        last_seen: res.last_seen,
      }).eq("learner_id", data.learner_id).eq("skill_id", skillId);
      if (res.status === "secure" && row.status !== "secure") newlySecure.push(skillId);
    }

    const stars =
      data.events.filter((e) => e.outcome === "got_it").length +
      Math.floor(data.events.filter((e) => e.outcome === "self_corrected").length / 2);
    await updateStreakAndStars(supabase, data.learner_id, stars);

    return { ok: true, stars_awarded: stars, newly_secure_skill_ids: newlySecure };
  });
