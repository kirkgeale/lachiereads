// Reading Garden - AI content generation via Anthropic (Claude Sonnet)
// Produces short, decodable English reading practice tailored to the learner's
// current level, target grapheme, recent misses, and Swedish-English interference.

const CLAUDE_MODEL = "claude-sonnet-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InterferencePair {
  grapheme: string;
  swedish_value: string;
  english_value: string;
}

interface Req {
  type: "word_list" | "sentence" | "story" | "game_words" | "pseudowords" | "lesson_bundle";
  allowed_graphemes: string[];
  known_heart_words: string[];

  // Personalisation (all optional so the function stays backward-compatible)
  age_years?: number | null;
  target_grapheme?: string | null;
  target_sound_label?: string | null;
  recent_misses?: string[];            // words / graphemes the learner missed lately
  interference_pairs?: InterferencePair[];
  strengths?: string[];                // graphemes/heart-words the learner reliably nails
  challenges?: string[];               // graphemes/heart-words that are shaky or freshly missed
  current_phase?: number | null;       // synthetic-phonics phase, 1..5
  interests?: string | null;           // free-form child interests, e.g. "dinosaurs, football, space"
  parent_observations?: string[];      // recent parent notes from prior sessions (soft context)
  count?: number | null;               // optional dynamic size for word_list / game_words (default 8, clamped 4-16)
}

const SYSTEM = `You write extremely short, calm, wholesome English reading practice for a ~7-year-old native English speaker who is being formally schooled in Swedish and is now learning to DECODE English via synthetic phonics.

Non-negotiable rules:
1. STRICT DECODABILITY. Every word must either (a) be composed only from the allowed graphemes provided, or (b) be one of the heart words provided. Never introduce a new grapheme or a word the child cannot decode yet. Interests and parent observations NEVER override this rule.
2. Prefer 2-5 letter words. Blends are fine when their letters are in the allowed set.
3. If a target grapheme is provided, HEAVILY feature it: at least half of the words in a word list should contain it; a sentence should include it at least twice when natural.
4. If recent misses are provided, include 1-2 gentle re-exposures of those patterns (do NOT stack them; embed in easy contexts).
5. If Swedish-English interference pairs are provided, favour minimal-pair contrasts on those graphemes to reinforce the English value (e.g. for 'i' short: sit / bit / fin, not Swedish-flavoured contexts).
6. CALIBRATE DIFFICULTY per dimension using the learner's strengths and challenges:
   - STRENGTHS (reliably correct): stretch them — use longer words, more of them per sentence, denser blends, or trickier positions (initial/medial/final). Do not baby-step areas the child owns.
   - CHALLENGES (shaky or freshly missed): keep contexts short and easy, isolate one hard element at a time, and re-expose gently. Never combine two challenge items in the same word.
   - Absent strengths/challenges means "unknown yet" — pitch at a neutral baseline.
7. THEMES: if the learner's interests are provided, prefer those interests as the theme of the words, sentence, and story — keep it calm, wholesome and age-appropriate. If no interests are provided, fall back to nature, animals, garden, and everyday small moments. Nothing scary, no wordplay, no idioms, no cultural in-jokes.
8. PARENT OBSERVATIONS (soft context): if provided, treat them as gentle signals — a specific confusion, a mood note, or a topic the child loved. Gently bias the lesson accordingly (e.g. a slightly shorter set if "tired"; re-expose a pattern the parent flagged). Never break decodability or the target focus to accommodate them.
9. Sentences and stories must sound like natural English a child would actually say. No word salad.
10. Return ONLY strict JSON matching the requested schema. No prose, no code fences, no commentary.
11. VARIETY IS MANDATORY. Do NOT reuse the same practice words across sessions. A child must decode fresh words each time, not memorise a fixed set. Draw broadly from the full range of decodable words the allowed graphemes permit — vary the initial letter, the ending, and the theme within the interests. If a target grapheme is provided, feature it heavily (rule 3), but never with the same word list twice.`;

