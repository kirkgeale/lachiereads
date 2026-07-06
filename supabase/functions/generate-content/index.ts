// Reading Garden - AI content generation via Anthropic (Claude Sonnet 4.5)
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
}

const SYSTEM = `You write extremely short, calm, wholesome English reading practice for a ~7-year-old native English speaker who is being formally schooled in Swedish and is now learning to DECODE English via synthetic phonics.

Non-negotiable rules:
1. STRICT DECODABILITY. Every word must either (a) be composed only from the allowed graphemes provided, or (b) be one of the heart words provided. Never introduce a new grapheme or a word the child cannot decode yet.
2. Prefer 2-5 letter words. Blends are fine when their letters are in the allowed set.
3. If a target grapheme is provided, HEAVILY feature it: at least half of the words in a word list should contain it; a sentence should include it at least twice when natural.
4. If recent misses are provided, include 1-2 gentle re-exposures of those patterns (do NOT stack them; embed in easy contexts).
5. If Swedish-English interference pairs are provided, favour minimal-pair contrasts on those graphemes to reinforce the English value (e.g. for 'i' short: sit / bit / fin, not Swedish-flavoured contexts).
6. CALIBRATE DIFFICULTY per dimension using the learner's strengths and challenges:
   - STRENGTHS (reliably correct): stretch them — use longer words, more of them per sentence, denser blends, or trickier positions (initial/medial/final). Do not baby-step areas the child owns.
   - CHALLENGES (shaky or freshly missed): keep contexts short and easy, isolate one hard element at a time, and re-expose gently. Never combine two challenge items in the same word.
   - Absent strengths/challenges means "unknown yet" — pitch at a neutral baseline.
7. Themes: nature, animals, garden, everyday small moments. Nothing scary, no wordplay, no idioms, no cultural in-jokes.
8. Sentences and stories must sound like natural English a child would actually say. No word salad.
9. Return ONLY strict JSON matching the requested schema. No prose, no code fences, no commentary.`;

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
  const common = "\n" + parts.join("\n") + "\nRULE: every letter of every word must be part of one allowed grapheme or the word must be in the heart-word list.\n";

  switch (r.type) {
    case "word_list":
      return `Produce 8 short decodable English words for practice, ordered easiest to hardest.${common}Return JSON: {"words": ["...", "..."]}`;
    case "game_words":
      return `Produce 8 short decodable English words suitable for a quick tap-the-word game.${common}Return JSON: {"words": ["...", "..."]}`;
    case "pseudowords":
      return `Produce 6 short pseudowords (nonsense but pronounceable) for decoding practice.${common}Return JSON: {"words": ["...", "..."]}`;
    case "sentence":
      return `Produce ONE short, calm, natural decodable sentence (4-7 words) a 7-year-old would say.${common}Return JSON: {"sentence": "..."}`;
    case "story":
      return `Produce a very short calm decodable mini-story (3-5 short sentences, natural English).${common}Return JSON: {"story": "..."}`;
    case "lesson_bundle":
      return `Design a COMPLETE single lesson for this learner in ONE response. First DECIDE the lesson's focus area — could be the given target grapheme, a shaky pattern from challenges, a blend type they're ready for, a sound-contrast the interference list flags, or a sentence-fluency focus if they're at that phase. Then produce every component of the lesson consistent with that focus.

Focus decision rules:
- If a target grapheme is provided AND it's genuinely new/shaky, focus there.
- Else if challenges are non-empty, pick one shaky pattern to reinforce.
- Else pick a natural next step (a blend, a longer word, a fluency focus).
- The "concept" is a plain-English 1-sentence description of what the child will practise.
- "parent_intro" is 2-3 short sentences the PARENT reads/says to the child before starting — introduces the concept warmly, models the sound if relevant, mentions how it will look in words.
- "examples" are 2-4 mouth-friendly example words featuring the focus (must be decodable with allowed graphemes).

Now produce every list, keeping to the non-negotiable decodability rules.${common}Return STRICT JSON only:
{
  "focus": {
    "title": "short 2-4 word label",
    "concept": "one-sentence plain-English description of the focus",
    "parent_intro": "2-3 short sentences the parent reads to the child",
    "examples": ["word1","word2","word3"]
  },
  "blend_words": ["5 short target-featuring words easy→harder"],
  "practice_words": ["8 decodable words, mix of target and general practice"],
  "sentence": "ONE short natural decodable sentence (4-7 words)",
  "story": "3-5 sentence calm decodable mini-story",
  "flashcard_decodable": ["8 short decodable words for quick flashcard drilling"]
}`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
