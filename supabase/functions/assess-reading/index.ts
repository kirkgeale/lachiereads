// Reading Garden - AI-guided reading level assessment
// Two actions:
//   { action: "report",     learner, results, previous_assessment? }
//     -> full parent-facing report (Opus with adaptive thinking)
//   { action: "next_focus", learner, actual_next_target }
//     -> 2-3 warm sentences naming the app-chosen next target (Sonnet, fast)
//
// Probes are built client-side in src/lib/assessment-core.ts; the "plan"
// action was retired and is no longer part of this function.

const CLAUDE_MODEL_REPORT = "claude-opus-4-8";     // report: adaptive thinking
const CLAUDE_MODEL_FAST   = "claude-sonnet-5";     // next_focus: short, no thinking
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

type ReportJson = {
  estimated_level: string;
  plain_summary: string;
  what_they_can_do: string[];
  working_on: string[];
  not_yet: string[];
  parent_actions_this_week: string[];
  next_focus: string;
  gpc_updates: { grapheme: string; status: string }[];
  heart_word_updates: { word: string; status: string }[];
};

async function callClaude(
  system: string,
  user: string,
  opts?: { thinking?: boolean; max_tokens?: number; model?: string },
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const useThinking = opts?.thinking !== false;
  const body: Record<string, unknown> = {
    model: opts?.model ?? CLAUDE_MODEL_REPORT,
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
  let clean = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch (firstErr) {
    const extracted = extractFirstJsonObject(clean);
    if (!extracted) throw new Error(`failed to parse JSON from model output: ${String((firstErr as Error).message ?? firstErr)}`);
    clean = repairJson(extracted);
    try {
      return JSON.parse(clean);
    } catch (secondErr) {
      throw new Error(`failed to parse JSON from model output: ${String((secondErr as Error).message ?? secondErr)}`);
    }
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function repairJson(json: string): string {
  let clean = json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;
  for (const ch of clean) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
  }
  while (brackets > 0) {
    clean += "]";
    brackets--;
  }
  while (braces > 0) {
    clean += "}";
    braces--;
  }
  return clean;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function asStatus(value: unknown): string {
  return ["not_started", "learning", "practising", "secure"].includes(String(value)) ? String(value) : "learning";
}

function normalizeUpdates(value: unknown, key: "grapheme" | "word"): { [key: string]: string; status: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const target = typeof item?.[key] === "string" ? item[key].trim() : "";
      if (!target) return null;
      return { [key]: target, status: asStatus(item?.status) } as { [key: string]: string; status: string };
    })
    .filter(Boolean) as { [key: string]: string; status: string }[];
}

function fallbackReport(learner: LearnerCtx, results: ProbeResult[], prev?: { days_since: number } | null): ReportJson {
  const correctish = new Set(["correct", "self_corrected"]);
  const helped = new Set(["prompted", "hesitated"]);
  const independent = results.filter((r) => correctish.has(r.outcome));
  const prompted = results.filter((r) => helped.has(r.outcome));
  const missed = results.filter((r) => r.outcome === "missed" || r.outcome === "skipped");
  const examples = (items: ProbeResult[], limit = 3) =>
    items
      .map((r) => r.target_grapheme || r.target_heart_word || r.prompt)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, limit);
  const strengths = examples(independent);
  const gaps = examples([...prompted, ...missed]);
  const firstLine = `${learner.name} completed this reading check-in and read ${independent.length} of ${results.length} items independently or with a self-correction.`;
  const compareLine = prev
    ? `Compared with the last check-in ${prev.days_since} day(s) ago, this report should be read as a fresh snapshot of today's reading.`
    : "This is our first proper check-in, so there's nothing yet to compare it to.";
  return {
    estimated_level: "Assessment completed",
    plain_summary: `${firstLine} This is what we saw today — a good check-in, not the full picture. ${compareLine}`,
    what_they_can_do: strengths.length
      ? strengths.map((s) => `Read '${s}' independently or fixed it without help.`)
      : ["Stayed with the reading check-in and gave the items a try."],
    working_on: gaps.length
      ? gaps.map((s) => `Keep practising '${s}' so it becomes easier and more automatic.`)
      : ["Keep building smooth, confident reading with short daily practice."],
    not_yet: missed.length
      ? examples(missed, 2).map((s) => `We have not made '${s}' easy yet; it can come later in practice.`)
      : ["Harder letter patterns can wait until the current reading feels smooth."],
    parent_actions_this_week: [
      "Read together for 5 minutes each day using very short words and sentences.",
      "Praise quick self-corrections and calm trying, not just first-time accuracy.",
      "Stop while it still feels easy so reading practice stays positive.",
    ],
    next_focus: "Keep reading together in short, calm bursts. The next practice session will choose the exact next letter or letter-team to work on.",
    gpc_updates: results
      .filter((r) => r.target_grapheme && r.target_grapheme.length <= 4 && !r.target_grapheme.includes(" "))
      .map((r) => ({ grapheme: r.target_grapheme!, status: correctish.has(r.outcome) ? "secure" : helped.has(r.outcome) ? "practising" : "learning" })),
    heart_word_updates: results
      .filter((r) => r.target_heart_word)
      .map((r) => ({ word: r.target_heart_word!, status: correctish.has(r.outcome) ? "secure" : helped.has(r.outcome) ? "practising" : "learning" })),
  };
}

function normalizeReport(raw: any, learner: LearnerCtx, results: ProbeResult[], prev?: { days_since: number } | null): ReportJson {
  const fallback = fallbackReport(learner, results, prev);
  const canDo = asStringArray(raw?.what_they_can_do ?? raw?.strengths);
  const workingOn = asStringArray(raw?.working_on ?? raw?.focus_areas);
  const actions = asStringArray(raw?.parent_actions_this_week ?? raw?.next_steps);
  return {
    estimated_level: asString(raw?.estimated_level, fallback.estimated_level),
    plain_summary: asString(raw?.plain_summary ?? raw?.summary, fallback.plain_summary),
    what_they_can_do: canDo.length ? canDo : fallback.what_they_can_do,
    working_on: workingOn.length ? workingOn : fallback.working_on,
    not_yet: asStringArray(raw?.not_yet).length ? asStringArray(raw?.not_yet) : fallback.not_yet,
    parent_actions_this_week: actions.length ? actions : fallback.parent_actions_this_week,
    next_focus: asString(raw?.next_focus, fallback.next_focus),
    gpc_updates: normalizeUpdates(raw?.gpc_updates, "grapheme") as { grapheme: string; status: string }[],
    heart_word_updates: normalizeUpdates(raw?.heart_word_updates, "word") as { word: string; status: string }[],
  };
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
    const body = await req.json();

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
      const text = await callClaude(REPORT_SYSTEM, userMsg, { model: CLAUDE_MODEL_REPORT });
      let parsed: ReportJson;
      try {
        parsed = normalizeReport(parseJson(text), learner, results, prev);
      } catch (err) {
        console.error("[assess-reading] report JSON parse/validation failed", err);
        parsed = fallbackReport(learner, results, prev);
      }
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
      const text = await callClaude(NEXT_FOCUS_SYSTEM, userMsg, {
        thinking: false,
        max_tokens: 400,
        model: CLAUDE_MODEL_FAST,
      });
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
