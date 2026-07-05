// Reading Garden - AI content generation via Anthropic
// Called by the app to produce short decodable words / sentences / mini-stories
// using ONLY the graphemes and heart words the learner has reached.

const CLAUDE_MODEL = "claude-sonnet-4-5"; // change here to swap model

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Req {
  type: "word_list" | "sentence" | "story" | "game_words" | "pseudowords";
  allowed_graphemes: string[];
  known_heart_words: string[];
}

const SYSTEM = `You write extremely short, calm, wholesome English reading practice for a 7-year-old learning to decode English. All output MUST be strictly decodable: every word must either (a) be composed only from the allowed graphemes given, or (b) be one of the known heart words listed. Themes are gentle: nature, animals, everyday life. Nothing scary, no wordplay, no idioms. Return ONLY strict JSON — no prose, no code fences.`;

function buildPrompt(r: Req): string {
  const gs = r.allowed_graphemes.join(", ");
  const hs = r.known_heart_words.join(", ");
  const common = `\nAllowed graphemes: [${gs}]\nAllowed heart words: [${hs}]\nRULE: every letter of every word must be part of one allowed grapheme or the word must be in the heart-word list. Prefer 2-4 letter words.\n`;
  switch (r.type) {
    case "word_list":
    case "game_words":
      return `Produce 8 short decodable English words for practice.${common}Return JSON: {"words": ["...", "..."]}`;
    case "pseudowords":
      return `Produce 6 short pseudowords (nonsense but pronounceable) for decoding practice.${common}Return JSON: {"words": ["...", "..."]}`;
    case "sentence":
      return `Produce ONE short, calm decodable sentence (4-7 words).${common}Return JSON: {"sentence": "..."}`;
    case "story":
      return `Produce a very short calm decodable mini-story (3-5 short sentences).${common}Return JSON: {"story": "..."}`;
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
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("[anthropic] non-ok", res.status, t);
      return new Response(JSON.stringify({ error: "anthropic_error", detail: t }), {
        status: 502,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const payload = await res.json();
    const text: string = payload?.content?.[0]?.text ?? "";
    // Strip any code fences defensively
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // try to extract JSON substring
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
