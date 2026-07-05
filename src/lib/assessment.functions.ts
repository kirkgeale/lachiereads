import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Probe {
  id: string;
  kind: string;
  prompt: string;
  target_grapheme?: string;
  target_heart_word?: string;
  difficulty: number;
  notes?: string;
}

interface ProbeResult extends Probe {
  outcome: "correct" | "self_corrected" | "prompted" | "missed" | "skipped";
}

function ageYears(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  const now = new Date();
  const ms = now.getTime() - b.getTime();
  return Math.floor(ms / (365.25 * 86400000));
}

async function loadContext(supabase: any, learner_id: string) {
  const [{ data: learner }, { data: gpcs }, { data: gpcStatus }, { data: heartWords }, { data: hwStatus }, { data: interference }] =
    await Promise.all([
      supabase.from("learners").select("name, birthdate, garden_theme").eq("id", learner_id).single(),
      supabase.from("gpcs").select("id, grapheme, sound_label, phase, example_word, order_index").order("order_index"),
      supabase.from("learner_gpc_status").select("gpc_id, status").eq("learner_id", learner_id),
      supabase.from("heart_words").select("id, word, order_index").order("order_index"),
      supabase.from("learner_heart_word_status").select("heart_word_id, status").eq("learner_id", learner_id),
      supabase.from("interference_items").select("grapheme, swedish_value, english_value"),
    ]);
  const statusById = new Map<string, string>((gpcStatus ?? []).map((r: any) => [r.gpc_id, r.status]));
  const hwStatusById = new Map<string, string>((hwStatus ?? []).map((r: any) => [r.heart_word_id, r.status]));
  const known_graphemes = (gpcs ?? []).filter((g: any) => (statusById.get(g.id) ?? "not_started") !== "not_started").map((g: any) => g.grapheme);
  const secure_graphemes = (gpcs ?? []).filter((g: any) => statusById.get(g.id) === "secure").map((g: any) => g.grapheme);
  const known_heart_words = (heartWords ?? []).filter((h: any) => (hwStatusById.get(h.id) ?? "not_started") !== "not_started").map((h: any) => h.word);
  return {
    learner_ctx: {
      name: learner?.name ?? "Learner",
      age_years: ageYears(learner?.birthdate ?? null),
      garden_theme: learner?.garden_theme,
      known_graphemes,
      secure_graphemes,
      known_heart_words,
      interference_pairs: interference ?? [],
      all_graphemes: (gpcs ?? []).map((g: any) => ({
        grapheme: g.grapheme, sound_label: g.sound_label, phase: g.phase, example_word: g.example_word,
      })),
      all_heart_words: (heartWords ?? []).map((h: any) => h.word),
    },
    gpcs: gpcs ?? [],
    heartWords: heartWords ?? [],
  };
}

// Start an assessment: get probe list from Claude and save an empty record
export const startAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ assessment_id: string; probes: Probe[] }> => {
    const { supabase } = context;
    const { learner_ctx } = await loadContext(supabase, data.learner_id);

    const { data: fnRes, error: fnErr } = await supabase.functions.invoke("assess-reading", {
      body: { action: "plan", learner: learner_ctx },
    });
    if (fnErr) throw new Error(fnErr.message);
    const probes: Probe[] = fnRes?.probes ?? [];
    if (!probes.length) throw new Error("Assessment planner returned no probes.");

    const { data: row, error: insErr } = await supabase
      .from("assessment_reports")
      .insert({ learner_id: data.learner_id, probes_json: probes as any })
      .select("id")
      .single();
    if (insErr || !row) throw new Error(insErr?.message ?? "Failed to create assessment");

    return { assessment_id: row.id, probes };
  });

// Finalise: get report from Claude, save it, apply status updates
export const finalizeAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { assessment_id: string; learner_id: string; results: ProbeResult[] }) =>
    z
      .object({
        assessment_id: z.string().uuid(),
        learner_id: z.string().uuid(),
        results: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            prompt: z.string(),
            target_grapheme: z.string().optional(),
            target_heart_word: z.string().optional(),
            difficulty: z.number(),
            notes: z.string().optional(),
            outcome: z.enum(["correct", "self_corrected", "prompted", "missed", "skipped", "hesitated"]),
          }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { learner_ctx, gpcs, heartWords } = await loadContext(supabase, data.learner_id);

    const { data: fnRes, error: fnErr } = await supabase.functions.invoke("assess-reading", {
      body: { action: "report", learner: learner_ctx, results: data.results },
    });
    if (fnErr) throw new Error(fnErr.message);

    const report = fnRes ?? {};
    const gpcUpdates: { grapheme: string; status: string }[] = report.gpc_updates ?? [];
    const hwUpdates: { word: string; status: string }[] = report.heart_word_updates ?? [];

    // Apply GPC updates
    const gpcByGrapheme = new Map<string, string>((gpcs as any[]).map((g) => [g.grapheme, g.id]));
    const hwByWord = new Map<string, string>((heartWords as any[]).map((h) => [h.word.toLowerCase(), h.id]));

    const boxByStatus: Record<string, number> = { not_started: 1, learning: 1, practising: 3, secure: 5 };
    const today = new Date().toISOString().slice(0, 10);

    type AllowedStatus = "not_started" | "learning" | "practising" | "secure";
    const allowed: AllowedStatus[] = ["not_started", "learning", "practising", "secure"];
    const coerce = (s: string): AllowedStatus => (allowed.includes(s as AllowedStatus) ? (s as AllowedStatus) : "learning");

    for (const u of gpcUpdates) {
      const id = gpcByGrapheme.get(u.grapheme);
      if (!id) continue;
      const status = coerce(u.status);
      await supabase
        .from("learner_gpc_status")
        .update({
          status,
          leitner_box: boxByStatus[status] ?? 1,
          correct_streak: status === "secure" ? 1 : 0,
          next_due_date: today,
        })
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", id);
    }
    for (const u of hwUpdates) {
      const id = hwByWord.get(u.word.toLowerCase());
      if (!id) continue;
      const status = coerce(u.status);
      await supabase
        .from("learner_heart_word_status")
        .update({
          status,
          leitner_box: boxByStatus[status] ?? 1,
          correct_streak: status === "secure" ? 1 : 0,
          next_due_date: today,
        })
        .eq("learner_id", data.learner_id)
        .eq("heart_word_id", id);
    }

    // Wipe cached generated content — level shifted
    await supabase.from("generated_content").delete().eq("learner_id", data.learner_id);

    // Save the report
    await supabase
      .from("assessment_reports")
      .update({
        events_json: data.results,
        report_json: report,
        summary: report.summary ?? null,
        estimated_level: report.estimated_level ?? null,
        applied: true,
      })
      .eq("id", data.assessment_id);

    return { ok: true, report };
  });

export const listAssessments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("assessment_reports")
      .select("id, created_at, estimated_level, summary, applied")
      .eq("learner_id", data.learner_id)
      .order("created_at", { ascending: false })
      .limit(20);
    return rows ?? [];
  });
