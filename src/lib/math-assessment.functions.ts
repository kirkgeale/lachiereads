// Math assessment — parent-led adaptive probe that parallels the reading
// assessment but keeps things deterministic and offline: probes come from the
// learner's current math_skills state (learning / frontier / secure spot-checks),
// and the parent taps an outcome per probe. Applying the assessment updates
// learner_math_status via the shared SRS engine and writes an
// assessment_reports row with subject='math'.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyOutcome } from "./srs";
import { selectNextMathTarget } from "./target-selection";
import { compute, fallbackFacts, type MathOp } from "./computable";

export type MathProbeKind = "concept" | "fact" | "word";

export interface MathProbe {
  id: string;                 // stable within an assessment
  skill_id: string;
  skill_code: string;
  skill_name: string;
  strand: string;
  phase: number;
  band: "secure_check" | "practising" | "frontier" | "stretch";
  kind: MathProbeKind;
  prompt: string;             // what the parent shows / says
  hint?: string;              // optional parent guidance
  answer?: number | null;     // computed by the app; null for concept-only
}

export interface MathProbeResult {
  id: string;
  skill_id: string;
  outcome: "got_it" | "self_corrected" | "prompted" | "missed" | "skipped";
}

function seedFacts(maxValue: number, ops: MathOp[], count: number) {
  const f = fallbackFacts(Math.max(1, maxValue), ops, count);
  return f.map((it) => ({ ...it, answer: compute(it.a, it.op, it.b) }));
}

function promptForSkill(row: any): { kind: MathProbeKind; prompt: string; hint?: string; answer: number | null } {
  const s = row.math_skills;
  const strand = String(s.strand ?? "");
  const maxV = Number(s.max_value ?? 10);

  if (strand === "addition" || strand === "subtraction") {
    const op: MathOp = strand === "subtraction" ? "-" : "+";
    const facts = seedFacts(maxV, [op], 1);
    const f = facts[0];
    if (f) {
      const sym = op === "+" ? "+" : "−";
      return {
        kind: "fact",
        prompt: `${f.a} ${sym} ${f.b} = ?`,
        answer: f.answer,
      };
    }
  }
  if (strand === "word_problems") {
    return {
      kind: "word",
      prompt: s.example_problem ?? "There are 3 apples. 2 more arrive. How many now?",
      answer: null,
      hint: "Read it once slowly. Let them think — no timer.",
    };
  }
  // counting / subitising / comparing / place value / bonds — concept probes
  return {
    kind: "concept",
    prompt: s.example_problem ?? `Show me: ${s.name.toLowerCase()}.`,
    hint: s.description ?? undefined,
    answer: null,
  };
}

function bandForRow(row: any): MathProbe["band"] | null {
  const st = row.status as string;
  if (st === "secure") return "secure_check";
  if (st === "practising") return "practising";
  if (st === "learning") return "frontier";
  if (st === "not_started") return "stretch";
  return null;
}

// Build a targeted probe list — a comprehensive but not exhausting set.
function buildMathProbes(rows: any[]): MathProbe[] {
  // Group by band
  const secure = rows.filter((r) => r.status === "secure");
  const practising = rows.filter((r) => r.status === "practising");
  const learning = rows.filter((r) => r.status === "learning");
  const notStarted = rows.filter((r) => r.status === "not_started");

  // Ordering: by order_index ascending
  const byOrder = (a: any, b: any) => (a.math_skills?.order_index ?? 0) - (b.math_skills?.order_index ?? 0);
  secure.sort(byOrder);
  practising.sort(byOrder);
  learning.sort(byOrder);
  notStarted.sort(byOrder);

  // Take:
  //   all learning (frontier) — full coverage
  //   all practising — full coverage
  //   up to 5 secure spot-checks — highest-order (recent) first
  //   up to 5 not_started (stretch), earliest-order — to probe next teachable
  const pick: any[] = [];
  const cap = (arr: any[], n: number) => arr.slice(0, n);

  for (const r of learning) pick.push(r);
  for (const r of practising) pick.push(r);
  for (const r of cap([...secure].reverse(), 5)) pick.push(r);
  for (const r of cap(notStarted, 5)) pick.push(r);

  // If the learner is brand new (nothing calibrated), fall back to the first
  // ~12 skills in order to actually probe something.
  if (pick.length === 0) {
    for (const r of cap(rows.slice().sort(byOrder), 12)) pick.push(r);
  }

  const probes: MathProbe[] = [];
  for (const r of pick) {
    const s = r.math_skills;
    if (!s) continue;
    const band = bandForRow(r);
    if (!band) continue;
    const p = promptForSkill(r);
    probes.push({
      id: `p_${r.skill_id}`,
      skill_id: r.skill_id,
      skill_code: s.code,
      skill_name: s.name,
      strand: s.strand,
      phase: s.phase,
      band,
      kind: p.kind,
      prompt: p.prompt,
      hint: p.hint,
      answer: p.answer,
    });
  }
  // Hard cap
  return probes.slice(0, 24);
}

