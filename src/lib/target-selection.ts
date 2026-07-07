// Shared next-target selection used by BOTH startSession and finalizeAssessment.
// Keep the query and promotion behaviour identical so the two paths cannot drift.
//
// Rule (must mirror startSession):
//   1. First `learning` GPC by gpcs.order_index — if any, that's the target.
//   2. Otherwise pick the first `not_started` GPC by gpcs.order_index,
//      promote it to `learning`, and return it.
//   3. Otherwise null (nothing to teach).

export interface NextTarget {
  id: string;
  grapheme: string;
  sound_label: string;
  example_word: string;
}

export async function selectNextTarget(supabase: any, learner_id: string): Promise<NextTarget | null> {
  const { data: learningRows, error: learningError } = await supabase
    .from("learner_gpc_status")
    .select("gpc_id, gpcs(id, grapheme, sound_label, example_word, order_index)")
    .eq("learner_id", learner_id)
    .eq("status", "learning")
    .limit(50);
  if (learningError) throw new Error(learningError.message);
  const learning = [...(learningRows ?? [])].sort(
    (a: any, b: any) => ((a.gpcs?.order_index ?? 0) as number) - ((b.gpcs?.order_index ?? 0) as number),
  )[0];

  if (learning) {
    return {
      id: learning.gpc_id,
      grapheme: (learning as any).gpcs.grapheme,
      sound_label: (learning as any).gpcs.sound_label,
      example_word: (learning as any).gpcs.example_word,
    };
  }

  const { data: nextRows, error: nextError } = await supabase
    .from("learner_gpc_status")
    .select("gpc_id, gpcs(id, grapheme, sound_label, example_word, order_index)")
    .eq("learner_id", learner_id)
    .eq("status", "not_started")
    .limit(100);
  if (nextError) throw new Error(nextError.message);
  const next = [...(nextRows ?? [])].sort(
    (a: any, b: any) => ((a.gpcs?.order_index ?? 0) as number) - ((b.gpcs?.order_index ?? 0) as number),
  )[0];

  if (!next) return null;

  const { error: updateError } = await supabase
    .from("learner_gpc_status")
    .update({ status: "learning" })
    .eq("learner_id", learner_id)
    .eq("gpc_id", next.gpc_id);
  if (updateError) throw new Error(updateError.message);

  return {
    id: next.gpc_id,
    grapheme: (next as any).gpcs.grapheme,
    sound_label: (next as any).gpcs.sound_label,
    example_word: (next as any).gpcs.example_word,
  };
}
