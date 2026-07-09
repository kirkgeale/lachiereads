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

// ---------------------------------------------------------------------------
// MATH SIDE — parallels selectNextTarget above. Same promotion behaviour so
// the math session and math assessment cannot pick different targets.
export interface NextMathTarget {
  id: string;
  code: string;
  name: string;
  description: string;
  strand: string;
  phase: number;
  self_gradable: boolean;
  max_value: number;
  example_problem: string | null;
}

export async function selectNextMathTarget(supabase: any, learner_id: string): Promise<NextMathTarget | null> {
  const cols = "skill_id, math_skills(id, code, name, description, strand, phase, order_index, self_gradable, max_value, example_problem)";

  const { data: learningRows, error: le } = await supabase
    .from("learner_math_status")
    .select(cols)
    .eq("learner_id", learner_id)
    .eq("status", "learning")
    .limit(50);
  if (le) throw new Error(le.message);
  const learning = [...(learningRows ?? [])].sort(
    (a: any, b: any) => ((a.math_skills?.order_index ?? 0) as number) - ((b.math_skills?.order_index ?? 0) as number),
  )[0];

  const mapRow = (r: any): NextMathTarget => ({
    id: r.math_skills.id,
    code: r.math_skills.code,
    name: r.math_skills.name,
    description: r.math_skills.description,
    strand: r.math_skills.strand,
    phase: r.math_skills.phase,
    self_gradable: !!r.math_skills.self_gradable,
    max_value: r.math_skills.max_value,
    example_problem: r.math_skills.example_problem ?? null,
  });

  if (learning) return mapRow(learning);

  const { data: nextRows, error: ne } = await supabase
    .from("learner_math_status")
    .select(cols)
    .eq("learner_id", learner_id)
    .eq("status", "not_started")
    .limit(200);
  if (ne) throw new Error(ne.message);
  const next = [...(nextRows ?? [])].sort(
    (a: any, b: any) => ((a.math_skills?.order_index ?? 0) as number) - ((b.math_skills?.order_index ?? 0) as number),
  )[0];
  if (!next) return null;

  const { error: upErr } = await supabase
    .from("learner_math_status")
    .update({ status: "learning" })
    .eq("learner_id", learner_id)
    .eq("skill_id", next.skill_id);
  if (upErr) throw new Error(upErr.message);

  return mapRow(next);
}