export const startMathAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ assessment_id: string; probes: MathProbe[] }> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("learner_math_status")
      .select("skill_id, status, leitner_box, correct_streak, math_skills(id, code, name, description, strand, phase, order_index, self_gradable, max_value, example_problem)")
      .eq("learner_id", data.learner_id);
    if (error) throw new Error(error.message);

    const probes = buildMathProbes((rows ?? []) as any[]);
    if (!probes.length) throw new Error("No math skills available to assess.");

    const { data: row, error: insErr } = await supabase
      .from("assessment_reports")
      .insert({ learner_id: data.learner_id, probes_json: probes as any, subject: "math" } as any)
      .select("id")
      .single();
    if (insErr || !row) throw new Error(insErr?.message ?? "Failed to create assessment");

    return { assessment_id: row.id, probes };
  });

export const finalizeMathAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    assessment_id: string;
    learner_id: string;
    results: MathProbeResult[];
    notes?: string | null;
  }) => z.object({
    assessment_id: z.string().uuid(),
    learner_id: z.string().uuid(),
    results: z.array(z.object({
      id: z.string(),
      skill_id: z.string().uuid(),
      outcome: z.enum(["got_it", "self_corrected", "prompted", "missed", "skipped"]),
    })),
    notes: z.string().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const today = new Date().toISOString().slice(0, 10);

    // Collapse: worst outcome per skill_id (should already be one probe per
    // skill, but guard for it).
    const severity: Record<string, number> = { missed: 4, prompted: 3, self_corrected: 2, got_it: 1, skipped: 0 };
    const perSkill = new Map<string, { outcome: string; sev: number }>();
    for (const r of data.results) {
      if (r.outcome === "skipped") continue;
      const cur = perSkill.get(r.skill_id);
      const sev = severity[r.outcome] ?? 0;
      if (!cur || sev > cur.sev) perSkill.set(r.skill_id, { outcome: r.outcome, sev });
    }

    // Apply outcomes
    const summaryCounts = { got_it: 0, self_corrected: 0, prompted: 0, missed: 0, skipped: 0 };
    for (const r of data.results) summaryCounts[r.outcome as keyof typeof summaryCounts]++;

    for (const [skillId, { outcome }] of perSkill) {
      const { data: row } = await supabase
        .from("learner_math_status")
        .select("leitner_box, correct_streak, status")
        .eq("learner_id", data.learner_id)
        .eq("skill_id", skillId)
        .maybeSingle();
      if (!row) continue;
      // A "got_it" or "self_corrected" on a not_started skill should promote
      // the learner past not_started so it isn't picked as brand-new later.
      const startBox = row.leitner_box ?? 1;
      const startStreak = row.correct_streak ?? 0;
      const res = applyOutcome({ box: startBox, streak: startStreak, outcome: outcome as any });
      await supabase.from("learner_math_status").update({
        leitner_box: res.box,
        correct_streak: res.streak,
        status: res.status,
        next_due_date: res.next_due_date,
        last_seen: res.last_seen,
      }).eq("learner_id", data.learner_id).eq("skill_id", skillId);
    }

    // Wipe generated math content cache — the model should regenerate now
    // that the learner state has changed.
    await supabase.from("generated_content").delete().eq("learner_id", data.learner_id).eq("subject", "math");

    // Compute the next math target for the summary
    const nextTarget = await selectNextMathTarget(supabase, data.learner_id);

    // Estimated level = highest phase where the learner is secure or practising
    const { data: refreshed } = await supabase
      .from("learner_math_status")
      .select("status, math_skills(phase, name)")
      .eq("learner_id", data.learner_id);
    let maxPhase = 0;
    let secureCount = 0;
    for (const r of (refreshed ?? []) as any[]) {
      if (r.status === "secure" || r.status === "practising") {
        secureCount++;
        const p = r.math_skills?.phase ?? 0;
        if (p > maxPhase) maxPhase = p;
      }
    }

    const estimated_level = maxPhase ? `Phase ${maxPhase}` : "Just starting";
    const plain_summary = [
      `Assessed ${data.results.length} maths skills today.`,
      `${secureCount} skill${secureCount === 1 ? "" : "s"} now practising or secure.`,
      nextTarget ? `Next focus: ${nextTarget.name}.` : `Next focus will be picked in the first session.`,
    ].join(" ");

    const report = {
      subject: "math",
      estimated_level,
      plain_summary,
      counts: summaryCounts,
      secure_count: secureCount,
      next_focus: nextTarget ? {
        code: nextTarget.code,
        name: nextTarget.name,
        description: nextTarget.description,
        strand: nextTarget.strand,
        phase: nextTarget.phase,
      } : null,
    };

    await supabase
      .from("assessment_reports")
      .update({
        events_json: data.results as any,
        report_json: report as any,
        summary: plain_summary,
        estimated_level,
        applied: true,
      })
      .eq("id", data.assessment_id);

    return { ok: true, report };
  });

export const listMathAssessments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("assessment_reports")
      .select("id, created_at, estimated_level, summary, applied, report_json")
      .eq("learner_id", data.learner_id)
      .eq("subject", "math")
      .order("created_at", { ascending: false })
      .limit(20);
    return rows ?? [];
  });

export const getMathProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("learner_math_status")
      .select("skill_id, status, leitner_box, correct_streak, next_due_date, last_seen, math_skills(id, code, name, description, strand, phase, order_index, example_problem, max_value)")
      .eq("learner_id", data.learner_id);
    if (error) throw new Error(error.message);
    return (rows ?? []).sort((a: any, b: any) => (a.math_skills?.order_index ?? 0) - (b.math_skills?.order_index ?? 0));
  });
