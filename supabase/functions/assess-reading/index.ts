// Reading Garden - AI-guided reading level assessment
// Two actions:
//   { action: "plan",   learner: {...} }               -> ordered probe battery
//   { action: "report", learner: {...}, results: [...] } -> report + updates
//
// Uses claude-sonnet-4-5 with extended thinking for careful, best-practice
// synthetic-phonics judgement.

const CLAUDE_MODEL = "claude-opus-4-8";
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

const PLAN_SYSTEM = `You are a reading-assessment expert grounded in synthetic phonics (Letters and Sounds phases 2-5, Reading Rope, UK Phonics Screening Check, and one-to-one running-record procedure). You design a THOROUGH battery of probes to reliably establish a young learner's decoding level.

Rules:
- Probes go from EASIEST to HARDEST and cover, with MULTIPLE probes per pattern so a single miss doesn't misclassify:
  * short-vowel single-letter GPCs (2-3 items)
  * common consonants incl. blends (2-3 items)
  * CVC blending (3-4 items)
  * digraphs sh, ch, th, ck, ng, ll, ss, ff (3-4 items)
  * long-vowel patterns: split digraphs a_e/i_e/o_e/u_e, vowel teams ai, ee, oa, igh, oo, ay, oy (4-5 items)
  * heart / tricky words at appropriate level (3-4 items)
  * pseudowords (nonsense but pronounceable, isolate decoding from sight memory) (2-3 items)
  * TWO short decodable sentences at plausible level (running-record style, listen for fluency)
- Use ONLY graphemes and heart words that appear in the provided catalog.
- Weight toward the likely level but ALWAYS include one probe two phases above the likely level and one two below — needed to confirm the ceiling and floor.
- **24-32 probes total.** Never repeat the same target twice.
- Include probes that surface known Swedish-English interference (e.g. 'i', 'e', 'j', 'a') when relevant.
- The child is ~7 years old and reads Swedish, so keep prompts extremely short and calm.

Return STRICT JSON only, no code fences:
{ "probes": [ { "id": "p1", "kind": "grapheme_sound", "prompt": "s", "target_grapheme": "s", "difficulty": 1, "notes": "listen for /s/" }, ... ] }`;

const REPORT_SYSTEM = `You write a reading progress report for a PARENT — not a teacher, not a specialist. The parent has no phonics training. Your job is to be COMPLETE, HONEST, and CONCRETE in **everyday language**.

STRICT LANGUAGE RULES — do not use any of these words: grapheme, phoneme, GPC, decode/decoding, digraph, split digraph, trigraph, vowel team, blend (as a noun), segmentation, CVC, CCVC, pseudoword, phase 2/3/4/5, tricky word, heart word, orthographic, phonemic. If you must reference such a concept, translate to plain English (e.g. "the 'sh' sound", "made-up words we use to check they're really reading", "letters that team up like 'ai' to make one sound"). Use single quotes around letters and letter-teams.

Do NOT compare the child to national curriculum milestones, school-year expectations, or any age-equivalent reading level. Do NOT estimate what a "typical" child of this age can do. Focus only on what THIS child did in the assessment, and — where relevant — how it compares to their own prior assessments.

READING THE PROBE RESULTS (do this before you write):
- Look at what the child mostly succeeds at across the probes. That is their working level.
- A miss on a probe clearly ABOVE that working level (a "ceiling" probe, included on purpose to find the edge) is a NORMAL, EXPECTED miss — describe it neutrally in not_yet as "we haven't got here yet", NOT as a concern in working_on.
- A miss on something AT OR BELOW the working level is a genuine gap — put it in working_on with the concrete example word or letter-team.
- For sentence- or passage-level probes, describe them using exactly this three-way frame, with the specific example:
    * "read smoothly and independently" (no help needed),
    * "read correctly but needed a nudge or prompt", or
    * "found it too hard right now".
  Use one of these three plainly rather than a vague "needed prompting".

COMPARISON TO PRIOR ASSESSMENT:
- If previous_assessment IS provided, your plain_summary's LAST sentence must name what has concretely changed since then — e.g. "Since last time, the 'th' sound has gone from shaky to solid, and sentence reading has just started." If nothing meaningfully changed, say so honestly rather than inventing progress.
- If previous_assessment is NOT provided, this is the child's FIRST assessment — say so plainly (e.g. "This is our first proper check-in, so there's nothing yet to compare it to.") instead of implying a comparison.

HEDGE (required, one sentence):
- Somewhere in plain_summary (top or bottom, whichever reads more naturally), include a brief warm reminder that this is a snapshot from one sitting, not a fixed verdict — e.g. "This is what we saw today — a good check-in, not the full picture."

Structure to hit (all fields required — never leave any blank):
- estimated_level: internal short tag (this one CAN contain phase language, it's for the app only, not shown prominently)
- plain_summary: 2-3 short paragraphs, ~150 words total, describing what happened in the assessment and what it tells us about where the child is right now with reading. Warm, honest, specific. Must include the hedge sentence AND (if previous_assessment provided) end with the change-since-last-time sentence.
- what_they_can_do: 4-8 bullet strings, each a concrete skill in plain language (e.g. "Reads short words like 'cat', 'sun', 'top' cleanly on the first try", "Knows the sound 'sh' makes and can read 'ship', 'shop'"). Do NOT list letters in isolation — always show them in a word or say the sound out loud (e.g. /sh/ as in 'ship'). Distinguish accuracy ("gets it right") from independence ("gets it right without any help") from fluency ("reads it smoothly, not letter-by-letter") when the evidence supports it.
- working_on: 3-6 bullet strings — patterns/skills that are shaky AT OR BELOW the working level. Same plain style with concrete examples.
- not_yet: 2-4 bullet strings — patterns the child hasn't been taught yet or hasn't met in the assessment, INCLUDING deliberate ceiling probes they missed. Keep neutral: "we haven't looked at this yet".
- parent_actions_this_week: 3-5 concrete things the parent can do this week. Each starts with a verb ("Read together for 5 minutes each day using..."). No jargon.
- next_focus: (WRITTEN BY YOU, but the target is CHOSEN BY THE APP) — 2-3 warm plain-English sentences narrating the specific grapheme in actual_next_target as what comes next. Use that exact letter/letter-team and its example word. Do NOT pick a different sound even if another one looks more prominent in the results — the app has already decided this deterministically. If no actual_next_target is provided, write a general 2-3 sentence "keep reading together" note instead.
- gpc_updates: [ { "grapheme": "sh", "status": "secure|practising|learning|not_started" } ] — updates for the app's internal plan. This IS technical, it's for the app.
- heart_word_updates: [ { "word": "the", "status": "..." } ] — same.

Return STRICT JSON only, no code fences. Be thorough, not brief — the parent wants a full picture, but every sentence must be easy to read.`;

