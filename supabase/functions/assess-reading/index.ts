// Reading Garden - AI-guided reading level assessment
// Two actions:
//   { action: "plan",   learner: {...} }               -> ordered probe battery
//   { action: "report", learner: {...}, results: [...] } -> report + updates
//
// Uses claude-sonnet-4-5 with extended thinking for careful, best-practice
// synthetic-phonics judgement.

const CLAUDE_MODEL = "claude-sonnet-4-5";
const THINKING_BUDGET = 4000;
const MAX_TOKENS = 6000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LearnerCtx {
  name: string;
  age_years: number | null;
  garden_theme?: string;
  known_graphemes: string[];       // graphemes the learner has reached (any status)
  secure_graphemes: string[];
  known_heart_words: string[];
  interference_pairs: { grapheme: string; swedish_value: string; english_value: string }[];
  all_graphemes: { grapheme: string; sound_label: string; phase: number; example_word: string }[];
  all_heart_words: string[];
}

interface Probe {
  id: string;                       // unique
  kind: "grapheme_sound" | "cvc_word" | "digraph_word" | "vcv_word" | "heart_word" | "sentence" | "pseudoword";
  prompt: string;                   // what the parent shows the child
  target_grapheme?: string;         // matches an entry in all_graphemes.grapheme (if applicable)
  target_heart_word?: string;
  difficulty: number;               // 1 (easiest) .. 5 (hardest)
  notes?: string;                   // for parent: what to listen for
}

interface ProbeResult extends Probe {
  outcome: "correct" | "hesitated" | "missed" | "skipped";
}

const PLAN_SYSTEM = `You are a reading-assessment expert grounded in synthetic phonics (Letters and Sounds phases 2-5, Reading Rope, and best-practice one-to-one running-record procedures). You design a SHORT but robust battery of probes to establish a young learner's decoding level as efficiently as possible.

Rules:
- Probes go from EASIEST to HARDEST and cover: single-letter GPCs (short vowels, common consonants), CVC blending, common digraphs (sh, ch, th, ck, ng), long-vowel patterns (split digraphs a_e/i_e/o_e, vowel teams ai, ee, oa, igh), heart/tricky words, and finally a short sentence.
- Use ONLY graphemes and heart words that appear in the provided catalog.
- Prefer probes that discriminate near the likely level. If the learner's known set is small, weight toward earlier phases; if broad, weight toward digraphs / long-vowel patterns / a short sentence.
- 14-20 probes total. Never repeat the same target twice.
- Include 1-2 pseudowords (nonsense but pronounceable, e.g. "vop", "shup") to isolate decoding from sight memory.
- Include probes that surface known Swedish-English interference (e.g. 'i', 'e', 'j', 'a') when relevant.
- The child is ~7 years old and reads Swedish, so keep prompts extremely short and calm.

Return STRICT JSON only, no code fences:
{ "probes": [ { "id": "p1", "kind": "grapheme_sound", "prompt": "s", "target_grapheme": "s", "difficulty": 1, "notes": "listen for /s/" }, ... ] }`;

const REPORT_SYSTEM = `You are a warm, precise reading tutor writing a report for a parent about a 7-year-old learning to read English. You have the ordered probe results from a live assessment.

Produce a report that is:
- HONEST and specific (name graphemes/patterns confidently secure vs shaky vs not yet).
- Concise: max ~180 words in "summary".
- Warm but not gushing.
- Grounded in synthetic phonics best practice (Letters & Sounds phase framing OK).
- Actionable: give 2-4 concrete next steps for the parent to focus on this week.

Also propose CONCRETE status updates for the learner's internal plan so the app can practice at the right level. Only touch graphemes/heart words that appear in the results OR that logically follow from them (e.g. if all Phase 2 GPCs are secure, promote them). Use these statuses:
- "secure"     : reliably correct + fluent
- "practising" : correct but slow / needs repetition
- "learning"   : still unstable, needs teaching
- "not_started": leave alone / mark not yet introduced

Return STRICT JSON only, no code fences:
{
  "estimated_level": "e.g. 'Late Phase 3 (digraphs secure, split digraphs emerging)'",
  "summary": "...",
  "strengths": ["..."],
  "focus_areas": ["..."],
  "next_steps": ["...", "..."],
  "gpc_updates":       [ { "grapheme": "sh", "status": "secure" } ],
  "heart_word_updates":[ { "word": "the",   "status": "secure" } ]
}`;

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("[assess-reading] anthropic error", res.status, t);
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const payload = await res.json();
  // Extended thinking returns blocks: pick the first "text" block
  const blocks: any[] = payload?.content ?? [];
  const text = blocks.find((b) => b?.type === "text")?.text ?? "";
  return text;
}

function parseJson(text: string): any {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("failed to parse JSON from model output");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body.action === "plan") {
      const learner = body.learner as LearnerCtx;
      const userMsg =
        `Learner context:\n` +
        `- Name: ${learner.name}\n` +
        `- Age (years): ${learner.age_years ?? "unknown"}\n` +
        `- Known graphemes (any status): [${learner.known_graphemes.join(", ")}]\n` +
        `- Secure graphemes: [${learner.secure_graphemes.join(", ")}]\n` +
        `- Known heart words: [${learner.known_heart_words.join(", ")}]\n` +
        `- Swedish-English interference to probe:\n` +
        learner.interference_pairs.map((p) => `    ${p.grapheme}: Swedish=${p.swedish_value} English=${p.english_value}`).join("\n") + "\n" +
        `\nAvailable grapheme catalog (grapheme | sound | phase | example):\n` +
        learner.all_graphemes.map((g) => `  ${g.grapheme} | ${g.sound_label} | Phase ${g.phase} | ${g.example_word}`).join("\n") + "\n" +
        `\nAvailable heart words: [${learner.all_heart_words.join(", ")}]\n` +
        `\nDesign the probe battery now.`;
      const text = await callClaude(PLAN_SYSTEM, userMsg);
      const parsed = parseJson(text);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (body.action === "report") {
      const learner = body.learner as LearnerCtx;
      const results = body.results as ProbeResult[];
      const userMsg =
        `Learner: ${learner.name}, age ~${learner.age_years ?? "?"}. Native English speaker, learning to read (formal instruction in Swedish).\n` +
        `Interference to note when relevant:\n` +
        learner.interference_pairs.map((p) => `  ${p.grapheme}: SV=${p.swedish_value} / EN=${p.english_value}`).join("\n") + "\n" +
        `\nAssessment probe results (in order administered):\n` +
        results.map((r, i) =>
          `  ${i + 1}. [${r.kind} d${r.difficulty}] "${r.prompt}"` +
            (r.target_grapheme ? ` (target grapheme: ${r.target_grapheme})` : "") +
            (r.target_heart_word ? ` (heart word: ${r.target_heart_word})` : "") +
            ` -> ${r.outcome}`,
        ).join("\n") +
        `\n\nWrite the report and propose updates now.`;
      const text = await callClaude(REPORT_SYSTEM, userMsg);
      const parsed = parseJson(text);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[assess-reading] error", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
