import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateContentInternal } from "./content-helper";

// Regenerate content on demand (parent dashboard button)
export const regenerateContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; type: "word_list" | "sentence" | "story" | "game_words" | "pseudowords" }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        type: z.enum(["word_list", "sentence", "story", "game_words", "pseudowords"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: reached } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, gpcs(grapheme)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const allowedGraphemes = (reached ?? []).map((r: any) => r.gpcs.grapheme as string);
    const allowedGpcIds = (reached ?? []).map((r: any) => r.gpc_id as string);
    const { data: hws } = await supabase
      .from("learner_heart_word_status")
      .select("heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const knownHeartWords = (hws ?? []).map((r: any) => r.heart_words.word as string);

    // clear cache for this type then regenerate
    await supabase
      .from("generated_content")
      .delete()
      .eq("learner_id", data.learner_id)
      .eq("type", data.type);

    return generateContentInternal({
      supabase,
      learner_id: data.learner_id,
      type: data.type,
      allowedGraphemes,
      allowedGpcIds,
      knownHeartWords,
    });
  });

// Manually override a GPC status
export const overrideGpcStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; gpc_id: string; status: "not_started" | "learning" | "practising" | "secure" }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        gpc_id: z.string().uuid(),
        status: z.enum(["not_started", "learning", "practising", "secure"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const boxByStatus = { not_started: 1, learning: 1, practising: 3, secure: 5 } as const;
    const { error } = await context.supabase
      .from("learner_gpc_status")
      .update({
        status: data.status,
        leitner_box: boxByStatus[data.status],
        correct_streak: data.status === "secure" ? 1 : 0,
        next_due_date: new Date().toISOString().slice(0, 10),
      })
      .eq("learner_id", data.learner_id)
      .eq("gpc_id", data.gpc_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setInterferenceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; interference_id: string; status: "still_confuses" | "resolving" | "secure" }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        interference_id: z.string().uuid(),
        status: z.enum(["still_confuses", "resolving", "secure"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("learner_interference_status")
      .update({ status: data.status })
      .eq("learner_id", data.learner_id)
      .eq("interference_id", data.interference_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