const NEXT_FOCUS_SYSTEM = `You write a very short "what comes next" note for a parent, using PLAIN English (no phonics jargon — no "grapheme", "phoneme", "digraph", "phase", "GPC", "decoding"). Use single quotes around letters/letter-teams.

The app has ALREADY chosen the exact letter or letter-team to focus on next — it is given to you as actual_next_target. Your ONLY job is to write 2-3 warm sentences naming THAT specific sound as the next focus, using its example word. Do not substitute or add another sound.

Return STRICT JSON only, no code fences: { "next_focus": "..." }`;

async function callClaude(system: string, user: string, opts?: { thinking?: boolean; max_tokens?: number }): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const useThinking = opts?.thinking !== false;
  const body: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: opts?.max_tokens ?? MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (useThinking) {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: "high" };
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("[assess-reading] anthropic error", res.status, t);
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 200)}`);
  }
  const payload = await res.json();
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
      const prev = body.previous_assessment as
        | {
            estimated_level: string | null;
            summary: string | null;
            previously_working_on: string[];
            previously_not_yet: string[];
            days_since: number;
          }
        | undefined
        | null;

      const prevBlock = prev
        ? `\nPREVIOUS ASSESSMENT (from ${prev.days_since} day(s) ago):\n` +
          `  - estimated_level: ${prev.estimated_level ?? "n/a"}\n` +
          `  - summary: ${prev.summary ?? "n/a"}\n` +
          `  - was working on: ${(prev.previously_working_on ?? []).join(" | ") || "n/a"}\n` +
          `  - was not yet: ${(prev.previously_not_yet ?? []).join(" | ") || "n/a"}\n`
        : `\nPREVIOUS ASSESSMENT: none — this is the child's FIRST assessment. Do not imply a comparison; say so plainly.\n`;

      const userMsg =
        `Learner: ${learner.name}, age ~${learner.age_years ?? "?"}. Native English speaker, learning to read (formal instruction in Swedish).\n` +
        `Interference to note when relevant:\n` +
        learner.interference_pairs.map((p) => `  ${p.grapheme}: SV=${p.swedish_value} / EN=${p.english_value}`).join("\n") + "\n" +
        prevBlock +
        `\nAssessment probe results (in order administered):\n` +
        results.map((r, i) =>
          `  ${i + 1}. [${r.kind} d${r.difficulty}] "${r.prompt}"` +
            (r.target_grapheme ? ` (target grapheme: ${r.target_grapheme})` : "") +
            (r.target_heart_word ? ` (heart word: ${r.target_heart_word})` : "") +
            ` -> ${r.outcome}`,
        ).join("\n") +
        `\n\nWrite the report and propose updates now. Remember: a miss on a probe well above the child's working level is a ceiling-probe miss and belongs in not_yet neutrally, not in working_on. For next_focus: this call does NOT include actual_next_target — write next_focus as a general "keep reading together" note. The app will overwrite it with a targeted version after the real next-target is computed.`;
      const text = await callClaude(REPORT_SYSTEM, userMsg);
      const parsed = parseJson(text);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (body.action === "next_focus") {
      const learner = body.learner as LearnerCtx;
      const target = body.actual_next_target as { grapheme: string; sound_label: string; example_word: string };
      if (!target?.grapheme) {
        return new Response(JSON.stringify({ error: "actual_next_target required" }), {
          status: 400,
          headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
      const userMsg =
        `Learner: ${learner.name}, age ~${learner.age_years ?? "?"}.\n` +
        `The app has decided the next focus for the very next session. Write next_focus for THIS exact target:\n` +
        `  - letter/letter-team: ${target.grapheme}\n` +
        `  - sound: ${target.sound_label}\n` +
        `  - example word: ${target.example_word}\n` +
        `\n2-3 warm sentences. Name this exact sound. Do not substitute another sound.`;
      const text = await callClaude(NEXT_FOCUS_SYSTEM, userMsg, { thinking: false, max_tokens: 400 });
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
