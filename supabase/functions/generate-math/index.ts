// Reading Garden - MATH content generation via Anthropic (Claude Sonnet).
// Produces calm, untimed early-math practice tailored to the learner's
// current level, target skill, recent misses, and interests.
//
// IMPORTANT: This function ONLY proposes problems (operands + operation) and
// word-problem wording. The APP computes and verifies every answer in code
// (src/lib/computable.ts). Never trust the model's arithmetic.

const CLAUDE_MODEL = "claude-sonnet-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Req {
  taught_skill_codes: string[];
  max_number: number;
  allowed_ops: ("+" | "-")[];
  target_skill: { code: string; name: string; description: string };
  age_years?: number | null;
  interests?: string | null;
  recent_misses?: string[];
  strengths?: string[];
  challenges?: string[];
  parent_observations?: string[];
  word_problems_unlocked?: boolean;
}

const SYSTEM = `You design calm, UNTIMED early-mathematics practice for a young child (~5-7 years).

Non-negotiable rules:
1. NEVER imply speed, racing, beating a clock, or "how fast". No timers. No countdowns. No "quick — go!" language. Calm and encouraging only.
2. STRICT number range: every operand AND every answer must be integers 0..max_number. If your fact would exceed this, DO NOT include it.
3. STRICT operations: only the operations in allowed_ops (+ or -). Never introduce multiplication, division, or an operation not listed.
4. Feature the target skill heavily — most facts should exercise it. Gently re-expose recent_misses (do NOT stack multiple misses in one fact).
5. Stretch strengths (harder variants of what they know); keep challenges isolated and easy.
6. If word_problems_unlocked, produce ONE short one-step story problem themed to the child's interests when given (calm, concrete, wholesome, no scary content, no cultural in-jokes). Otherwise word_problem is null.
7. Interests bias the theme of the word problem ONLY — never break number-range or operation constraints for a theme.
8. Return ONLY strict JSON matching the schema. No prose, no code fences, no commentary. Do NOT include answers — the app computes them.`;

function buildPrompt(r: Req): string {
  const parts: string[] = [];
  parts.push(`Target skill: ${r.target_skill.code} — ${r.target_skill.name} (${r.target_skill.description})`);
  parts.push(`Max number allowed (inclusive): ${r.max_number}`);
  parts.push(`Allowed operations: ${r.allowed_ops.join(", ") || "none"}`);
  parts.push(`Taught skills so far: [${r.taught_skill_codes.join(", ")}]`);
  if (r.age_years != null) parts.push(`Learner age: ~${r.age_years} years`);
  if (r.interests?.trim()) parts.push(`Interests (theme the word problem gently around these): ${r.interests.trim()}`);
  if (r.recent_misses?.length) parts.push(`Recent misses (re-expose gently, one at a time): [${r.recent_misses.slice(0,8).join(", ")}]`);
  if (r.strengths?.length) parts.push(`Strengths (stretch these): [${r.strengths.slice(0,12).join(", ")}]`);
  if (r.challenges?.length) parts.push(`Challenges (isolate, keep easy): [${r.challenges.slice(0,12).join(", ")}]`);
  if (r.parent_observations?.length) parts.push(`Parent notes (soft context):\n${r.parent_observations.slice(0,3).map((n) => `  - ${n}`).join("\n")}`);

  const visualHint = "Choose focus.visual from ten_frame (best for bonds/making ten within 10), number_line (good for counting/comparison), dots (for subitizing/small counting), or none.";

  return `${parts.join("\n")}

${visualHint}

Return STRICT JSON only, exactly this shape:
{
  "focus": {
    "title": "short 2-4 word label of today's focus",
    "concept": "one-sentence plain-English description of the focus",
    "parent_intro": "2-3 short calm sentences the parent reads aloud to introduce the focus",
    "visual": "ten_frame|number_line|dots|none"
  },
  "fact_items": [{"a": int, "op": "+" or "-", "b": int}, ... 6 to 8 items],
  "word_problem": ${r.word_problems_unlocked ? '{"text": "one short natural story problem, one step", "a": int, "op": "+" or "-", "b": int}' : "null"}
}
Do NOT include answers. Do NOT exceed the max number in any operand or answer. Do NOT use any operation outside the allowed list.`;
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
    if (!body.target_skill?.code || !body.max_number || !Array.isArray(body.allowed_ops) || body.allowed_ops.length === 0) {
      return new Response(JSON.stringify({ error: "missing target/max/allowed_ops" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "missing ANTHROPIC_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(body) }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[generate-math] anthropic non-ok", res.status, t);
      return new Response(JSON.stringify({ error: "anthropic_error", detail: t }), {
        status: 502, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const payload = await res.json();
    const text: string = payload?.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(clean); }
    catch {
      const m = clean.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { error: "parse_error", raw: clean };
    }
    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-math] error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
