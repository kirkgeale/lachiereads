import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Full phonics map for a learner
export const getPhonicsMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("learner_gpc_status")
      .select(
        "gpc_id, status, leitner_box, next_due_date, correct_streak, last_seen, gpcs(id, grapheme, sound_label, phase, order_index, type, example_word)",
      )
      .eq("learner_id", data.learner_id)
      .order("gpcs(order_index)", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getHeartWordsMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("learner_heart_word_status")
      .select("heart_word_id, status, leitner_box, correct_streak, heart_words(id, word, order_index)")
      .eq("learner_id", data.learner_id)
      .order("heart_words(order_index)", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getInterferenceMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("learner_interference_status")
      .select("interference_id, status, interference_items(id, grapheme, swedish_value, english_value, note, example_word)")
      .eq("learner_id", data.learner_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getProgressTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; subject?: "reading" | "math" | "all" }) =>
    z.object({
      learner_id: z.string().uuid(),
      subject: z.enum(["reading", "math", "all"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const subject = data.subject ?? "all";
    let sQ = context.supabase
      .from("sessions")
      .select("id, date, duration_seconds, parent_notes, subject")
      .eq("learner_id", data.learner_id)
      .order("date", { ascending: true });
    if (subject !== "all") sQ = sQ.eq("subject", subject);
    const { data: sessions, error } = await sQ;
    if (error) throw new Error(error.message);

    // Fetch events per session
    const ids = (sessions ?? []).map((s: any) => s.id);
    let events: any[] = [];
    if (ids.length) {
      const { data: evs } = await context.supabase
        .from("session_events")
        .select("session_id, outcome, item_type")
        .in("session_id", ids);
      events = evs ?? [];
    }

    // Cumulative secure counts — reading vs math
    const { data: gpcStatus } = await context.supabase
      .from("learner_gpc_status")
      .select("status")
      .eq("learner_id", data.learner_id);
    const { data: mathStatus } = await context.supabase
      .from("learner_math_status")
      .select("status")
      .eq("learner_id", data.learner_id);

    const readingSecure = (gpcStatus ?? []).filter((r: any) => r.status === "secure").length;
    const readingPractising = (gpcStatus ?? []).filter((r: any) => r.status === "practising").length;
    const readingLearning = (gpcStatus ?? []).filter((r: any) => r.status === "learning").length;
    const mathSecure = (mathStatus ?? []).filter((r: any) => r.status === "secure").length;
    const mathPractising = (mathStatus ?? []).filter((r: any) => r.status === "practising").length;
    const mathLearning = (mathStatus ?? []).filter((r: any) => r.status === "learning").length;

    const useMath = subject === "math";
    return {
      sessions: (sessions ?? []).map((s: any) => {
        const evs = events.filter((e) => e.session_id === s.id);
        return {
          ...s,
          total_events: evs.length,
          got_it: evs.filter((e) => e.outcome === "got_it").length,
          self_corrected: evs.filter((e) => e.outcome === "self_corrected").length,
          prompted: evs.filter((e) => e.outcome === "prompted").length,
          hesitated: evs.filter((e) => e.outcome === "hesitated").length,
          missed: evs.filter((e) => e.outcome === "missed").length,
        };
      }),
      subject,
      secure_count: useMath ? mathSecure : readingSecure,
      practising_count: useMath ? mathPractising : readingPractising,
      learning_count: useMath ? mathLearning : readingLearning,
      reading: { secure: readingSecure, practising: readingPractising, learning: readingLearning },
      math: { secure: mathSecure, practising: mathPractising, learning: mathLearning },
    };
  });


// BENCHMARKS
export const saveBenchmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; scores: Record<string, unknown>; notes?: string | null }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        scores: z.record(z.string(), z.any()),
        notes: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("benchmarks")
      .insert({ learner_id: data.learner_id, scores_json: data.scores, notes: data.notes ?? null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listBenchmarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("benchmarks")
      .select("*")
      .eq("learner_id", data.learner_id)
      .order("date", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
