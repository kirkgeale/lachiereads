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
  .inputValidator((d: { name: string; birthdate?: string | null; garden_theme?: string; notes?: string | null }) =>
    z
      .object({
        name: z.string().min(1).max(60),
        birthdate: z.string().nullable().optional(),
        garden_theme: z.string().optional(),
        notes: z.string().nullable().optional(),
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
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateLearner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name?: string; garden_theme?: string; notes?: string | null; birthdate?: string | null }) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        garden_theme: z.string().optional(),
        notes: z.string().nullable().optional(),
        birthdate: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("learners").update(patch).eq("id", id);
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

    return {
      learner,
      rewards: rewards ?? { stars: 0, current_streak_days: 0, longest_streak: 0, badges_json: [] },
      secureGpcs,
      due_count: (dueGpc ?? 0) + (dueHw ?? 0),
    };
  });
