import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// LIST LEARNERS
export const listLearners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("learners")
      .select("id, name, birthdate, notes, garden_theme, interests, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// CREATE LEARNER
export const createLearner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; birthdate?: string | null; garden_theme?: string; notes?: string | null; interests?: string | null }) =>
    z
      .object({
        name: z.string().min(1).max(60),
        birthdate: z.string().nullable().optional(),
        garden_theme: z.string().optional(),
        notes: z.string().nullable().optional(),
        interests: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("learners")
      .insert({
        parent_id: context.userId,
        name: data.name,
        birthdate: data.birthdate ?? null,
        garden_theme: data.garden_theme ?? "meadow",
        notes: data.notes ?? null,
        interests: data.interests ?? null,
      } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateLearner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name?: string; garden_theme?: string; notes?: string | null; birthdate?: string | null; interests?: string | null }) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        garden_theme: z.string().optional(),
        notes: z.string().nullable().optional(),
        birthdate: z.string().nullable().optional(),
        interests: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("learners").update(patch as any).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLearner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("learners").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// LEARNER + REWARDS SUMMARY (kid home)
export const getLearnerSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: learner, error: le } = await context.supabase
      .from("learners")
      .select("id, name, garden_theme")
      .eq("id", data.learner_id)
      .single();
    if (le) throw new Error(le.message);

    const { data: rewards } = await context.supabase
      .from("rewards")
      .select("stars, current_streak_days, longest_streak, badges_json")
      .eq("learner_id", data.learner_id)
      .maybeSingle();

    const { data: gpcStatus } = await context.supabase
      .from("learner_gpc_status")
      .select("status, gpc_id, gpcs(grapheme, order_index)")
      .eq("learner_id", data.learner_id);

    const secureGpcs = (gpcStatus ?? [])
      .filter((r: any) => r.status === "secure")
      .map((r: any) => ({ id: r.gpc_id, grapheme: r.gpcs?.grapheme as string, order_index: r.gpcs?.order_index as number }));

    // count due items
    const today = new Date().toISOString().slice(0, 10);
    const { count: dueGpc } = await context.supabase
      .from("learner_gpc_status")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", today);
    const { count: dueHw } = await context.supabase
      .from("learner_heart_word_status")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", today);

    // Calibration: applied assessment OR any gpc status advanced past 'not_started'
    const { count: appliedAssessments } = await context.supabase
      .from("assessment_reports")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", data.learner_id)
      .eq("applied", true);
    const { count: advancedGpc } = await context.supabase
      .from("learner_gpc_status")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const calibrated = (appliedAssessments ?? 0) > 0 || (advancedGpc ?? 0) > 0;

    return {
      learner,
      rewards: rewards ?? { stars: 0, current_streak_days: 0, longest_streak: 0, badges_json: [] },
      secureGpcs,
      due_count: (dueGpc ?? 0) + (dueHw ?? 0),
      calibrated,
    };
  });

// Quick calibration: bulk-set gpc + heart-word statuses from a parent tick-list.
export const applyQuickCalibration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    learner_id: string;
    gpcs: { gpc_id: string; level: "not_yet" | "getting_there" | "knows_well" }[];
    heart_words: { heart_word_id: string; level: "not_yet" | "getting_there" | "knows_well" }[];
  }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        gpcs: z.array(z.object({
          gpc_id: z.string().uuid(),
          level: z.enum(["not_yet", "getting_there", "knows_well"]),
        })),
        heart_words: z.array(z.object({
          heart_word_id: z.string().uuid(),
          level: z.enum(["not_yet", "getting_there", "knows_well"]),
        })),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const mapPatch = (level: "not_yet" | "getting_there" | "knows_well") => {
      if (level === "knows_well") return { status: "secure" as const, leitner_box: 5, correct_streak: 1, next_due_date: today };
      if (level === "getting_there") return { status: "practising" as const, leitner_box: 3, correct_streak: 0, next_due_date: today };
      return { status: "not_started" as const, leitner_box: 1, correct_streak: 0, next_due_date: null as string | null };
    };
    for (const g of data.gpcs) {
      await context.supabase
        .from("learner_gpc_status")
        .update(mapPatch(g.level) as any)
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", g.gpc_id);
    }
    for (const h of data.heart_words) {
      await context.supabase
        .from("learner_heart_word_status")
        .update(mapPatch(h.level) as any)
        .eq("learner_id", data.learner_id)
        .eq("heart_word_id", h.heart_word_id);
    }
    return { ok: true };
  });