function buildPrompt(r: Req): string {
  const gs = r.allowed_graphemes.join(", ");
  const hs = r.known_heart_words.join(", ");
  const parts: string[] = [];
  parts.push(`Allowed graphemes: [${gs}]`);
  parts.push(`Allowed heart words: [${hs}]`);
  if (r.age_years != null) parts.push(`Learner age: ~${r.age_years} years`);
  if (r.current_phase != null) parts.push(`Current synthetic-phonics phase: ${r.current_phase}`);
  if (r.target_grapheme) {
    parts.push(`TARGET grapheme this session: "${r.target_grapheme}"${r.target_sound_label ? ` (sound: ${r.target_sound_label})` : ""}. Feature it heavily.`);
  }
  if (r.recent_misses?.length) {
    parts.push(`Recent misses / hesitations to gently re-expose: [${r.recent_misses.slice(0, 8).join(", ")}]`);
  }
  if (r.strengths?.length) {
    parts.push(
      `Learner STRENGTHS (reliably correct — stretch difficulty here; use longer words, denser blends, or feature these prominently): [${r.strengths.slice(0, 20).join(", ")}]`,
    );
  }
  if (r.challenges?.length) {
    parts.push(
      `Learner CHALLENGES (shaky — keep easy, isolate, gentle re-exposure, never combine two in one word): [${r.challenges.slice(0, 20).join(", ")}]`,
    );
  }
  if (r.interference_pairs?.length) {
    parts.push(
      "Swedish->English interference to counter (favour minimal pairs on the English sound):\n" +
        r.interference_pairs.map((p) => `  ${p.grapheme}: SV=${p.swedish_value}  EN=${p.english_value}`).join("\n"),
    );
  }
  if (r.interests && r.interests.trim()) {
    parts.push(`Learner INTERESTS (prefer as theme; keep calm & age-appropriate; NEVER break decodability): ${r.interests.trim()}`);
  }
  if (r.parent_observations?.length) {
    parts.push(
      "Recent PARENT OBSERVATIONS (soft context — gentle nudges only):\n" +
        r.parent_observations.slice(0, 5).map((n) => `  - ${n}`).join("\n"),
    );
  }
  const common = "\n" + parts.join("\n") + "\nRULE: every letter of every word must be part of one allowed grapheme or the word must be in the heart-word list.\n";

  const clampCount = (n: number | null | undefined, def: number) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return def;
    return Math.max(4, Math.min(16, Math.round(n)));
  };

  switch (r.type) {
    case "word_list": {
      const count = clampCount(r.count, 8);
      return `Produce ${count} short decodable English words for practice, ordered easiest to hardest.${common}Return JSON: {"words": ["...", ... ${count} items]}`;
    }
    case "game_words": {
      const count = clampCount(r.count, 8);
      return `Produce ${count} short decodable English words suitable for a quick tap-the-word game.${common}Return JSON: {"words": ["...", ... ${count} items]}`;
    }
    case "pseudowords":
      return `Produce 6 short pseudowords (nonsense but pronounceable) for decoding practice.${common}Return JSON: {"words": ["...", "..."]}`;
    case "sentence":
      return `Produce ONE short, calm, natural decodable sentence (4-7 words) a 7-year-old would say.${common}Return JSON: {"sentence": "..."}`;
    case "story":
      return `Produce a very short calm decodable mini-story (3-5 short sentences, natural English).${common}Return JSON: {"story": "..."}`;
    case "lesson_bundle": {
      const focusRule = r.target_grapheme
        ? `The lesson focus IS the provided target grapheme "${r.target_grapheme}"${r.target_sound_label ? ` (sound: ${r.target_sound_label})` : ""}. Do NOT choose a different focus. focus.title, focus.concept, and focus.examples MUST all be about this exact target sound/letter-team. blend_words and practice_words must heavily feature it.`
        : `No target grapheme provided — CHOOSE the focus yourself: if challenges are non-empty, pick one shaky pattern to reinforce; else pick a natural next step (a blend, a longer word, a fluency focus). Then align every component with that chosen focus.`;
      return `Design a COMPLETE single lesson for this learner in ONE response.

Focus rule:
- ${focusRule}
- The "concept" is a plain-English 1-sentence description of what the child will practise.
- "parent_intro" is 2-3 short sentences the PARENT reads/says to the child before starting — introduces the concept warmly, models the sound if relevant, mentions how it will look in words.
- "examples" are 2-4 mouth-friendly example words featuring the focus (must be decodable with allowed graphemes).

DIFFICULTY LADDER within this bundle (MUST be respected):
- "guided_words" (2-3 words) are the EASIEST target-featuring items — use ONLY the target grapheme plus already-secure/simple sounds. Fully supported confidence-builders. MUST be easier than blend_words.
- "blend_words" (6 words) are next, easy→harder, target-featuring.
- "practice_words" (14 words) mix target with general review — provide a wide variety of DIFFERENT words (vary initial letter, ending, and theme). Do not repeat words across guided_words / blend_words.
- "repetition_words" (5 words) are for spaced within-session review a few minutes after practice. Pick 5 target-featuring words that DIFFER from guided_words/blend_words/practice_words/challenge_item. Same target sound, fresh contexts — this is how the sound cements.
- "challenge_item" is ONE word that is strictly HARDER / LESS FAMILIAR than every other word in this bundle. It must apply the target in a less-drilled way (e.g. combine target with another already-taught but less-drilled pattern), NOT appear in focus.examples/guided_words/blend_words/practice_words/repetition_words, and must still be fully decodable from allowed graphemes. "Harder" means less familiar, NEVER undecodable. Provide a short "note" (one phrase) on what makes it a bit harder.
- "recap_item" is a single short word or 2-word phrase featuring the target grapheme, DIFFERENT from every other word used elsewhere in this bundle (focus.examples, guided_words, blend_words, practice_words, repetition_words, challenge_item, sentence, story). It is used near the end for a no-support recap check.

Now produce every list, keeping to the non-negotiable decodability rules.${common}Return STRICT JSON only:
{
  "focus": {
    "title": "short 2-4 word label",
    "concept": "one-sentence plain-English description of the focus",
    "parent_intro": "2-3 short sentences the parent reads to the child",
    "examples": ["word1","word2","word3"]
  },
  "guided_words": ["2-3 easiest target-featuring words, fully supported"],
  "blend_words": ["6 short target-featuring words easy→harder"],
  "practice_words": ["14 decodable words, mix of target and general practice, all distinct"],
  "repetition_words": ["5 target-featuring words for delayed within-session review, distinct from other lists"],
  "challenge_item": { "word": "one harder word", "note": "one short phrase on what makes it a bit harder" },
  "sentence": "ONE short natural decodable sentence (4-7 words)",
  "story": "3-5 sentence calm decodable mini-story",
  "recap_item": "single short word or 2-word phrase featuring the target, unique in this bundle",
  "flashcard_decodable": ["8 short decodable words for quick flashcard drilling"]
}`;
    }
  }
}

async function requireUser(req: Request): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) {
    return new Response(JSON.stringify({ error: "server auth not configured" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "content-type": "application/json" },
  });
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authErr = await requireUser(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as Req;
    if (!body.allowed_graphemes?.length) {
      return new Response(JSON.stringify({ error: "no allowed graphemes" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }


    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "missing ANTHROPIC_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const prompt = buildPrompt(body);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: body.type === "lesson_bundle" ? 2000 : 700,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("[generate-content] anthropic non-ok", res.status, t);
      return new Response(JSON.stringify({ error: "anthropic_error", detail: t }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const payload = await res.json();
    const text: string = payload?.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { error: "parse_error", raw: clean };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-content] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
